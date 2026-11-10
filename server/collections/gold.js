import { BLIZZARD_API } from '../core/config.js';
import { pageLimit } from '../core/db.js';
import { countRequests } from '../crawler/stats.js';

/**
 * Opt-in gold stats (0.9.0). /profile/user/wow/protected-character/{realmId}-{characterId} answers ONLY with the
 * owner's Battle.net user token, so it is read in the web process at the moment a token exists (a Battle.net sign-in,
 * link or "Refresh my characters", crawler/account.js), never queued, and the token is never kept. The link comes from
 * /profile/user/wow itself (each character's protected_character href); nothing about it is typed in.
 *
 * The response also carries `position`, `bind_position` and `wow_account`. They are NEVER stored, shown or logged:
 * parseProtected() picks four numbers by name and drops everything else, and character_gold has no column (and no jsonb)
 * that could hold them (server/test/gold.test.js scans every table after a sign-in for them).
 *
 * Who sees it: the owner always (privately: dashboard and their own character page). Anyone else only while the owner
 * has "Show my gold stats publicly" on for that character (character_gold_public, keyed to the owner's account: a new
 * owner starts private). Gold boards rank only those characters. Gold never feeds tiers (it isn't a statistic).
 * Retention: Blizzard data like everything else; a row older than the window is deleted and the page says "Gold updates
 * when the owner signs in".
 */
export const GOLD_FIELDS = Object.freeze([
  { key: 'money', column: 'money', label: 'Gold on hand', source: 'money' },
  { key: 'gained', column: 'gold_gained', label: 'Total gold gained', source: 'total_gold_gained' },
  { key: 'lost', column: 'gold_lost', label: 'Total gold lost', source: 'total_gold_lost' },
  { key: 'items', column: 'item_value_gained', label: 'Item value gained', source: 'total_item_value_gained' },
]);
export const goldField = (key) => GOLD_FIELDS.find((f) => f.key === key) ?? null;
const PROTECTED_RE = /^\/profile\/user\/wow\/protected-character\/(\d{1,12})-(\d{1,15})$/;
const MAX_PER_SIGNIN = 60;
const CONCURRENCY = 4;

/** The protected-character response → the four money numbers in copper, nothing else. null when it isn't one. */
export function parseProtected(json) {
  if (!json || typeof json !== 'object' || !Number.isSafeInteger(json.id)) return null;
  const ps = json.protected_stats && typeof json.protected_stats === 'object' ? json.protected_stats : {};
  const num = (v) => (Number.isSafeInteger(v) ? v : null);
  return {
    characterId: json.id,
    money: num(json.money) !== null && json.money >= 0 ? json.money : null,
    gold_gained: num(ps.total_gold_gained),
    gold_lost: num(ps.total_gold_lost),
    item_value_gained: num(ps.total_item_value_gained),
  };
}

/** A /profile/user/wow character's protected link → its path (API host only), or null. */
export function protectedPath(href) {
  if (typeof href !== 'string') return null;
  try {
    const u = new URL(href, BLIZZARD_API.apiHost);
    if (u.origin !== new URL(BLIZZARD_API.apiHost).origin) return null;
    return PROTECTED_RE.test(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Reads each character's protected data with the user token the sign-in just received, and stores the money fields
 * for characters Everstats knows and this account owns. `characters` = [{ id, protectedPath }]. Never throws.
 *   → { read, stored, failed }
 */
export async function importGold({ db, accountId, characters, source, userToken, namespace = BLIZZARD_API.namespaces.profile }) {
  // 0.10.0: `characters` = [{ id (Everstats'), blizzardId (Blizzard's; = id on the native version), protectedPath }],
  // and `namespace` the profile namespace of the version they belong to.
  const todo = characters.filter((c) => c.protectedPath).slice(0, MAX_PER_SIGNIN);
  let read = 0;
  let stored = 0;
  let failed = 0;
  let errors = 0;
  const work = [...todo];
  async function one(c) {
    let r;
    try {
      r = await source.get(c.protectedPath, { namespace, auth: 'user', userToken });
    } catch {
      failed += 1;
      return;
    }
    if (r.status !== 200 || !r.json) {
      failed += 1;
      if (r.status !== 404) errors += 1;
      return;
    }
    read += 1;
    const g = parseProtected(r.json);
    if (!g || g.characterId !== (c.blizzardId ?? c.id)) return;
    const row = await db.one(
      `INSERT INTO character_gold (character_id, account_id, money, gold_gained, gold_lost, item_value_gained, fetched_at)
       SELECT $1, $2, $3, $4, $5, $6, now() WHERE EXISTS (SELECT 1 FROM characters WHERE id = $1 AND owner_account_id = $2)
       ON CONFLICT (character_id) DO UPDATE SET account_id = EXCLUDED.account_id, money = EXCLUDED.money, gold_gained = EXCLUDED.gold_gained,
         gold_lost = EXCLUDED.gold_lost, item_value_gained = EXCLUDED.item_value_gained, fetched_at = now()
       RETURNING character_id`,
      [c.id, accountId, g.money, g.gold_gained, g.gold_lost, g.item_value_gained],
    );
    if (row) stored += 1;
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (work.length) await one(work.shift());
  }));
  await countRequests(db, { requests: todo.length, errors, throttled: 0 }).catch(() => {});
  return { read, stored, failed };
}

/**
 * What a viewer may see of one character's gold:
 *   { state: 'shown', public, mine, fields: { money, gained, lost, items }, fetchedAt } · { state: 'none', mine } (the
 *   owner: nothing stored, or aged out) · null (not the owner and not public: nothing is said at all).
 */
export async function goldFor(db, character, viewerAccountId) {
  const mine = Boolean(viewerAccountId && character.owner_account_id && Number(character.owner_account_id) === Number(viewerAccountId));
  const owner = character.owner_account_id;
  if (!owner) return null;
  const pub = await db.one('SELECT since FROM character_gold_public WHERE character_id = $1 AND account_id = $2', [character.id, owner]);
  if (!mine && (!pub || character.hidden)) return null;
  const g = await db.one('SELECT money, gold_gained, gold_lost, item_value_gained, fetched_at FROM character_gold WHERE character_id = $1 AND account_id = $2', [character.id, owner]);
  if (!g) return mine ? { state: 'none', mine, public: Boolean(pub) } : null;
  const n = (v) => (v === null ? null : Number(v));
  return {
    state: 'shown', mine, public: Boolean(pub), fetchedAt: g.fetched_at,
    fields: { money: n(g.money), gained: n(g.gold_gained), lost: n(g.gold_lost), items: n(g.item_value_gained) },
  };
}

/** The owner's switch. Off deletes the opt-in row: the character leaves every gold board at once. */
export async function setGoldPublic(q, characterId, accountId, on) {
  if (on) {
    await q.query(
      'INSERT INTO character_gold_public (character_id, account_id) VALUES ($1, $2) ON CONFLICT (character_id) DO UPDATE SET account_id = EXCLUDED.account_id, since = now()',
      [characterId, accountId],
    );
  } else {
    await q.query('DELETE FROM character_gold_public WHERE character_id = $1', [characterId]);
  }
  await q.query("INSERT INTO account_events (account_id, type, detail) VALUES ($1, $2, $3::jsonb)", [accountId, on ? 'gold.public_on' : 'gold.public_off', JSON.stringify({ character: characterId })]);
}

// The one predicate every gold board repeats: opted in by the CURRENT owner, the gold read with that owner's token,
// a visible tracked character on the ruleset, above zero, owner not banned.
const BOARD_WHERE = `p.account_id = c.owner_account_id AND g.account_id = c.owner_account_id AND NOT c.hidden AND c.missing_since IS NULL
  AND c.profile_state = 'ok' AND c.ruleset_id = $1 AND NOT everstats_banned(c.owner_account_id)`;

/** One page of a gold board: rank = 1 + opted-in characters strictly above; zero never ranked. */
export async function goldBoard(db, { rulesetId, field, cursor = null, limit: rawLimit }) {
  const f = goldField(field);
  if (!f) return null;
  const limit = pageLimit(rawLimit, { fallback: 25, max: 100 });
  let after = null;
  try {
    after = cursor ? JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')) : null;
  } catch {
    after = null;
  }
  const valid = Array.isArray(after) && Number.isFinite(after[0]) && Number.isSafeInteger(after[1]);
  const rows = await db.query(
    `SELECT c.id, c.slug, c.name, c.surname, c.level, c.class, c.race, c.faction, g.${f.column} AS value, g.fetched_at
       FROM character_gold g JOIN characters c ON c.id = g.character_id JOIN character_gold_public p ON p.character_id = c.id
      WHERE ${BOARD_WHERE} AND g.${f.column} > 0
        AND ($2::float8 IS NULL OR g.${f.column} < $2 OR (g.${f.column} = $2 AND c.id > $3))
      ORDER BY g.${f.column} DESC, c.id LIMIT $4`,
    [rulesetId, valid ? after[0] : null, valid ? after[1] : null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const values = [...new Set(page.map((r) => Number(r.value)))];
  const ranks = values.length ? await db.query(
    `SELECT v.value, (SELECT count(*)::int FROM character_gold g JOIN characters c ON c.id = g.character_id JOIN character_gold_public p ON p.character_id = c.id
                       WHERE ${BOARD_WHERE} AND g.${f.column} > v.value) + 1 AS rank
       FROM unnest($2::float8[]) AS v(value)`,
    [rulesetId, values],
  ) : [];
  const rankOf = new Map(ranks.map((r) => [Number(r.value), r.rank]));
  const count = (await db.one(
    `SELECT count(*)::int AS n FROM character_gold g JOIN characters c ON c.id = g.character_id JOIN character_gold_public p ON p.character_id = c.id WHERE ${BOARD_WHERE} AND g.${f.column} > 0`,
    [rulesetId],
  )).n;
  return {
    field: { key: f.key, label: f.label },
    ranked: count,
    rows: page.map((r) => ({ rank: rankOf.get(Number(r.value)), value: Number(r.value), slug: r.slug, name: r.name, surname: r.surname, level: r.level, class: r.class, race: r.race, faction: r.faction, fetchedAt: r.fetched_at })),
    next: rows.length > limit ? Buffer.from(JSON.stringify([Number(page.at(-1).value), Number(page.at(-1).id)])).toString('base64url') : null,
  };
}
