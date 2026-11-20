import { ROLLING_START, periodStart } from './periods.js';
import { RESTAMP_DAYS } from './stamp.js';

/**
 * Guild totals (0.5.0): what the guild boards rank. For each guild, statistic and period, the TOTAL of its current
 * tracked members' values (overall) or gains (week, rolling), and the average per counted member. Derived entirely
 * from character_statistics and stat_gains: never an extra Blizzard request.
 *
 *   Current members only: a guild's figure comes from the characters whose own profile names it NOW
 *   (characters.guild_id). A player who leaves takes their numbers with them; their weekly gains count for the guild
 *   they're in now.
 *   Tracked = the same characters the character boards rank: statistics fetched, not hidden, not missing.
 *   Counted members per period (guild_populations): every tracked member (overall); tracked members with a baseline
 *   in the period (week, rolling), the same rule the character period boards use for their population.
 *   Zero is never ranked: a total of 0 has no row.
 *
 * Rebuilt per guild by the worker's guild-totals job (worker/jobs.js) when a member changed after the last build
 * (guilds.totals_dirty_at), when the week rolled over, and at least every REBUILD_EVERY_MS, and at once when a member is
 * hidden (crawler/store.js setHidden). A guild page shows when its totals were computed.
 *
 * 0.11.1, after the production database was found rebuilding guilds all day:
 *   - A guild is marked dirty only when a member's VALUES or gains changed, or it joined, left, came back or went
 *     missing (crawler/store.js, crawler/fetch.js). Before, every daily check marked it, changed or not.
 *   - The safety rebuild of every guild is DAILY (was every 6 hours; the owner's decision, 2026-11-20). Every real
 *     change still marks its guild, so totals are exactly as correct.
 *   - A rebuild writes only the rows that differ (191 million inserts on a 2-million-row table before). A row that
 *     didn't change keeps its computed_at until it is RESTAMP_DAYS old, then is stamped again: the retention sweep
 *     deletes guild totals by computed_at, so the stamp may understate freshness but never lets a row outlive the window.
 *   - The members are read first (through the guild's own index) and the totals summed for exactly those ids. The
 *     one-statement join scanned all of character_statistics for a big guild, and a whole week of gains for any guild.
 */
export const OVERALL_START = new Date(0);
export const REBUILD_EVERY_MS = 24 * 60 * 60 * 1000;
export const REBUILD_BATCH = 200;
const MAX_MEMBERS = 20000;

/** The SQL condition for a tracked current member of guild $1 on ruleset $2 (alias c = characters). */
export const TRACKED_MEMBER = `c.guild_id = $1 AND c.ruleset_id = $2 AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden
  AND c.missing_since IS NULL AND c.profile_state = 'ok'`;

/**
 * One period's totals for a guild, from `fresh` (a SELECT of statistic_id, total for $6 = the member ids): rows that are
 * no longer totals go, rows that are new or differ are written, the rest are left alone.
 * Params: $1 guild, $2 ruleset, $3 period, $4 period start, $5 counted members, $6 member ids, $7 computed at.
 */
const writeTotals = (fresh) => `
  WITH fresh AS (${fresh}),
  gone AS (
    DELETE FROM guild_totals t WHERE t.guild_id = $1 AND t.period = $3 AND t.period_start = $4
       AND NOT EXISTS (SELECT 1 FROM fresh f WHERE f.statistic_id = t.statistic_id) RETURNING 1),
  put AS (
    INSERT INTO guild_totals (period, period_start, statistic_id, ruleset_id, guild_id, members, total, average, computed_at)
    SELECT $3, $4, f.statistic_id, $2, $1, $5::int, f.total, f.total / $5::int, $7 FROM fresh f
    ON CONFLICT (period, period_start, statistic_id, guild_id) DO UPDATE SET ruleset_id = EXCLUDED.ruleset_id, members = EXCLUDED.members,
      total = EXCLUDED.total, average = EXCLUDED.average, computed_at = EXCLUDED.computed_at
     WHERE (guild_totals.ruleset_id, guild_totals.members, guild_totals.total, guild_totals.average)
           IS DISTINCT FROM (EXCLUDED.ruleset_id, EXCLUDED.members, EXCLUDED.total, EXCLUDED.average)
        OR guild_totals.computed_at < EXCLUDED.computed_at - interval '${RESTAMP_DAYS} days'
    RETURNING 1)
  SELECT (SELECT count(*) FROM gone)::int + (SELECT count(*) FROM put)::int AS n`;

const OVERALL_FRESH = `SELECT cs.statistic_id, sum(cs.value) AS total FROM character_statistics cs
   WHERE cs.character_id = ANY($6::bigint[]) AND cs.ruleset_id = $2 AND NOT cs.hidden AND cs.value > 0
   GROUP BY cs.statistic_id LIMIT 20000`;
const GAINS_FRESH = `SELECT sg.statistic_id, sum(sg.gain) AS total FROM stat_gains sg
   WHERE sg.character_id = ANY($6::bigint[]) AND sg.period = $3 AND sg.period_start = $4 AND sg.ruleset_id = $2 AND NOT sg.hidden AND sg.gain > 0
   GROUP BY sg.statistic_id LIMIT 20000`;

export async function rebuildGuildTotals(q, guildId, { now = Date.now } = {}) {
  const started = new Date(now());
  const g = await q.one('SELECT id, ruleset_id FROM guilds WHERE id = $1 FOR UPDATE', [guildId]);
  if (!g) return null;
  const week = periodStart('week', started);
  const periods = [['overall', OVERALL_START], ['week', week], ['rolling', ROLLING_START]];
  const out = { overall: 0, week: 0, rolling: 0, written: 0 };
  // Totals of a week that is over (or of anything but the three current periods) go, as they always did.
  await q.query(
    `DELETE FROM guild_totals WHERE guild_id = $1
        AND NOT ((period = 'overall' AND period_start = $2) OR (period = 'week' AND period_start = $3) OR (period = 'rolling' AND period_start = $4))`,
    [guildId, OVERALL_START, week, ROLLING_START],
  );
  await q.query('DELETE FROM guild_populations WHERE guild_id = $1', [guildId]);
  const rs = g.ruleset_id;
  const ids = rs === null ? [] : (await q.query(`SELECT c.id FROM characters c WHERE ${TRACKED_MEMBER} ORDER BY c.id LIMIT ${MAX_MEMBERS}`, [guildId, rs])).map((r) => Number(r.id));
  for (const [period, start] of periods) {
    // Counted members: every tracked member (overall), or those with a baseline in the period (week, rolling).
    const n = !ids.length ? 0 : period === 'overall' ? ids.length : (await q.one(
      'SELECT count(*)::int AS n FROM period_baselines b WHERE b.character_id = ANY($1::bigint[]) AND b.period = $2 AND b.period_start = $3',
      [ids, period, start],
    )).n;
    out[period] = n;
    if (!n) {
      const gone = await q.query('DELETE FROM guild_totals WHERE guild_id = $1 AND period = $2 AND period_start = $3 RETURNING 1', [guildId, period, start]);
      out.written += gone.length;
      continue;
    }
    await q.query(
      'INSERT INTO guild_populations (period, period_start, guild_id, ruleset_id, members, computed_at) VALUES ($3, $4, $1, $2, $5, $6)',
      [guildId, rs, period, start, n, started],
    );
    const r = await q.one(writeTotals(period === 'overall' ? OVERALL_FRESH : GAINS_FRESH), [guildId, rs, period, start, n, ids, started]);
    out.written += r?.n ?? 0;
  }
  await q.query('UPDATE guilds SET totals_built_at = $2, totals_week_start = $3 WHERE id = $1', [guildId, started, week]);
  return out;
}

/**
 * Guilds whose totals are due: a member changed after the last build, never built, the week rolled over, or older
 * than REBUILD_EVERY_MS. → ids, most urgent first.
 */
export async function dueGuilds(db, { now = Date.now, limit = REBUILD_BATCH } = {}) {
  const rows = await db.query(
    `SELECT id FROM guilds
      WHERE totals_built_at IS NULL OR totals_dirty_at > totals_built_at OR totals_week_start IS DISTINCT FROM $1
         OR totals_built_at < $2
      ORDER BY totals_built_at NULLS FIRST, id LIMIT $3`,
    [periodStart('week', now()), new Date(now() - REBUILD_EVERY_MS), limit],
  );
  return rows.map((r) => r.id);
}

/** Rebuilds every due guild (up to `limit`), each in its own transaction. → how many. */
export async function rebuildDueGuilds(db, { now = Date.now, limit = REBUILD_BATCH } = {}) {
  const ids = await dueGuilds(db, { now, limit });
  for (const id of ids) await db.tx((q) => rebuildGuildTotals(q, id, { now }));
  return ids.length;
}
