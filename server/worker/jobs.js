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
 * The crawler itself (crawler/service.js) runs continuously beside the loop, not as a job: the jobs below only queue
 * work for it (the daily refresh) or use its client (rulesets). Coming: tier recomputation per ruleset.
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

/**
 * The daily refresh: every 5 minutes, queue a 'check' of every tracked character not checked in the last day
 * (oldest first, up to REFRESH_BATCH at a time). A check is one request when the character hasn't logged in since its
 * last full fetch. Paused with the background crawl.
 */
export const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
export const REFRESH_BATCH = 2000;

export function refreshJob() {
  return {
    id: 'refresh',
    label: 'Daily refresh of tracked characters',
    everyMs: 5 * 60 * 1000,
    async run({ db }) {
      const { getSetting } = await import('../admin/settings.js');
      if (await getSetting(db, 'crawler.paused')) return { summary: 'Paused' };
      const { PRIORITY, enqueueMany } = await import('../crawler/queue.js');
      const due = await db.query(
        `SELECT slug FROM characters WHERE slug IS NOT NULL AND (last_checked_at IS NULL OR last_checked_at < now() - ($1 || ' milliseconds')::interval)
          ORDER BY last_checked_at NULLS FIRST, id LIMIT $2`,
        [String(REFRESH_EVERY_MS), REFRESH_BATCH],
      );
      const n = await enqueueMany(db, due.map((c) => ({ key: c.slug, mode: 'check', priority: PRIORITY.daily })));
      return { summary: n ? `Queued ${n} for their daily check` : 'Every tracked character checked in the last day' };
    },
  };
}

/** Rulesets from Blizzard's index, every 6 hours (a new ruleset, like Hardcore, just appears). */
export function rulesetsJob({ crawler }) {
  return {
    id: 'rulesets',
    label: 'Rulesets from Blizzard',
    everyMs: 6 * 60 * 60 * 1000,
    async run({ db }) {
      const { fetchRulesets } = await import('../crawler/fetch.js');
      try {
        const n = await fetchRulesets({ db, client: crawler.client });
        return { summary: `${n} ruleset(s) listed` };
      } catch (err) {
        return { summary: `Not read: ${err.message ?? err.name}` };
      }
    },
  };
}

/**
 * Once a day, each owned character's rank on each of its owner's pinned boards (pin_rank_history), so the dashboard
 * can show rank movement since last week. Runs in the background (bounded batches); one row per character, statistic
 * and day.
 */
export function pinRanksJob() {
  let running = null;
  return {
    id: 'pin-ranks',
    label: 'Pinned statistics: daily ranks',
    everyMs: 30 * 60 * 1000,
    async run({ db, now = Date.now }) {
      if (running) return { summary: 'Recording ranks' };
      running = recordPinRanks(db, now).finally(() => { running = null; });
      return { summary: 'Started' };
    },
    inFlight: () => running,
  };
}

export async function recordPinRanks(db, now = Date.now) {
  const { pinsOf } = await import('../stats/pins.js');
  const { rankOn } = await import('../stats/boards.js');
  const { utcDay } = await import('../stats/periods.js');
  const day = utcDay(now());
  let written = 0;
  for (let after = 0; ;) {
    const accounts = await db.query(
      'SELECT DISTINCT owner_account_id AS id FROM characters WHERE owner_account_id > $1 AND stats_fetched_at IS NOT NULL ORDER BY 1 LIMIT 200',
      [after],
    );
    if (!accounts.length) break;
    for (const a of accounts) {
      after = a.id;
      const { ids } = await pinsOf(db, a.id);
      const chars = await db.query('SELECT id, ruleset_id FROM characters WHERE owner_account_id = $1 AND stats_fetched_at IS NOT NULL AND ruleset_id IS NOT NULL LIMIT 50', [a.id]);
      for (const c of chars) {
        for (const statId of ids) {
          const r = await rankOn(db, { characterId: c.id, statisticId: statId, rulesetId: c.ruleset_id, now });
          const ins = await db.query(
            'INSERT INTO pin_rank_history (character_id, statistic_id, day, rank, population) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING 1',
            [c.id, statId, day, r.rank, r.population],
          );
          written += ins.length;
        }
      }
    }
  }
  return written;
}

/** Every job, given the worker's crawler (worker/index.js). */
export const createJobs = ({ crawler }) => Object.freeze([backupJob(), discoveryJob(), refreshJob(), rulesetsJob({ crawler }), pinRanksJob()]);
