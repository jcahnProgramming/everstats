import { pageLimit } from '../core/db.js';
import { ROLLING_START, periodStart } from './periods.js';
import { OVERALL_START } from './guildTotals.js';

/**
 * Guild boards (0.5.0): one per statistic per ruleset, guilds ranked by the TOTAL of their current tracked members, or
 * by the AVERAGE per counted member, in the same three periods as the character boards. Read from guild_totals
 * (stats/guildTotals.js), never computed per request.
 *
 * The same rules as the character boards (stats/boards.js):
 *   zero is never ranked (a total of 0 has no row), ties share a rank (1 + ranked guilds strictly above), every count
 *   is made at the same moment as the rank it goes with, every list is cursor-paginated.
 * And one of their own: a guild is RANKED only with at least `minMembers` counted members (admin setting
 * guilds.minMembers, default 5). A guild below that is "Not ranked yet": listed apart, never given a rank, and never
 * counted in another guild's rank.
 */
export const GUILD_MODES = Object.freeze(['total', 'average']);
const COL = { total: 'total', average: 'average' };

export const guildPeriodStart = (period, now = Date.now) => (period === 'overall' ? OVERALL_START : period === 'rolling' ? ROLLING_START : periodStart('week', now()));

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
 * One board's counts: { ranked (guilds ranked, i.e. above zero with enough members), notYet (above zero but too few
 * members), population (guilds on the ruleset with enough counted members), min, max }.
 */
export async function guildStatCounts(db, { statisticId, rulesetId, period = 'overall', mode = 'total', minMembers, now = Date.now }) {
  const col = COL[mode];
  const start = guildPeriodStart(period, now);
  const row = await db.one(
    `SELECT count(*) FILTER (WHERE members >= $5)::int AS ranked, count(*) FILTER (WHERE members < $5)::int AS not_yet,
            max(${col}) FILTER (WHERE members >= $5) AS max, min(${col}) FILTER (WHERE members >= $5) AS min
       FROM guild_totals WHERE period = $1 AND period_start = $2 AND statistic_id = $3 AND ruleset_id = $4 AND total > 0`,
    [period, start, statisticId, rulesetId, minMembers],
  );
  const pop = await db.one(
    'SELECT count(*)::int AS n FROM guild_populations WHERE period = $1 AND period_start = $2 AND ruleset_id = $3 AND members >= $4',
    [period, start, rulesetId, minMembers],
  );
  return { ranked: row.ranked, notYet: row.not_yet, population: pop.n, min: row.min, max: row.max };
}

/** Map(value → rank) among ranked guilds on one board. */
export async function guildRanksFor(db, { statisticId, rulesetId, period = 'overall', mode = 'total', minMembers, values, now = Date.now }) {
  const out = new Map();
  if (!values.length) return out;
  const col = COL[mode];
  const rows = await db.query(
    `SELECT v.value, (SELECT count(*)::int FROM guild_totals o
                       WHERE o.period = $1 AND o.period_start = $2 AND o.statistic_id = $3 AND o.ruleset_id = $4 AND o.total > 0
                         AND o.members >= $5 AND o.${col} > v.value) + 1 AS rank
       FROM unnest($6::float8[]) AS v(value)`,
    [period, guildPeriodStart(period, now), statisticId, rulesetId, minMembers, values],
  );
  for (const r of rows) out.set(r.value, r.rank);
  return out;
}

/** One page of a guild board: ranked guilds, best first. → { rows: [{ rank, guildId, value, total, average, members }], next } */
export async function guildBoardPage(db, { statisticId, rulesetId, period = 'overall', mode = 'total', minMembers, cursor = null, limit: rawLimit, now = Date.now }) {
  const col = COL[mode];
  const limit = pageLimit(rawLimit, { fallback: 25, max: 100 });
  const c = decodeCursor(cursor);
  const rows = await db.query(
    `SELECT guild_id, total, average, members, ${col} AS value FROM guild_totals
      WHERE period = $1 AND period_start = $2 AND statistic_id = $3 AND ruleset_id = $4 AND total > 0 AND members >= $5
        AND ($6::float8 IS NULL OR ${col} < $6 OR (${col} = $6 AND guild_id > $7))
      ORDER BY ${col} DESC, guild_id LIMIT $8`,
    [period, guildPeriodStart(period, now), statisticId, rulesetId, minMembers, c?.v ?? null, c?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const ranks = await guildRanksFor(db, { statisticId, rulesetId, period, mode, minMembers, values: [...new Set(page.map((r) => r.value))], now });
  return {
    rows: page.map((r) => ({ rank: ranks.get(r.value), guildId: r.guild_id, value: r.value, total: r.total, average: r.average, members: r.members })),
    next: rows.length > limit ? encodeCursor(page.at(-1).value, page.at(-1).guild_id) : null,
  };
}

/** Guilds above zero on a board but below the member minimum: "Not ranked yet". Largest first, bounded. */
export async function guildsNotYetRanked(db, { statisticId, rulesetId, period = 'overall', minMembers, limit = 20, now = Date.now }) {
  return db.query(
    `SELECT guild_id, total, average, members FROM guild_totals
      WHERE period = $1 AND period_start = $2 AND statistic_id = $3 AND ruleset_id = $4 AND total > 0 AND members < $5
      ORDER BY members DESC, total DESC, guild_id LIMIT $6`,
    [period, guildPeriodStart(period, now), statisticId, rulesetId, minMembers, Math.min(limit, 100)],
  );
}

/**
 * A guild's own placements on every board of its ruleset (overall period), in both modes: [{ statisticId, mode, rank,
 * ranked (how many guilds are ranked on that board), value }]. Empty when the guild isn't ranked (too few members).
 */
export async function guildPlacements(db, { guildId, rulesetId, minMembers }) {
  const rows = await db.query(
    `SELECT t.statistic_id, t.total, t.average, t.members,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = 'overall' AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4 AND o.total > t.total) + 1 AS rank_total,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = 'overall' AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4 AND o.average > t.average) + 1 AS rank_average,
            (SELECT count(*)::int FROM guild_totals o WHERE o.period = 'overall' AND o.period_start = $3 AND o.statistic_id = t.statistic_id
               AND o.ruleset_id = $2 AND o.total > 0 AND o.members >= $4) AS ranked
       FROM guild_totals t
      WHERE t.guild_id = $1 AND t.period = 'overall' AND t.period_start = $3 AND t.ruleset_id = $2 AND t.total > 0 AND t.members >= $4
      LIMIT 5000`,
    [guildId, rulesetId, OVERALL_START, minMembers],
  );
  return rows;
}

/** Top `n` ranked guilds by total on every board of a ruleset (the leaderboards index, Guilds view). */
export async function guildTops(db, { statisticIds, rulesetId, minMembers, n = 3 }) {
  if (!statisticIds.length) return [];
  return db.query(
    `SELECT s.id AS statistic_id, t.guild_id, t.total, t.members FROM unnest($1::bigint[]) AS s(id)
      CROSS JOIN LATERAL (SELECT guild_id, total, members FROM guild_totals
                           WHERE period = 'overall' AND period_start = $3 AND statistic_id = s.id AND ruleset_id = $2 AND total > 0 AND members >= $4
                           ORDER BY total DESC, guild_id LIMIT $5) t LIMIT 20000`,
    [statisticIds, rulesetId, OVERALL_START, minMembers, n],
  );
}

/** Every board of a ruleset (overall): Map(statId → { ranked, notYet, min, max }) by total. */
export async function guildBoardCounts(db, { rulesetId, minMembers }) {
  const rows = await db.query(
    `SELECT statistic_id, count(*) FILTER (WHERE members >= $3)::int AS ranked, count(*) FILTER (WHERE members < $3)::int AS not_yet,
            max(total) FILTER (WHERE members >= $3) AS max, min(total) FILTER (WHERE members >= $3) AS min
       FROM guild_totals WHERE period = 'overall' AND period_start = $2 AND ruleset_id = $1 AND total > 0
      GROUP BY statistic_id LIMIT 20000`,
    [rulesetId, OVERALL_START, minMembers],
  );
  return new Map(rows.map((r) => [r.statistic_id, { ranked: r.ranked, notYet: r.not_yet, min: r.min, max: r.max }]));
}

/** "Everyone's tied": two or more ranked guilds, all with the same value. */
export const guildsTied = (c) => Boolean(c) && c.ranked >= 2 && c.min === c.max;
