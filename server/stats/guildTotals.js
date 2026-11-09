import { ROLLING_START, periodStart } from './periods.js';

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
 * Rebuilt per guild, whole, by the worker's guild-totals job (worker/jobs.js) when a member changed after the last
 * build (guilds.totals_dirty_at), when the week rolled over, and at least every REBUILD_EVERY_MS, and at once when a
 * member is hidden (crawler/store.js setHidden). A guild page shows when its totals were computed.
 */
export const OVERALL_START = new Date(0);
export const REBUILD_EVERY_MS = 6 * 60 * 60 * 1000;
export const REBUILD_BATCH = 200;

/** The SQL condition for a tracked current member of guild $1 on ruleset $2 (alias c = characters). */
export const TRACKED_MEMBER = `c.guild_id = $1 AND c.ruleset_id = $2 AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden
  AND c.missing_since IS NULL AND c.profile_state = 'ok'`;

export async function rebuildGuildTotals(q, guildId, { now = Date.now } = {}) {
  const started = new Date(now());
  const g = await q.one('SELECT id, ruleset_id FROM guilds WHERE id = $1 FOR UPDATE', [guildId]);
  if (!g) return null;
  await q.query('DELETE FROM guild_totals WHERE guild_id = $1', [guildId]);
  await q.query('DELETE FROM guild_populations WHERE guild_id = $1', [guildId]);
  const week = periodStart('week', started);
  const out = { overall: 0, week: 0, rolling: 0 };
  if (g.ruleset_id !== null) {
    const rs = g.ruleset_id;
    const members = (await q.one(`SELECT count(*)::int AS n FROM characters c WHERE ${TRACKED_MEMBER}`, [guildId, rs])).n;
    out.overall = members;
    if (members > 0) {
      await q.query(
        `INSERT INTO guild_populations (period, period_start, guild_id, ruleset_id, members, computed_at) VALUES ('overall', $3, $1, $2, $4, $5)`,
        [guildId, rs, OVERALL_START, members, started],
      );
      await q.query(
        `INSERT INTO guild_totals (period, period_start, statistic_id, ruleset_id, guild_id, members, total, average, computed_at)
         SELECT 'overall', $3, cs.statistic_id, $2, $1, $4::int, sum(cs.value), sum(cs.value) / $4::int, $5
           FROM characters c JOIN character_statistics cs ON cs.character_id = c.id
          WHERE ${TRACKED_MEMBER} AND cs.ruleset_id = $2 AND NOT cs.hidden AND cs.value > 0
          GROUP BY cs.statistic_id LIMIT 20000`,
        [guildId, rs, OVERALL_START, members, started],
      );
    }
    for (const [period, start] of [['week', week], ['rolling', ROLLING_START]]) {
      const n = (await q.one(
        `SELECT count(*)::int AS n FROM characters c JOIN period_baselines b ON b.character_id = c.id AND b.period = $3 AND b.period_start = $4
          WHERE ${TRACKED_MEMBER}`,
        [guildId, rs, period, start],
      )).n;
      out[period] = n;
      if (!n) continue;
      await q.query(
        `INSERT INTO guild_populations (period, period_start, guild_id, ruleset_id, members, computed_at) VALUES ($3, $4, $1, $2, $5, $6)`,
        [guildId, rs, period, start, n, started],
      );
      await q.query(
        `INSERT INTO guild_totals (period, period_start, statistic_id, ruleset_id, guild_id, members, total, average, computed_at)
         SELECT $3, $4, sg.statistic_id, $2, $1, $5::int, sum(sg.gain), sum(sg.gain) / $5::int, $6
           FROM characters c JOIN stat_gains sg ON sg.character_id = c.id AND sg.period = $3 AND sg.period_start = $4
          WHERE ${TRACKED_MEMBER} AND sg.ruleset_id = $2 AND NOT sg.hidden AND sg.gain > 0
          GROUP BY sg.statistic_id LIMIT 20000`,
        [guildId, rs, period, start, n, started],
      );
    }
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
