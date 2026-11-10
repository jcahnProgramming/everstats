import { getSetting } from '../admin/settings.js';
import { blizzardContext, enabledVersions, onePool, versionById } from '../core/gameVersions.js';
import { MIN_TRACKED_LEVEL, crawlKey, realmCategoryFor } from './fetch.js';
import { PRIORITY, enqueueMany } from './queue.js';

/**
 * FINDING CHARACTERS on a version that has no roster expansion (0.11.1, owner's decision 8). World of Warcraft has
 * hundreds of realms and millions of characters; Everstats never crawls a realm. Besides lookups and sign-ins, a
 * version's registry entry (core/gameVersions.js `seeding`) allows two capped sources, both at the LOWEST priority
 * (PRIORITY.roster) and therefore inside that version's share of the request budget (crawler.versionShares):
 *
 *   openedGuildRosters   the roster of a guild someone opened: its untracked level 10+ members, up to
 *                        `seeding.openedGuildsPerDay` a day for the whole version.
 *   mythicLeaderboards   members of the CURRENT Mythic+ leaderboards, one connected realm and one dungeon at a time
 *                        (real, recently active players), up to `seeding.mythicPlusPerDay` a day.
 *
 * `seeding_days` counts what each source queued per UTC day (the caps are checked against it); `seeding_state` keeps
 * the Mythic+ round's position. Both hold counts and positions only.
 *
 * The realm list (refreshRealms) is what the round walks and what the realm picker shows: every realm of a LISTED
 * connected realm (realms/playerRealms.js rule 1: internal realms are in no listed connected realm, so they never get
 * a row here).
 *
 * Shapes as probe #7 stored them:
 *   search/connected-realm          { pageCount, results: [{ data: { id, realms: [{ id, slug, name{locale}, type{type,name}, … }] } }] }
 *   connected-realm/{id}/mythic-leaderboard/index   { current_leaderboards: [{ id, name, key: { href } }] }
 *   …/mythic-leaderboard/{dungeon}/period/{period}  { leading_groups: [{ members: [{ profile: { id, name, realm: { slug } } }] }] }
 */
export const SEED_SOURCES = Object.freeze({ guild: 'guild-roster', mythic: 'mythic-leaderboard' });
const MAX_PER_RUN = 60; // new characters one run may queue (each is ~9 requests): a run never floods the queue

const today = "(now() AT TIME ZONE 'UTC')::date";

export async function queuedToday(db, version, source) {
  return (await db.one(`SELECT queued FROM seeding_days WHERE day = ${today} AND game_version = $1 AND source = $2`, [version, source]))?.queued ?? 0;
}

async function addQueued(db, version, source, n) {
  if (n <= 0) return;
  await db.query(
    `INSERT INTO seeding_days (day, game_version, source, queued) VALUES (${today}, $1, $2, $3)
     ON CONFLICT (day, game_version, source) DO UPDATE SET queued = seeding_days.queued + EXCLUDED.queued`,
    [version, source, n],
  );
}

/** Of these { realmSlug, slug } references, the ones Everstats has no character row for in this scope. */
async function untracked(db, scope, refs) {
  if (!refs.length) return [];
  const rows = await db.query(
    `SELECT coalesce(realm_slug, '') || '/' || slug AS k FROM characters
      WHERE game_version = $1 AND region = $2 AND slug = ANY($3::text[]) AND coalesce(realm_slug, '') = ANY($4::text[]) LIMIT $5`,
    [scope.version, scope.region, [...new Set(refs.map((r) => r.slug))], [...new Set(refs.map((r) => r.realmSlug ?? ''))], refs.length * 4 + 10],
  );
  const known = new Set(rows.map((r) => r.k));
  return refs.filter((r) => !known.has(`${r.realmSlug ?? ''}/${r.slug}`));
}

/**
 * A roster that was just read on a non-primary version: queue its untracked level 10+ members, inside today's cap.
 * → how many were queued. (`members` as crawler/fetch.js has them: { slug, realmSlug, level, id (Everstats') }.)
 */
export async function seedFromRoster(db, { scope, members, opened = true }) {
  if (!opened || !versionById(scope.version)?.seeding?.openedGuildRosters) return 0;
  const cap = await getSetting(db, 'seeding.openedGuildsPerDay');
  if (await getSetting(db, 'crawler.paused')) return 0;
  const room = Math.min(MAX_PER_RUN, cap - (await queuedToday(db, scope.version, SEED_SOURCES.guild)));
  if (room <= 0) return 0;
  const eligible = members.filter((m) => Number.isInteger(m.level) && m.level >= MIN_TRACKED_LEVEL && m.slug);
  const known = new Set((await db.query('SELECT id FROM characters WHERE id = ANY($1::bigint[])', [eligible.map((m) => m.id)])).map((x) => Number(x.id)));
  const fresh = eligible.filter((m) => !known.has(Number(m.id))).slice(0, room);
  if (!fresh.length) return 0;
  const n = await enqueueMany(db, fresh.map((m) => ({ kind: 'character', key: crawlKey(m), priority: PRIORITY.roster, ...scope })));
  await addQueued(db, scope.version, SEED_SOURCES.guild, n);
  return n;
}

const localised = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (typeof v.en_US === 'string' ? v.en_US : Object.values(v).find((x) => typeof x === 'string') ?? null) : null);

/** search/connected-realm pages → every player realm: { slug, id, name, typeKey, typeName, connectedRealmId }. */
export function realmsFromSearch(pages) {
  const out = [];
  for (const page of pages ?? []) {
    for (const r of Array.isArray(page?.results) ? page.results : []) {
      const d = r?.data;
      if (!d || !Number.isSafeInteger(d.id)) continue;
      for (const x of Array.isArray(d.realms) ? d.realms : []) {
        if (typeof x?.slug !== 'string') continue;
        const type = x.type && typeof x.type === 'object' ? x.type : null;
        out.push({
          slug: x.slug.toLowerCase().slice(0, 80), id: Number.isSafeInteger(x.id) ? x.id : null, name: localised(x.name)?.slice(0, 80) ?? null,
          typeKey: typeof type?.type === 'string' ? type.type.slice(0, 40) : null, typeName: localised(type?.name)?.slice(0, 60) ?? null, connectedRealmId: d.id,
        });
      }
    }
  }
  return out;
}

/**
 * The player realms of one realm version: search/connected-realm, every page (Retail US: 83 connected realms, one
 * page), written to `realms`. A realm already there keeps its row and is refreshed; a realm no longer listed simply
 * stops being refreshed and ages out with the window. → realms written, or null when Blizzard didn't answer.
 */
export async function refreshRealms({ db, client }, scope) {
  const ctx = blizzardContext(scope.version, scope.region);
  const opts = { priority: PRIORITY.roster, namespace: ctx.namespaces.dynamic, version: scope.version, region: scope.region };
  const pages = [];
  for (let page = 1; page <= 10; page += 1) {
    const r = await client.request('connected-realm-search', ctx.paths.connectedRealmSearch, { ...opts, query: { orderby: 'id', _page: page } });
    if (r.status !== 200 || !r.json) return pages.length ? write(db, scope, pages) : null;
    pages.push(r.json);
    if (!(Number(r.json.pageCount) > page)) break;
  }
  return write(db, scope, pages);
}

async function write(db, scope, pages) {
  const realms = realmsFromSearch(pages);
  if (!realms.length) return 0;
  await db.tx(async (q) => {
    const pool = onePool(scope.version) ? await realmCategoryFor(q, scope, null) : null;
    for (const r of realms) {
      const categoryId = pool ?? (r.typeKey ? await realmCategoryFor(q, scope, { key: r.typeKey, name: r.typeName ?? r.typeKey }) : null);
      await q.query(
        `INSERT INTO realms (game_version, region, slug, blizzard_id, name, type_key, type_name, category_id, connected_realm_id, excluded, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, now())
         ON CONFLICT (game_version, region, slug) DO UPDATE SET blizzard_id = coalesce(EXCLUDED.blizzard_id, realms.blizzard_id), name = coalesce(EXCLUDED.name, realms.name),
           type_key = coalesce(EXCLUDED.type_key, realms.type_key), type_name = coalesce(EXCLUDED.type_name, realms.type_name),
           category_id = coalesce(EXCLUDED.category_id, realms.category_id), connected_realm_id = EXCLUDED.connected_realm_id, excluded = NULL, fetched_at = now()`,
        [scope.version, scope.region, r.slug, r.id, r.name, r.typeKey, r.typeName, categoryId, r.connectedRealmId],
      );
    }
  });
  return realms.length;
}

/** A Mythic+ leaderboard → its members as character references (deduplicated). */
export function leaderboardMembers(json) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(json?.leading_groups) ? json.leading_groups : []) {
    for (const m of Array.isArray(g?.members) ? g.members : []) {
      const p = m?.profile;
      const realmSlug = typeof p?.realm?.slug === 'string' ? p.realm.slug.toLowerCase() : null;
      if (!p || typeof p.name !== 'string' || !realmSlug) continue;
      const slug = p.name.toLowerCase();
      const k = `${realmSlug}/${slug}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ realmSlug, slug, name: p.name }); // name: as Blizzard wrote it (the probe's leaderboard pick shows it)
    }
  }
  return out;
}

/**
 * One step of the Mythic+ round for one scope: the next connected realm's leaderboard index, then ONE of its dungeon
 * leaderboards (about 250 KB), and its untracked members queued inside today's cap. 2 requests a step, at the lowest
 * priority. → a status line.
 */
export async function seedFromMythicLeaderboards({ db, client }, scope) {
  const version = versionById(scope.version);
  if (!version?.seeding?.mythicLeaderboards) return 'not on this version';
  const cap = await getSetting(db, 'seeding.mythicPlusPerDay');
  if (cap <= 0) return 'off (cap 0)';
  const done = await queuedToday(db, scope.version, SEED_SOURCES.mythic);
  const room = Math.min(MAX_PER_RUN, cap - done);
  if (room <= 0) return `today's ${cap} queued; more tomorrow`;
  const connected = (await db.query(
    'SELECT DISTINCT connected_realm_id AS id FROM realms WHERE game_version = $1 AND region = $2 AND excluded IS NULL AND connected_realm_id IS NOT NULL ORDER BY 1 LIMIT 2000',
    [scope.version, scope.region],
  )).map((r) => Number(r.id));
  if (!connected.length) return 'no realm list yet';
  const state = await db.one('SELECT position FROM seeding_state WHERE game_version = $1 AND region = $2 AND source = $3', [scope.version, scope.region, SEED_SOURCES.mythic]);
  const position = Number(state?.position ?? 0);
  const realmId = connected[position % connected.length];
  const round = Math.floor(position / connected.length); // which dungeon of each realm this round reads
  const ctx = blizzardContext(scope.version, scope.region);
  const opts = { priority: PRIORITY.roster, namespace: ctx.namespaces.dynamic, version: scope.version, region: scope.region };
  const save = (detail) => db.query(
    `INSERT INTO seeding_state (game_version, region, source, position, detail, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (game_version, region, source) DO UPDATE SET position = EXCLUDED.position, detail = EXCLUDED.detail, updated_at = now()`,
    [scope.version, scope.region, SEED_SOURCES.mythic, position + 1, String(detail).slice(0, 300)],
  );
  const idx = await client.request('mythic-leaderboard-index', ctx.paths.mythicLeaderboards(realmId), opts);
  if (idx.status !== 200 || !idx.json) {
    await save(`connected realm ${realmId}: index HTTP ${idx.status ?? 'no answer'}`);
    return `connected realm ${realmId}: no leaderboard index (HTTP ${idx.status ?? 'no answer'})`;
  }
  const boards = (Array.isArray(idx.json.current_leaderboards) ? idx.json.current_leaderboards : []).filter((b) => typeof b?.key?.href === 'string');
  if (!boards.length) {
    await save(`connected realm ${realmId}: no current leaderboards`);
    return `connected realm ${realmId}: no current leaderboards`;
  }
  // The leaderboard's own link (Blizzard names the dungeon and the period); nothing here builds a period id.
  const board = boards[round % boards.length];
  const lb = await client.request('mythic-leaderboard', board.key.href, opts);
  if (lb.status !== 200 || !lb.json) {
    await save(`connected realm ${realmId}: leaderboard HTTP ${lb.status ?? 'no answer'}`);
    return `connected realm ${realmId}: leaderboard not returned (HTTP ${lb.status ?? 'no answer'})`;
  }
  const members = leaderboardMembers(lb.json);
  const fresh = (await untracked(db, scope, members)).slice(0, room);
  const n = fresh.length ? await enqueueMany(db, fresh.map((m) => ({ kind: 'character', key: crawlKey(m), priority: PRIORITY.roster, ...scope }))) : 0;
  await addQueued(db, scope.version, SEED_SOURCES.mythic, n);
  const line = `connected realm ${realmId}: ${members.length} leaderboard members, ${n} new queued (${done + n} of ${cap} today)`;
  await save(line);
  return line;
}

/** Every enabled version (in the configured region) that has `seeding` or realms: what the worker jobs loop over. */
export async function realmScopes() {
  const { PRIMARY_SCOPE } = await import('../core/config.js');
  return enabledVersions().filter((v) => v.realms && v.regions.includes(PRIMARY_SCOPE.region)).map((v) => ({ version: v.id, region: PRIMARY_SCOPE.region }));
}

/** The admin's view: per version and source, today's count, the cap and the round's last line. */
export async function seedingStatus(db) {
  const out = [];
  for (const scope of await realmScopes()) {
    const v = versionById(scope.version);
    const state = await db.one('SELECT position, detail, updated_at FROM seeding_state WHERE game_version = $1 AND region = $2 AND source = $3', [scope.version, scope.region, SEED_SOURCES.mythic]);
    out.push({
      version: v.id, name: v.name,
      realms: (await db.one('SELECT count(*)::int AS n, count(DISTINCT connected_realm_id)::int AS connected FROM realms WHERE game_version = $1 AND region = $2 AND excluded IS NULL', [scope.version, scope.region])),
      mythic: v.seeding?.mythicLeaderboards ? { cap: await getSetting(db, 'seeding.mythicPlusPerDay'), today: await queuedToday(db, v.id, SEED_SOURCES.mythic), last: state?.detail ?? null, at: state?.updated_at ?? null } : null,
      guilds: v.seeding?.openedGuildRosters ? { cap: await getSetting(db, 'seeding.openedGuildsPerDay'), today: await queuedToday(db, v.id, SEED_SOURCES.guild) } : null,
    });
  }
  return out;
}
