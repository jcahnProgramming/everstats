import { pageLimit } from '../core/db.js';
import { periodStart } from './periods.js';

/**
 * Leaderboards: one per statistic per ruleset, in three periods.
 *
 *   overall  the statistic's value (character_statistics)
 *   week     what was GAINED since the character's first snapshot this week (stat_gains)
 *   month    the same for the calendar month
 *
 * A character Blizzard lists no value for has zero, and zero is never stored as a ranked row: the boards list the
 * characters above zero, and everyone at zero shares the next rank ("tied at #n"). Ties share a rank: a character's
 * rank is 1 + the number of visible characters with a strictly higher value. Hidden characters are on no board and
 * count toward no population.
 *
 * Every count repeats the partial index predicate (value > 0, NOT hidden) so the planner can use the index: without
 * it, a rank count was a sequential scan (measured 0.7 s per page at 10,000 characters, scripts/measure-boards.js).
 * Every list is cursor-paginated (value, character id) through the partial indexes character_statistics_board and
 * stat_gains_board. Nothing is cached: a rank and its "of N" are always counted at the same moment (0.4.0 found a
 * cached population disagreeing with a live rank: "#2 of 1").
 */
const SOURCES = {
  overall: { table: 'character_statistics', col: 'value', where: '' },
  week: { table: 'stat_gains', col: 'gain', where: "AND period = 'week' AND period_start = $3" },
  month: { table: 'stat_gains', col: 'gain', where: "AND period = 'month' AND period_start = $3" },
};
export const BOARD_PERIODS = Object.keys(SOURCES);

const startOf = (period, now) => (period === 'overall' ? null : periodStart(period, now()));
const params = (period, now, ...rest) => (period === 'overall' ? rest : [...rest, startOf(period, now)]);

/** Tracked characters on a ruleset (overall), or with a baseline in the current period. */
export async function populationOf(db, rulesetId, period = 'overall', { now = Date.now } = {}) {
  if (period === 'overall') {
    return (await db.one('SELECT count(*)::int AS n FROM characters WHERE ruleset_id = $1 AND stats_fetched_at IS NOT NULL AND NOT hidden', [rulesetId])).n;
  }
  return (await db.one('SELECT count(*)::int AS n FROM period_baselines WHERE period = $1 AND period_start = $2 AND ruleset_id = $3 AND NOT hidden', [period, startOf(period, now), rulesetId])).n;
}

/** Every board of one ruleset and period: { population, byStat: Map(statId → { nonzero, max, min }) } above zero. */
export async function boardCounts(db, rulesetId, period = 'overall', { now = Date.now } = {}) {
  const s = SOURCES[period];
  const rows = await db.query(
    `SELECT statistic_id, count(*)::int AS nonzero, max(${s.col}) AS max, min(${s.col}) AS min
       FROM ${s.table} WHERE ruleset_id = $1 AND NOT hidden AND ${s.col} > 0 ${s.where.replace('$3', '$2')}
      GROUP BY statistic_id LIMIT 20000`,
    period === 'overall' ? [rulesetId] : [rulesetId, startOf(period, now)],
  );
  return { population: await populationOf(db, rulesetId, period, { now }), byStat: new Map(rows.map((r) => [r.statistic_id, { nonzero: r.nonzero, max: r.max, min: r.min }])) };
}

/** One board: { population, nonzero, max, min }. An index range, not the whole ruleset. */
export async function statCounts(db, { statisticId, rulesetId, period = 'overall', now = Date.now }) {
  const s = SOURCES[period];
  const row = await db.one(
    `SELECT count(*)::int AS nonzero, max(${s.col}) AS max, min(${s.col}) AS min FROM ${s.table}
      WHERE statistic_id = $1 AND ruleset_id = $2 AND NOT hidden AND ${s.col} > 0 ${s.where}`,
    params(period, now, statisticId, rulesetId),
  );
  return { population: await populationOf(db, rulesetId, period, { now }), nonzero: row.nonzero, max: row.max, min: row.min };
}

/** "Everyone's tied": every tracked character on the board has the same value (all zero, or all the same number). */
export function everyoneTied(population, c) {
  if (population < 1) return false;
  if (!c || c.nonzero === 0) return true;
  return c.nonzero === population && c.min === c.max;
}

const encodeCursor = (v, id) => Buffer.from(JSON.stringify([v, id])).toString('base64url');
function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  try {
    const [v, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Number.isFinite(v) && Number.isSafeInteger(id) ? { v, id } : null;
  } catch {
    return null;
  }
}

/**
 * One page of a board: rows above zero, best first, with shared ranks.
 *   → { rows: [{ rank, characterId, value, text }], next: cursor | null }
 */
export async function boardPage(db, { statisticId, rulesetId, period = 'overall', cursor = null, limit: rawLimit, now = Date.now }) {
  const s = SOURCES[period];
  const limit = pageLimit(rawLimit, { fallback: 25, max: 100 });
  const c = decodeCursor(cursor);
  const textCol = period === 'overall' ? 'text' : 'NULL::text AS text';
  const extra = s.where;
  const base = params(period, now, statisticId, rulesetId);
  const n = base.length;
  const rows = await db.query(
    `SELECT character_id, ${s.col} AS value, ${textCol} FROM ${s.table}
      WHERE statistic_id = $1 AND ruleset_id = $2 AND NOT hidden AND ${s.col} > 0 ${extra}
        AND ($${n + 1}::float8 IS NULL OR ${s.col} < $${n + 1} OR (${s.col} = $${n + 1} AND character_id > $${n + 2}))
      ORDER BY ${s.col} DESC, character_id LIMIT $${n + 3}`,
    [...base, c?.v ?? null, c?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const ranks = await ranksFor(db, { statisticId, rulesetId, period, values: [...new Set(page.map((r) => r.value))], now });
  return {
    rows: page.map((r) => ({ rank: ranks.get(r.value), characterId: r.character_id, value: r.value, text: r.text })),
    next: rows.length > limit ? encodeCursor(page.at(-1).value, page.at(-1).character_id) : null,
  };
}

/** Map(value → rank) on one board: 1 + the visible characters strictly above each value. */
export async function ranksFor(db, { statisticId, rulesetId, period = 'overall', values, now = Date.now }) {
  const out = new Map();
  if (!values.length) return out;
  const s = SOURCES[period];
  const base = params(period, now, statisticId, rulesetId);
  const rows = await db.query(
    `SELECT v.value, (SELECT count(*)::int FROM ${s.table} o
                       WHERE o.statistic_id = $1 AND o.ruleset_id = $2 AND NOT o.hidden AND o.${s.col} > 0 AND o.${s.col} > v.value ${s.where.replace(/period/g, 'o.period')}) + 1 AS rank
       FROM unnest($${base.length + 1}::float8[]) AS v(value)`,
    [...base, values],
  );
  for (const r of rows) out.set(r.value, r.rank);
  return out;
}

/**
 * A character's overall rank on every board of its ruleset, for the character page: Map(statId → { value, text,
 * updatedAt, rank }) for the statistics it has. A statistic it doesn't have (zero) ranks nonzero + 1, from boardCounts.
 */
export async function characterRanks(db, characterId, rulesetId) {
  const rows = await db.query(
    `SELECT cs.statistic_id, cs.value, cs.text, cs.blizzard_updated_at, cs.fetched_at,
            CASE WHEN cs.value > 0 THEN (SELECT count(*)::int FROM character_statistics o
                                          WHERE o.statistic_id = cs.statistic_id AND o.ruleset_id = $2 AND NOT o.hidden AND o.value > 0 AND o.value > cs.value) + 1 END AS rank
       FROM character_statistics cs WHERE cs.character_id = $1 LIMIT 5000`,
    [characterId, rulesetId],
  );
  return new Map(rows.map((r) => [r.statistic_id, { value: r.value, text: r.text, updatedAt: r.blizzard_updated_at, fetchedAt: r.fetched_at, rank: r.rank }]));
}

/** A character's rank on one board ({ value, rank, population }), for pins and "your characters on this board". */
export async function rankOn(db, { characterId, statisticId, rulesetId, period = 'overall', now = Date.now }) {
  const s = SOURCES[period];
  const base = params(period, now, statisticId, characterId);
  const row = await db.one(`SELECT ${s.col} AS value FROM ${s.table} WHERE statistic_id = $1 AND character_id = $2 ${s.where}`, base);
  const value = row?.value ?? 0;
  const counts = await statCounts(db, { statisticId, rulesetId, period, now });
  const rank = value > 0 ? (await ranksFor(db, { statisticId, rulesetId, period, values: [value], now })).get(value) : counts.nonzero + 1;
  return { value, rank, population: counts.population };
}
