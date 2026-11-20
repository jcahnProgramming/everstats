import { getSetting } from '../admin/settings.js';
import { featureOn } from '../features/registry.js';
import { FEATURE_ID } from './distribution.js';
import { guildPeriodStart } from './guildBoards.js';

/**
 * The top of every guild board, precomputed (0.11.1, part of the "Precomputed ranks" switch).
 *
 * The guild badges (guildBadges/rules.js: Board Champion, Top Ten, Weekly Champion) asked, for every guild whose totals
 * had just been rebuilt and for every statistic it has a total for, three counts over that statistic's board: its rank
 * by total, its rank by average, and how many guilds are ranked. The third is the same number for every guild on the
 * board, yet it was recounted per guild, and all three filtered on `members >= N`, which no index holds (measured on
 * production: 3.5 s and 1.9 million buffers for one guild).
 *
 * guild_board_top holds, per guild board (period, realm category, statistic) and mode (total / average), the guilds
 * ranked 1–TOP and how many guilds are ranked on it: one pass over guild_totals with a window, for everyone at once.
 * Ties share a rank (rank() is 1 + the guilds strictly above); zero is never ranked; a guild below `guilds.minMembers`
 * is not ranked and counts in nobody's rank: the guild boards' own rules (stats/guildBoards.js).
 *
 * Rebuilt whole (TRUNCATE + INSERT in one transaction) by the worker's guild-badges job before it evaluates guilds, at
 * most every REBUILD_MIN_MS, and only when some guild's totals were rebuilt since. UNLOGGED: empty after a crash, when
 * the job rebuilds it before its next pass. The guild PAGE's own placements stay a direct count (a guild page is opened
 * about a hundred times a day).
 */
export const TOP = 10;
export const REBUILD_MIN_MS = 5 * 60 * 1000;
const BUILD_TIMEOUT_MS = 60_000;

const ranked = (mode, col) => `
  SELECT period, period_start, ruleset_id, statistic_id, '${mode}' AS mode, guild_id, rnk, ranked FROM (
    SELECT t.period, t.period_start, t.ruleset_id, t.statistic_id, t.guild_id,
           rank() OVER (PARTITION BY t.period, t.period_start, t.ruleset_id, t.statistic_id ORDER BY t.${col} DESC)::int AS rnk,
           count(*) OVER (PARTITION BY t.period, t.period_start, t.ruleset_id, t.statistic_id)::int AS ranked
      FROM guild_totals t
     WHERE t.total > 0 AND t.members >= $1 AND ((t.period = 'overall' AND t.period_start = $2) OR (t.period = 'week' AND t.period_start = $3))) x
   WHERE rnk <= ${TOP}`;

/** Rebuilds guild_board_top for the overall boards and the current week's. → rows written */
export async function buildGuildTop(db, { now = Date.now, minMembers = null } = {}) {
  const min = minMembers ?? await getSetting(db, 'guilds.minMembers');
  return db.tx(async (q) => {
    await q.query(`SET LOCAL statement_timeout = ${BUILD_TIMEOUT_MS}`);
    await q.query("SET LOCAL work_mem = '128MB'");
    await q.query('TRUNCATE guild_board_top');
    const rows = await q.query(
      `INSERT INTO guild_board_top (period, period_start, ruleset_id, statistic_id, mode, guild_id, rank, ranked, min_members, built_at)
       SELECT u.period, u.period_start, u.ruleset_id, u.statistic_id, u.mode, u.guild_id, u.rnk, u.ranked, $1, $4
         FROM (${ranked('total', 'total')} UNION ALL ${ranked('average', 'average')}) u
       RETURNING 1`,
      [min, guildPeriodStart('overall'), guildPeriodStart('week', now), new Date(now())],
    );
    // An empty table can't say when it was built: the marker row of board 0 does (no guild has id 0).
    await q.query(
      `INSERT INTO guild_board_top (period, period_start, ruleset_id, statistic_id, mode, guild_id, rank, ranked, min_members, built_at)
       VALUES ('state', $1, 0, 0, 'total', 0, 0, 0, $2, $3)`,
      [guildPeriodStart('week', now), min, new Date(now())],
    );
    return rows.length;
  });
}

/**
 * Is guild_board_top current enough to read placements from? Rebuilds it when it must and may.
 * → { on: false } (the switch is off: count directly) | { on: true, ready: true } | { on: true, ready: false } (totals
 *   changed since the last build and it is too soon to build again: evaluate those guilds on a later pass)
 */
export async function ensureGuildTop(db, { now = Date.now } = {}) {
  if (!(await featureOn(db, FEATURE_ID))) return { on: false };
  const min = await getSetting(db, 'guilds.minMembers');
  const state = await db.one("SELECT built_at, min_members, period_start FROM guild_board_top WHERE period = 'state' LIMIT 1");
  const newest = (await db.one('SELECT max(totals_built_at) AS t FROM guilds'))?.t ?? null;
  const week = guildPeriodStart('week', now);
  const current = state && state.min_members === min && new Date(state.period_start).getTime() === week.getTime()
    && (!newest || new Date(state.built_at).getTime() >= new Date(newest).getTime());
  if (current) return { on: true, ready: true };
  if (state && state.min_members === min && now() - new Date(state.built_at).getTime() < REBUILD_MIN_MS) return { on: true, ready: false };
  await buildGuildTop(db, { now, minMembers: min });
  return { on: true, ready: true };
}

/**
 * A guild's places in the top of its boards in one period, shaped like guildBadges/rules.js `placements` rows:
 * [{ statistic_id, rank_total, rank_average, ranked }]. A mode in which it is not in the top has rank Infinity.
 */
export async function topPlacements(db, { guildId, rulesetId, period, now = Date.now }) {
  const rows = await db.query(
    `SELECT statistic_id, mode, rank, ranked FROM guild_board_top
      WHERE guild_id = $1 AND period = $2 AND period_start = $3 AND ruleset_id = $4 LIMIT 10000`,
    [guildId, period, guildPeriodStart(period, now), rulesetId],
  );
  const by = new Map();
  for (const r of rows) {
    const id = Number(r.statistic_id);
    if (!by.has(id)) by.set(id, { statistic_id: id, rank_total: Infinity, rank_average: Infinity, ranked: r.ranked });
    by.get(id)[r.mode === 'total' ? 'rank_total' : 'rank_average'] = r.rank;
  }
  return [...by.values()];
}
