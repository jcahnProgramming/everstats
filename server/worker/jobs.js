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

export const JOBS = Object.freeze([backupJob()]);
