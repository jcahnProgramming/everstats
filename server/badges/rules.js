import { PRIMARY_VERSION } from '../core/gameVersions.js';
import { MIN_LEVEL } from './catalog.js';
import { award, badgeContext, loadDefinitions, logEvent, revoke } from './store.js';

/**
 * Automatic badges (0.7.0): who qualifies, from what Everstats already stores. No Blizzard request, and nothing from
 * Blizzard is copied into an award: at most the Blizzard ID of the character that earned a class or faction badge.
 *
 * Run (evaluateAccount):
 *   - after a Battle.net sign-in, link or "Refresh my characters" reads the character list (crawler/account.js)
 *   - after any fetch of an OWNED character, the daily refresh included (crawler/fetch.js)
 *   - after a guild roster is stored, for the owner of its rank-0 character (crawler/fetch.js)
 *   - after every full tier grading, for S-Tier (worker job 'badges')
 *   - once on deploy for every account, without toasts (the back-fill), and every 6 hours as a safety net
 *
 * Owned characters count even when hidden: the badge never names the character ("Owns a level 10+ Horde
 * character"). A purged character (Blizzard hasn't returned it for the whole retention window) no longer has a class,
 * faction or level, so it can't earn anything new, but what it earned stays.
 */
// 0.10.0: game-data badges belong to ONE game version (badge_definitions.game_version; NULL = not game data, e.g. beta):
// their facts come from that version's characters only, so Every Calling counts classes within one version.
const OWNED = `SELECT id, class, faction, coalesce(level, account_level) AS lvl FROM characters
                WHERE owner_account_id = $1 AND game_version = $2 AND profile_state <> 'purged' ORDER BY coalesce(level, account_level) DESC NULLS LAST, id LIMIT 500`;
/** Rule types that read characters: their badges are per game version. */
export const GAME_DATA_RULES = Object.freeze(['faction', 'envoy', 'class', 'every-class', 'guild-master', 's-tier']);
const versionOf = (d) => d.game_version ?? PRIMARY_VERSION.id;

/**
 * Every class: the classes Blizzard has returned on any stored character (Blizzard data, so it follows the retention
 * window with them) together with every class a class badge names. A class Blizzard adds shows up in the first
 * character that has it, and Every Calling needs it from then on; its own badge only needs a definition made from the
 * class template.
 */
export async function classList(db, defs, version = PRIMARY_VERSION.id) {
  const seen = await db.query("SELECT DISTINCT class FROM characters WHERE class IS NOT NULL AND game_version = $1 AND profile_state <> 'purged' LIMIT 100", [version]);
  const named = defs.filter((d) => d.rule?.type === 'class' && versionOf(d) === version).map((d) => d.rule.class);
  return [...new Set([...named, ...seen.map((r) => r.class)])].sort();
}

/** → Map(badgeId → { characterId }) of every automatic badge the account qualifies for right now. */
export async function qualifying(q, accountId, defs, ctx, classes) {
  const acct = await q.one('SELECT id, created_at, beta_member FROM accounts WHERE id = $1', [accountId]);
  if (!acct) return new Map();
  const facts = new Map(); // version → { byFaction, byClass, gm, sTier }
  async function factsFor(version) {
    if (facts.has(version)) return facts.get(version);
    const owned = (await q.query(OWNED, [accountId, version])).filter((c) => Number.isInteger(c.lvl) && c.lvl >= MIN_LEVEL);
    const f = { byFaction: new Map(), byClass: new Map() };
    for (const c of owned) {
      if (c.faction && !f.byFaction.has(c.faction)) f.byFaction.set(c.faction, c.id);
      if (c.class && !f.byClass.has(c.class)) f.byClass.set(c.class, c.id);
    }
    f.gm = await q.one(
      `SELECT gr.character_id FROM guild_roster gr JOIN characters c ON c.id = gr.character_id
        WHERE gr.rank = 0 AND c.owner_account_id = $1 AND c.game_version = $2 LIMIT 1`,
      [accountId, version],
    );
    f.sTier = await q.one(
      `SELECT t.character_id FROM character_tiers t JOIN characters c ON c.id = t.character_id
        WHERE c.owner_account_id = $1 AND c.game_version = $2 AND t.letter = 'S' AND NOT c.hidden LIMIT 1`,
      [accountId, version],
    );
    facts.set(version, f);
    return f;
  }
  // classes: the primary version's list (callers' existing shape), or Map(version → list).
  const classesOf = async (version) => (classes instanceof Map ? classes.get(version) ?? await classList(q, defs, version) : version === PRIMARY_VERSION.id ? classes : await classList(q, defs, version));
  const out = new Map();
  for (const d of defs) {
    const r = d.rule;
    if (!r) continue;
    const gameData = GAME_DATA_RULES.includes(r.type);
    const { byFaction, byClass, gm, sTier } = gameData ? await factsFor(versionOf(d)) : { byFaction: new Map(), byClass: new Map(), gm: null, sTier: null };
    const versionClasses = r.type === 'every-class' ? await classesOf(versionOf(d)) : [];
    let hit = null;
    if (r.type === 'beta' && acct.beta_member) hit = {};
    else if (r.type === 'early-supporter' && ctx.early.set) {
      const t = Date.parse(acct.created_at);
      if (t >= ctx.early.startMs && t < ctx.early.endMs) hit = {};
    } else if (r.type === 'faction' && byFaction.has(r.faction)) hit = { characterId: byFaction.get(r.faction) };
    else if (r.type === 'envoy' && byFaction.has('Alliance') && byFaction.has('Horde')) hit = {};
    else if (r.type === 'class' && byClass.has(r.class)) hit = { characterId: byClass.get(r.class) };
    else if (r.type === 'every-class' && versionClasses.length && versionClasses.every((c) => byClass.has(c))) hit = {};
    else if (r.type === 'guild-master' && gm) hit = {};
    else if (r.type === 's-tier' && sTier) hit = {};
    if (hit) out.set(d.id, hit);
  }
  return out;
}

/**
 * Brings one account's automatic badges up to date. → { earned: [ids], removed: [ids] }
 *   notify false: no toasts (the back-fill).
 */
export async function evaluateAccount(db, accountId, { notify = true, actor = 'rule', defs = null, ctx = null, classes = null } = {}) {
  const definitions = defs ?? await loadDefinitions(db);
  const context = ctx ?? await badgeContext(db);
  const classNames = classes ?? await classList(db, definitions);
  return db.tx(async (q) => {
    // One evaluation per account at a time (the web after a sign-in and the worker after a fetch can overlap).
    const locked = await q.one('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!locked) return { earned: [], removed: [] };
    const hits = await qualifying(q, accountId, definitions, context, classNames);
    const earned = [];
    const removed = [];
    for (const d of definitions) {
      if (d.award !== 'automatic') continue;
      const hit = hits.get(d.id);
      if (hit) {
        if (await award(q, { accountId, def: d, source: 'automatic', characterId: hit.characterId ?? null, notify, actor })) earned.push(d.id);
      } else if (d.kept_while_held) {
        const reason = d.rule.type === 's-tier' ? 'Your overall tier dropped below S on every ruleset.' : 'You no longer meet this badge’s rule.';
        if (await revoke(q, { accountId, badgeId: d.id, by: 'rule', reason, notify, actor })) removed.push(d.id);
      }
    }
    return { earned, removed };
  });
}

/** Never lets a badge problem fail what triggered it (a sign-in, a fetch, a grading). */
export async function evaluateQuietly(db, accountId) {
  if (accountId === null || accountId === undefined) return null;
  try {
    return await evaluateAccount(db, Number(accountId));
  } catch (err) {
    console.error(`[badges] evaluation failed: ${err.code ?? err.name}`);
    return null;
  }
}

/** Evaluates many accounts with one read of the definitions. → per-badge counts of what changed. */
export async function evaluateAccounts(db, accountIds, { notify = true, actor = 'rule' } = {}) {
  const defs = await loadDefinitions(db);
  const ctx = await badgeContext(db);
  const classes = await classList(db, defs);
  const counts = { earned: {}, removed: {}, accounts: 0 };
  for (const id of accountIds) {
    const r = await evaluateAccount(db, id, { notify, actor, defs, ctx, classes });
    counts.accounts += 1;
    for (const b of r.earned) counts.earned[b] = (counts.earned[b] ?? 0) + 1;
    for (const b of r.removed) counts.removed[b] = (counts.removed[b] ?? 0) + 1;
  }
  return counts;
}

/** Every account id, in pages (no unbounded select). */
async function* allAccounts(db) {
  for (let after = 0; ;) {
    const rows = await db.query('SELECT id FROM accounts WHERE id > $1 ORDER BY id LIMIT 500', [after]);
    if (!rows.length) return;
    for (const r of rows) yield r.id;
    after = rows[rows.length - 1].id;
  }
}

export async function evaluateEveryone(db, opts = {}) {
  const ids = [];
  for await (const id of allAccounts(db)) ids.push(id);
  return evaluateAccounts(db, ids, opts);
}

/**
 * S-Tier after a full grading: everyone who owns an overall S now, and everyone who holds the badge (they may have
 * lost it). Only kept-while-held badges can be removed, so this is the set that can change.
 */
export async function sTierSweep(db) {
  const owners = await db.query(
    `SELECT DISTINCT c.owner_account_id AS id FROM character_tiers t JOIN characters c ON c.id = t.character_id
      WHERE t.letter = 'S' AND c.owner_account_id IS NOT NULL AND NOT c.hidden LIMIT 100000`,
  );
  const holders = await db.query(
    `SELECT a.account_id AS id FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id
      WHERE d.kept_while_held AND a.state = 'held' LIMIT 100000`,
  );
  const ids = [...new Set([...owners, ...holders].map((r) => Number(r.id)))];
  return evaluateAccounts(db, ids);
}

/**
 * The one-time back-fill on deploy: every existing account, no toasts. Recorded in pipeline_facts (so it runs once)
 * and in badge_events (type 'backfill', with the counts), which the admin Badges page shows.
 */
export async function backfillOnce(db) {
  const done = await db.one("SELECT at FROM pipeline_facts WHERE key = 'badges_backfilled_at'");
  if (done) return null;
  const counts = await evaluateEveryone(db, { notify: false, actor: 'backfill' });
  await db.tx(async (q) => {
    const claimed = await q.query("INSERT INTO pipeline_facts (key, at) VALUES ('badges_backfilled_at', now()) ON CONFLICT DO NOTHING RETURNING 1");
    if (claimed.length) await logEvent(q, { type: 'backfill', actor: 'backfill', detail: { accounts: counts.accounts, awarded: counts.earned } });
  });
  console.log(`[badges] back-fill: ${counts.accounts} account(s), ${Object.values(counts.earned).reduce((a, b) => a + b, 0)} badge(s) awarded`);
  return counts;
}
