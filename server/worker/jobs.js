import { config } from '../core/config.js';
import { BACKUP_HOUR_UTC, isDue, listBackups, recordedBackup } from '../core/backup.js';

/**
 * The worker's job registry. Each background job declares itself here; the loop (worker/loop.js) runs whatever is
 * listed, reports each one's last run in its health and in worker_status, and never needs editing to add one.
 *
 *   { id, label, everyMs, run({ db, now }) → { summary } }
 *
 * A job's run() must return quickly: the loop's heartbeat waits for it, and a heartbeat older than 3 minutes shows
 * the worker as "Not responding". Long work (a backup) is started in the background and reported on.
 *
 * Coming (each after the discovery pass): the daily re-sync of every tracked character, guild-roster seeding, the
 * on-search refresh queue, daily snapshots, tier recomputation per ruleset.
 */

/**
 * Nightly database backup (core/backup.js). Checks every 5 minutes whether one is due (after 04:00 UTC with no file
 * for today yet, or a missed night, and no failure in the last hour), then starts pg_dump without waiting for it.
 */
export function backupJob({ dir = config.backupDir, databaseUrl = config.databaseUrl, exec, log = console } = {}) {
  let running = null;
  return {
    id: 'backup',
    label: 'Nightly database backup',
    everyMs: 5 * 60 * 1000,
    async run({ db, now = Date.now }) {
      if (!dir) return { summary: 'Off: BACKUP_DIR is not set' };
      if (running) return { summary: 'Backup in progress' };
      const lastFailure = await db.one("SELECT finished_at FROM backup_runs WHERE outcome = 'failed' AND trigger = 'nightly' ORDER BY started_at DESC LIMIT 1");
      let backups;
      try {
        backups = listBackups(dir);
      } catch (err) {
        // The folder itself is unreadable: record it like any failed backup, so the admin page and health say so.
        if (!lastFailure || now() - Date.parse(lastFailure.finished_at) > 60 * 60 * 1000) {
          await recordedBackup({ db, dir, databaseUrl, trigger: 'nightly', now, exec, log });
        }
        return { summary: `Backup folder unreadable (${err.code ?? err.name})` };
      }
      if (!isDue({ now: now(), backups, lastFailureAt: lastFailure?.finished_at?.toISOString?.() ?? null })) {
        return { summary: `Next after ${String(BACKUP_HOUR_UTC).padStart(2, '0')}:00 UTC` };
      }
      running = recordedBackup({ db, dir, databaseUrl, trigger: 'nightly', now, exec, log }).finally(() => {
        running = null;
      });
      return { summary: 'Backup started' };
    },
    /** For tests and shutdown: the backup in flight, if any. */
    inFlight: () => running,
  };
}

/**
 * Discovery runs (discovery/run.js). The admin page queues one; this claims the oldest queued run and runs it in the
 * background (a run is ~27 requests a character, paced). One at a time. A run left 'running' whose heartbeat is
 * older than STALE_RUN_MS belonged to a worker that stopped (a deploy, a crash): it is marked interrupted, never
 * left looking like it's running.
 */
export const STALE_RUN_MS = 5 * 60 * 1000;

export function discoveryJob({ fetch = globalThis.fetch, sleep } = {}) {
  let running = null;
  return {
    id: 'discovery',
    label: 'Blizzard API discovery runs',
    everyMs: 10_000,
    async run({ db }) {
      if (running) return { summary: `Discovery run #${running.id} in progress` };
      await db.query(
        `UPDATE discovery_runs SET status = 'interrupted', finished_at = now(), problem = 'The worker stopped during this run (a restart or deploy). Start a new one.'
          WHERE status = 'running' AND coalesce(heartbeat_at, started_at) < now() - ($1 || ' milliseconds')::interval`,
        [String(STALE_RUN_MS)],
      );
      const claimed = await db.one(
        `UPDATE discovery_runs SET status = 'running', started_at = now(), heartbeat_at = now()
          WHERE id = (SELECT id FROM discovery_runs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
            AND NOT EXISTS (SELECT 1 FROM discovery_runs WHERE status = 'running')
          RETURNING id`,
      );
      if (!claimed) return { summary: 'Nothing queued' };
      const { executeRun } = await import('../discovery/run.js');
      running = { id: claimed.id, done: executeRun({ db, runId: claimed.id, fetch, sleep }).finally(() => { running = null; }) };
      return { summary: `Started discovery run #${claimed.id}` };
    },
    inFlight: () => running?.done ?? null,
  };
}

export const JOBS = Object.freeze([backupJob(), discoveryJob()]);
