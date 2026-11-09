import { BLIZZARD, OLDEST } from './registry.js';
import { retentionPolicy } from './policy.js';

/**
 * The retention sweep: deletes every piece of Blizzard data last fetched before the cutoff (policy.js: 29 days for a
 * 30-day window), table by table, in registry order, then rebuilds the discovery catalog if a run went, prunes old
 * backups (worker only: it holds the backup folder) and records what it did (retention_sweeps).
 *
 * It runs every hour in BOTH the web app and the worker (whichever gets the advisory lock first), so a stopped worker
 * doesn't stop the sweep. A table that fails is recorded and the others still run.
 */
const LOCK_KEY = 4_812_030;
export const SWEEP_EVERY_MS = 60 * 60 * 1000;

export async function runRetentionSweep(db, { processName = 'web', now = Date.now, pruneBackups = null, log = console } = {}) {
  return db.withClient(async (q) => {
    const got = await q.one('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!got.ok) return { skipped: 'another process is sweeping' };
    try {
      const policy = await retentionPolicy(q, now());
      const row = await q.one('INSERT INTO retention_sweeps (process, window_days, cutoff) VALUES ($1, $2, $3) RETURNING id', [processName, policy.windowDays, policy.cutoff]);
      const deleted = {};
      const problems = [];
      const ctx = { query: q.query, one: q.one, rebuildCombined: false };
      for (const entry of BLIZZARD) {
        try {
          await q.query('BEGIN');
          deleted[entry.table] = await entry.sweep(ctx, policy.cutoff);
          await q.query('COMMIT');
        } catch (err) {
          await q.query('ROLLBACK').catch(() => {});
          problems.push(`${entry.table}: ${err.code ?? err.name}`);
        }
      }
      if (ctx.rebuildCombined) {
        try {
          const { analyseCombined } = await import('../discovery/run.js');
          await analyseCombined(db); // it opens its own transaction
        } catch (err) {
          problems.push(`discovery_catalog: ${err.code ?? err.name}`);
        }
      }
      if (pruneBackups) {
        try {
          deleted.backups = await pruneBackups(policy);
        } catch (err) {
          problems.push(`backups: ${err.code ?? err.name}`);
        }
      }
      const oldest = {};
      for (const [label, sql] of OLDEST) oldest[label] = (await q.one(sql))?.t ?? null;
      const problem = problems.length ? problems.join('; ').slice(0, 300) : null;
      if (problem) log.error(`[retention] sweep problems: ${problem}`);
      await q.query('UPDATE retention_sweeps SET finished_at = now(), deleted = $2::jsonb, oldest = $3::jsonb, problem = $4 WHERE id = $1', [row.id, JSON.stringify(deleted), JSON.stringify(oldest), problem]);
      return { deleted, oldest, problem, cutoff: policy.cutoff };
    } finally {
      await q.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  });
}

/** For the admin page: the policy, the last finished sweep, and the oldest Blizzard data now. */
export async function retentionStatus(db) {
  const policy = await retentionPolicy(db);
  const last = await db.one('SELECT started_at, finished_at, process, deleted, oldest, problem FROM retention_sweeps WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1');
  const oldest = {};
  for (const [label, sql] of OLDEST) oldest[label] = (await db.one(sql))?.t ?? null;
  const times = Object.values(oldest).filter(Boolean).map((t) => new Date(t).getTime());
  const oldestAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
  return {
    windowDays: policy.windowDays,
    keepDays: policy.keepDays,
    backups: policy.backups,
    safetyDays: policy.safetyDays,
    permission: policy.permission,
    cutoff: policy.cutoff,
    lastSweep: last ? { at: last.finished_at, process: last.process, deleted: last.deleted, problem: last.problem } : null,
    oldest,
    oldestAt,
  };
}
