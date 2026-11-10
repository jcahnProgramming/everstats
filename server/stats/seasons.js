import { versionById } from '../core/gameVersions.js';

/**
 * SEASON BOARDS (0.11.1, owner's decision 5). On a version that has them (core/gameVersions.js `seasons`: World of
 * Warcraft), a full character fetch also asks for:
 *
 *   Mythic+    {character}/mythic-keystone-profile/season/{id}, where {id} is `current_season` from
 *              /data/wow/mythic-keystone/season/index (read once a day). → the season's rating and the highest keystone
 *              level among its best runs.
 *   PvP        {character}/pvp-bracket/{2v2 | 3v3 | rbg} → the bracket's rating and the season's games played and won.
 *              The season id is the one the answer itself names.
 *
 * Shapes as probe #7 stored them (Retail, 2026-11-10):
 *   season index  { seasons: [{ id }], current_season: { id } }
 *   M+ season     { season: { id }, mythic_rating: { rating, color }, best_runs: [{ keystone_level, dungeon, … }] }
 *   pvp-bracket   { rating, season: { id }, bracket: { type }, season_match_statistics: { played, won, lost }, … }
 *   A character with nothing in a season or bracket answers 404: no value, no row (zero is never ranked).
 *   A retired season answers 403 (pvp-season/22), so only what `current_season` and the bracket's own answer name is
 *   ever asked: nothing here lists or guesses a season id.
 *
 * Every board is a derived statistic keyed BY SEASON ID:
 *   season:mplus:{seasonId}:rating | best_level        season:pvp:{seasonId}:{bracket}:rating | played | won
 * so a new season makes new boards the first time a character has a value in it, and the old season's boards empty as
 * characters are refetched and age out with the 29-day window like every Blizzard-derived name and value.
 *
 * Solo Shuffle and Blitz are NOT here: their bracket names (shuffle-{class}-{spec}) only come from a character's
 * pvp-summary links, and probe #7's pvp-summary listed no brackets, so there is nothing yet to read them from.
 */
export const SEASON_PREFIX = 'season:';
export const SEASON_GROUP = 'Season ratings';
const BRACKET_LABELS = { '2v2': '2v2', '3v3': '3v3', rbg: 'Rated battlegrounds' };
const bracketLabel = (b) => BRACKET_LABELS[b] ?? b;
const DAY_MS = 24 * 60 * 60 * 1000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const seasonIdOf = (v) => (isObj(v) && Number.isSafeInteger(v.id) && v.id > 0 ? v.id : null);
const num = (v) => (Number.isFinite(v) ? v : null);

/** season/index → the current season's id, or null when Blizzard names none. */
export const currentSeasonOf = (json) => seasonIdOf(json?.current_season);

/** A Mythic+ season answer → [{ key, name, value }] (values above zero only). */
export function mythicEntries(json) {
  const id = seasonIdOf(json?.season);
  if (!id) return [];
  const rating = num(json?.mythic_rating?.rating);
  const levels = (Array.isArray(json?.best_runs) ? json.best_runs : []).map((r) => num(r?.keystone_level)).filter((x) => x !== null);
  const best = levels.length ? Math.max(...levels) : null;
  return [
    { key: `${SEASON_PREFIX}mplus:${id}:rating`, name: `Mythic+ rating (season ${id})`, value: rating },
    { key: `${SEASON_PREFIX}mplus:${id}:best_level`, name: `Mythic+ highest key level (season ${id})`, value: best },
  ].filter((e) => e.value !== null && e.value > 0);
}

/** A pvp-bracket answer → [{ key, name, value }]. `bracket` is the one asked for (the path), never read from text. */
export function bracketEntries(bracket, json) {
  const id = seasonIdOf(json?.season);
  if (!id || !/^[a-z0-9]{2,12}$/.test(bracket)) return [];
  const s = isObj(json?.season_match_statistics) ? json.season_match_statistics : {};
  const label = bracketLabel(bracket);
  return [
    { key: `${SEASON_PREFIX}pvp:${id}:${bracket}:rating`, name: `PvP ${label} rating (season ${id})`, value: num(json?.rating) },
    { key: `${SEASON_PREFIX}pvp:${id}:${bracket}:played`, name: `PvP ${label} games played (season ${id})`, value: num(s.played) },
    { key: `${SEASON_PREFIX}pvp:${id}:${bracket}:won`, name: `PvP ${label} games won (season ${id})`, value: num(s.won) },
  ].filter((e) => e.value !== null && e.value > 0);
}

/** How many requests a full fetch adds on this version (the cost shown on the admin page and in the notes). */
export function seasonRequests(versionId) {
  const s = versionById(versionId)?.seasons;
  return s ? (s.mythicPlus ? 1 : 0) + (s.pvpBrackets?.length ?? 0) : 0;
}

// The current Mythic+ season per (database, version, region), re-read daily.
const seasonCache = new WeakMap();
async function currentSeason({ db, client }, { scope, ctx }, priority) {
  if (!seasonCache.has(db)) seasonCache.set(db, new Map());
  const cache = seasonCache.get(db);
  const k = `${scope.version}/${scope.region}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.id;
  const r = await client.request('mythic-season-index', ctx.paths.mythicSeasons, { priority, namespace: ctx.namespaces.dynamic, version: scope.version, region: scope.region });
  if (r.status !== 200 || !r.json) return hit?.id ?? null; // not answered: the last known one, else none this time
  const id = currentSeasonOf(r.json);
  cache.set(k, { at: Date.now(), id });
  return id;
}

const answered = (r) => r && (r.status === 200 || r.status === 404);

/**
 * Asks Blizzard for the character's season numbers. → { parts: [{ like, entries }] }: each part that ANSWERED (200, or
 * 404 = nothing there), with the SQL LIKE pattern of the keys it owns; a part Blizzard didn't answer is left out, so its
 * old values stay. Never throws for a season request: the character's fetch doesn't fail over it.
 */
export async function fetchSeasons({ db, client }, { scope, ctx, base, priority }) {
  const cfg = versionById(scope.version)?.seasons;
  if (!cfg) return { parts: [] };
  const ask = (endpoint, path) => client.request(endpoint, path, { priority, namespace: ctx.namespaces.profile, version: scope.version, region: scope.region })
    .catch(() => null);
  const parts = [];
  const jobs = [];
  if (cfg.mythicPlus) {
    jobs.push((async () => {
      const id = await currentSeason({ db, client }, { scope, ctx }, priority).catch(() => null);
      if (!id) return;
      const r = await ask('mythic-keystone-season', `${base}/mythic-keystone-profile/season/${id}`);
      if (answered(r)) parts.push({ like: `${SEASON_PREFIX}mplus:%`, entries: r.status === 200 ? mythicEntries(r.json) : [] });
    })());
  }
  for (const b of cfg.pvpBrackets ?? []) {
    jobs.push((async () => {
      const r = await ask('pvp-bracket', `${base}/pvp-bracket/${b}`);
      if (answered(r)) parts.push({ like: `${SEASON_PREFIX}pvp:%:${b}:%`, entries: r.status === 200 ? bracketEntries(b, r.json) : [] });
    })());
  }
  await Promise.all(jobs);
  return { parts };
}

/** Writes what fetchSeasons brought back: each answered part replaces the character's values for the keys it owns. */
export async function storeSeasons(q, characterId, { parts }, { fetchedAt = new Date() } = {}) {
  if (!parts.length) return 0;
  const ch = await q.one('SELECT ruleset_id, hidden, game_version FROM characters WHERE id = $1', [characterId]);
  if (!ch || ch.ruleset_id === null) return 0;
  const { ensureDerivedId } = await import('../collections/store.js');
  let written = 0;
  for (const part of parts) {
    const keep = [];
    for (const e of part.entries) {
      const id = await ensureDerivedId(q, { key: e.key, name: e.name, version: ch.game_version, category: SEASON_GROUP });
      await q.query(
        `INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, hidden, value, text, blizzard_updated_at, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
         ON CONFLICT (character_id, statistic_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, hidden = EXCLUDED.hidden, value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at`,
        [characterId, id, ch.ruleset_id, ch.hidden, e.value, fetchedAt],
      );
      keep.push(id);
      written += 1;
    }
    // Nothing in this season or bracket now (or a new season began): the old rows leave the boards.
    await q.query(
      `DELETE FROM character_statistics cs USING statistics s
        WHERE cs.character_id = $1 AND s.id = cs.statistic_id AND s.derived LIKE $2 AND NOT (cs.statistic_id = ANY($3::bigint[]))`,
      [characterId, part.like, keep],
    );
  }
  return written;
}

/** A derived key → { kind: 'mplus' | 'pvp', seasonId, bracket?, field } or null: for pages that group season boards. */
export function seasonOfKey(key) {
  const m = /^season:(mplus):(\d+):([a-z_]+)$/.exec(String(key ?? '')) ?? /^season:(pvp):(\d+):([a-z0-9]+):([a-z_]+)$/.exec(String(key ?? ''));
  if (!m) return null;
  return m[1] === 'mplus' ? { kind: 'mplus', seasonId: Number(m[2]), bracket: null, field: m[3] } : { kind: 'pvp', seasonId: Number(m[2]), bracket: m[3], bracketLabel: bracketLabel(m[3]), field: m[4] };
}
