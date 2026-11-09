/**
 * The crawler's status as the admin page shows it, read from worker_status (the worker writes its row on every tick).
 * A worker whose last tick is older than STALE_MS is reported as not responding: the page never shows a stopped
 * worker as running.
 */
export const STALE_MS = 3 * 60 * 1000;

export async function crawlerStatus(db) {
  const rows = await db.query(
    `SELECT worker_id, version, started_at, last_tick_at, state, jobs,
            extract(epoch FROM (now() - last_tick_at)) * 1000 AS age_ms
       FROM worker_status ORDER BY last_tick_at DESC LIMIT 10`,
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
  };
}
