import { queueDepth } from '../crawler/queue.js';

/**
 * The crawler's status as the admin page shows it, read from worker_status (the worker writes its row on every tick)
 * and crawler_status (the crawler writes its own every few seconds). A worker or crawler whose last write is older
 * than STALE_MS is reported as not responding: the page never shows a stopped worker as running.
 */
export const STALE_MS = 3 * 60 * 1000;

export async function crawlerStatus(db) {
  const rows = await db.query(
    `SELECT worker_id, version, started_at, last_tick_at, state, jobs,
            extract(epoch FROM (now() - last_tick_at)) * 1000 AS age_ms
       FROM worker_status ORDER BY last_tick_at DESC LIMIT 10`,
  );
  const live = await db.one('SELECT updated_at, detail, extract(epoch FROM (now() - updated_at)) * 1000 AS age_ms FROM crawler_status WHERE id = 1');
  const hours = await db.query("SELECT hour, requests, errors, throttled FROM crawler_hours WHERE hour >= date_trunc('hour', now()) - interval '23 hours' ORDER BY hour LIMIT 24");
  const today = await db.one(
    `SELECT count(*) FILTER (WHERE last_checked_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS checked,
            count(*) FILTER (WHERE last_fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS fetched,
            count(*) FILTER (WHERE stats_fetched_at IS NOT NULL)::int AS tracked,
            count(*)::int AS known
       FROM characters`,
  );
  return {
    workers: rows.map((r) => ({
      id: r.worker_id,
      version: r.version,
      startedAt: r.started_at,
      lastTickAt: r.last_tick_at,
      state: Number(r.age_ms) > STALE_MS ? 'not_responding' : r.state,
      jobs: r.jobs,
    })),
    crawler: live ? { ...live.detail, updatedAt: live.updated_at, state: Number(live.age_ms) > STALE_MS ? 'not_responding' : live.detail.state } : null,
    queue: await queueDepth(db),
    // Requests in each of the last 24 UTC hours, measured (crawler_hours), plus the crawler's own rolling hour.
    hours: hours.map((h) => ({ hour: h.hour, requests: h.requests, errors: h.errors, throttled: h.throttled })),
    today: { checked: today.checked, fetched: today.fetched, tracked: today.tracked, known: today.known },
  };
}
