import { leaderboardMembers } from '../../crawler/seeding.js';
import { connectedRealmsFromSearch } from '../../realms/playerRealms.js';

/**
 * A character for the endpoint probe from a PUBLIC leaderboard of a game version (0.11.1, owner's decision 9), for
 * versions where the admin's own Battle.net account has no character that can be fetched. App token only; nothing is
 * stored; every id and link asked is one Blizzard returned in an earlier answer (never an invented id, never a guessed
 * bracket name).
 *
 *   1. search/connected-realm (dynamic namespace, page 1) → the connected realms, open ones before locked ones.
 *   2. For up to MAX_REALMS of them: connected-realm/{id}/mythic-leaderboard/index → the first leaderboard's own link
 *      → its leading groups' members (shape: probe #7, Retail; crawler/seeding.js leaderboardMembers).
 *   3. Nobody there → the PvP leaderboards: pvp-season/index → `current_season` (retired seasons answer 403, so no
 *      other season is tried) → pvp-season/{id}/pvp-leaderboard/index → the first leaderboard's own link → its entries.
 *      Found nobody again → the same chain under pvp-region/{id}/…, which Blizzard documents for Classic
 *      (discovery/probe/endpoints.js, the entries flagged `classic`), with region ids from pvp-region/index.
 *
 * NOT VERIFIED, said plainly:
 *   - Blizzard documents no separate "challenge mode" leaderboard path that we have verified. The registry's
 *     `leaderboardCharacters: 'challenge-mode'` (Classic, Classic Era, Anniversary) therefore tries the SAME
 *     connected-realm leaderboard index first, and the PvP leaderboard is the fallback when it doesn't answer.
 *   - No stored response shows a PvP leaderboard index or a PvP leaderboard. They are read defensively as
 *     { leaderboards: [{ key: { href } }] } and { entries: [{ character: { name, realm: { slug } } }] }, and
 *     pvp-region/index as any list whose items carry an id or a …/pvp-region/{id} link. An answer in another shape
 *     gives no characters and a note that says so.
 */
export const LEADERBOARD_SOURCES = Object.freeze({ mythic: 'mythic-leaderboard', pvp: 'pvp-leaderboard' });
const MAX_CHARACTERS = 10;
const MAX_REALMS = 3;
const MAX_PVP_REGIONS = 2;
const PVP_SEASONS = '/data/wow/pvp-season';
const PVP_REGIONS = '/data/wow/pvp-region';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const how = (r) => (r.status === null || r.status === undefined ? 'no answer' : `HTTP ${r.status}`);
const hrefOf = (v) => (typeof v?.key?.href === 'string' ? v.key.href : typeof v?.href === 'string' ? v.href : null);
/** What `tried` shows for a link: its path only (a link's query holds the namespace, nothing else, but keep it short). */
const pathOnly = (pathOrHref) => {
  const s = String(pathOrHref);
  if (!/^https?:/i.test(s)) return s;
  try {
    return new URL(s).pathname;
  } catch {
    return s.slice(0, 200);
  }
};

/** A PvP leaderboard → [{ name, realmSlug }] (unverified shape: see the header). */
export function pvpLeaderboardCharacters(json) {
  const out = [];
  for (const e of Array.isArray(json?.entries) ? json.entries : []) {
    const c = e?.character;
    if (!isObj(c) || typeof c.name !== 'string' || !c.name || typeof c.realm?.slug !== 'string' || !c.realm.slug) continue;
    out.push({ name: c.name, realmSlug: c.realm.slug.toLowerCase() });
  }
  return out;
}

/** A season index's current season id: its id, else the id in its own link. Null when Blizzard names none. */
function currentSeasonId(json) {
  const cur = json?.current_season;
  if (!isObj(cur)) return null;
  if (Number.isSafeInteger(cur.id) && cur.id > 0) return cur.id;
  const m = /\/pvp-season\/(\d+)(?:[/?]|$)/.exec(hrefOf(cur) ?? '');
  return m ? Number(m[1]) : null;
}

/** pvp-region/index → the region ids it lists (unverified shape: any list of items with an id or a pvp-region link). */
function pvpRegionIds(json) {
  const ids = [];
  for (const list of Object.values(isObj(json) ? json : {})) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const m = /\/pvp-region\/(\d+)(?:[/?]|$)/.exec(hrefOf(item) ?? '');
      const id = m ? Number(m[1]) : Number.isSafeInteger(item?.id) && item.id >= 0 ? item.id : null;
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * → { characters: [{ name, realmSlug, source }] (at most 10, deduplicated), source: 'mythic-leaderboard' |
 *     'pvp-leaderboard' | null, tried: [{ path, status }], note }
 * `get(path, { namespace, query })` is the Blizzard source's get; `ctx` is blizzardContext(version, region); `version`
 * the registry entry.
 */
export async function leaderboardCharacters({ get, ctx, version }) {
  const tried = [];
  const notes = [];
  const namespace = ctx.namespaces.dynamic;
  const ask = async (pathOrHref, opts = {}) => {
    let r;
    try {
      r = await get(pathOrHref, { namespace, ...opts });
    } catch (err) {
      // A link to another host is refused by the source before anything is sent.
      r = { status: null, json: null, error: typeof err?.code === 'string' ? err.code : 'refused' };
    }
    tried.push({ path: typeof r?.path === 'string' ? r.path : pathOnly(pathOrHref), status: r?.status ?? null });
    return r ?? { status: null, json: null };
  };
  const done = (found, source) => {
    const seen = new Set();
    const characters = [];
    for (const c of found) {
      const k = `${c.realmSlug}/${c.name.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      characters.push({ name: c.name, realmSlug: c.realmSlug, source });
      if (characters.length >= MAX_CHARACTERS) break;
    }
    return { characters, source: characters.length ? source : null, tried, note: notes.join(' ') || null };
  };
  if (!version?.leaderboardCharacters || !ctx.realms) {
    notes.push(`${version?.name ?? 'This version'} has no leaderboard Everstats can pick a character from.`);
    return done([], null);
  }
  const dungeon = version.leaderboardCharacters === LEADERBOARD_SOURCES.mythic ? 'Mythic+' : 'dungeon (Mythic+ path)';

  // 1. The connected realms Blizzard lists.
  const search = await ask(ctx.paths.connectedRealmSearch, { query: { orderby: 'id', _page: 1 } });
  if (search.status !== 200 || !search.json) {
    notes.push(`Blizzard didn’t give the connected realm list (${how(search)}), so no leaderboard could be asked for.`);
    return done([], null);
  }
  const connected = connectedRealmsFromSearch([search.json]);
  if (!connected.length) {
    notes.push('Blizzard’s connected realm search listed no connected realms, so no leaderboard could be asked for.');
    return done([], null);
  }
  const open = connected.filter((c) => c.locked !== true);
  if (!open.length) notes.push('Every connected realm listed is locked; they were tried anyway.');
  const realms = [...open, ...connected.filter((c) => c.locked === true)].slice(0, MAX_REALMS);

  // 2. A connected realm's current dungeon leaderboards.
  for (const realm of realms) {
    const idx = await ask(ctx.paths.mythicLeaderboards(realm.id));
    if (idx.status !== 200 || !idx.json) {
      notes.push(`Blizzard lists no current ${dungeon} leaderboard for connected realm ${realm.id} (${how(idx)}).`);
      continue;
    }
    const board = (Array.isArray(idx.json.current_leaderboards) ? idx.json.current_leaderboards : []).find((b) => typeof b?.key?.href === 'string');
    if (!board) {
      notes.push(`Connected realm ${realm.id}’s ${dungeon} leaderboard index names no current leaderboard.`);
      continue;
    }
    const lb = await ask(board.key.href);
    if (lb.status !== 200 || !lb.json) {
      notes.push(`Connected realm ${realm.id}’s first ${dungeon} leaderboard wasn’t returned (${how(lb)}).`);
      continue;
    }
    const members = leaderboardMembers(lb.json).map((m) => ({ name: m.name ?? m.slug, realmSlug: m.realmSlug }));
    if (members.length) return done(members, LEADERBOARD_SOURCES.mythic);
    notes.push(`Connected realm ${realm.id}’s first ${dungeon} leaderboard lists no members.`);
  }

  // 3. The PvP leaderboards: the current season only, the first leaderboard the index links.
  const pvpFrom = async (base) => {
    const idx = await ask(`${base}/index`);
    if (idx.status !== 200 || !idx.json) {
      notes.push(`Blizzard didn’t give a PvP season index at ${base}/index (${how(idx)}).`);
      return [];
    }
    const seasonId = currentSeasonId(idx.json);
    if (seasonId === null) {
      notes.push(`The PvP season index at ${base}/index names no current season (retired seasons answer 403, so none was tried).`);
      return [];
    }
    const boards = await ask(`${base}/${seasonId}/pvp-leaderboard/index`);
    if (boards.status !== 200 || !boards.json) {
      notes.push(`Blizzard lists no PvP leaderboards for the current season ${seasonId} (${how(boards)}).`);
      return [];
    }
    const link = (Array.isArray(boards.json.leaderboards) ? boards.json.leaderboards : []).map(hrefOf).find(Boolean);
    if (!link) {
      notes.push(`The PvP leaderboard index for season ${seasonId} links no leaderboard in the shape Everstats reads.`);
      return [];
    }
    const lb = await ask(link);
    if (lb.status !== 200 || !lb.json) {
      notes.push(`The first PvP leaderboard of season ${seasonId} wasn’t returned (${how(lb)}).`);
      return [];
    }
    const found = pvpLeaderboardCharacters(lb.json);
    if (!found.length) {
      notes.push(Array.isArray(lb.json.entries) && lb.json.entries.length
        ? `The first PvP leaderboard of season ${seasonId} answered in a shape Everstats doesn’t read: no character was taken from it.`
        : `The first PvP leaderboard of season ${seasonId} lists no entries.`);
    }
    return found;
  };
  let found = await pvpFrom(PVP_SEASONS);
  if (!found.length) {
    const regions = await ask(`${PVP_REGIONS}/index`);
    if (regions.status !== 200 || !regions.json) {
      notes.push(`Blizzard didn’t give a PvP region index (${how(regions)}).`);
    } else {
      const ids = pvpRegionIds(regions.json).slice(0, MAX_PVP_REGIONS);
      if (!ids.length) notes.push('The PvP region index lists no region in the shape Everstats reads.');
      for (const id of ids) {
        found = await pvpFrom(`${PVP_REGIONS}/${id}/pvp-season`);
        if (found.length) break;
      }
    }
  }
  if (!found.length) notes.push('No leaderboard gave a character. Type one in.');
  return done(found, LEADERBOARD_SOURCES.pvp);
}
