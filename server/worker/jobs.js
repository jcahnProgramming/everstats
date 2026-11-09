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
 * work for it (the daily refresh) or use its client (rulesets). 0.6.0: 'tiers' runs the full tier grading.
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
          if (r.rank === null) continue; // zero: not ranked, so no rank to remember
          const ins = await db.query(
            'INSERT INTO pin_rank_history (character_id, statistic_id, day, rank, population) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING 1',
            [c.id, statId, day, r.rank, r.withAny],
          );
          written += ins.length;
        }
      }
    }
  }
  return written;
}

/** Every job, given the worker's crawler (worker/index.js). */
/**
 * Blizzard's 30-day rule (retention/sweep.js): every hour, delete Blizzard data past the cutoff, and prune backups
 * (0.5.0: the 14-nightly + monthly rule for ours; 3 days for a pre-0.5.0 dump). Runs in the background (a sweep can
 * take a few seconds); the web app runs the same sweep as a fallback.
 */
export function retentionJob({ dir = config.backupDir } = {}) {
  let running = null;
  return {
    id: 'retention',
    label: 'Blizzard data retention sweep',
    everyMs: 60 * 60 * 1000,
    async run({ db }) {
      if (running) return { summary: 'Sweeping' };
      const { runRetentionSweep } = await import('../retention/sweep.js');
      const { pruneBackups } = await import('../core/backup.js');
      running = runRetentionSweep(db, {
        processName: 'worker',
        pruneBackups: dir ? () => pruneBackups(dir).length : null,
      }).catch((err) => console.error(`[retention] sweep failed: ${err.code ?? err.name}`)).finally(() => { running = null; });
      return { summary: 'Sweep started' };
    },
    inFlight: () => running,
  };
}

/**
 * 0.5.0: guild totals (stats/guildTotals.js), what the guild boards rank. Every minute, rebuild the guilds whose
 * members changed since their last build, whose week rolled over, or whose totals are older than 6 hours. Runs in the
 * background; computed from stored values only (no Blizzard request).
 */
export function guildTotalsJob() {
  let running = null;
  let last = null;
  return {
    id: 'guild-totals',
    label: 'Guild totals for the guild boards',
    everyMs: 60 * 1000,
    async run({ db, now = Date.now }) {
      if (running) return { summary: 'Rebuilding guild totals' };
      const { rebuildDueGuilds } = await import('../stats/guildTotals.js');
      running = rebuildDueGuilds(db, { now }).then((n) => {
        last = n;
      }).catch((err) => console.error(`[guild-totals] failed: ${err.code ?? err.name}`)).finally(() => { running = null; });
      return { summary: last === null ? 'Started' : `Last pass rebuilt ${last} guild(s)` };
    },
    inFlight: () => running,
  };
}

/**
 * 0.6.0: the full tier grading (tiers/store.js). Every 15 seconds, checks whether one is due: a decision or tier
 * setting changed and has been quiet for 30 s (so a burst of decisions makes one grading), the daily refresh has
 * drained, a ruleset crossed the minimum, or the last one is 6 hours old. Runs in the background; reads stored values
 * only (no Blizzard request).
 */
export function tiersJob() {
  let running = null;
  let last = null;
  return {
    id: 'tiers',
    label: 'Letter tiers: full grading',
    everyMs: 15 * 1000,
    async run({ db, now = Date.now }) {
      if (running) return { summary: 'Grading tiers' };
      const { runDueTierWork } = await import('../tiers/store.js');
      running = runDueTierWork(db, { now }).then((summary) => {
        if (summary) last = summary;
      }).catch((err) => console.error(`[tiers] failed: ${err.code ?? err.name}`)).finally(() => { running = null; });
      return { summary: last ?? 'Waiting for the first grading' };
    },
    inFlight: () => running,
  };
}

export const createJobs = ({ crawler }) => Object.freeze([backupJob(), discoveryJob(), refreshJob(), rulesetsJob({ crawler }), pinRanksJob(), retentionJob(), guildTotalsJob(), tiersJob()]);
