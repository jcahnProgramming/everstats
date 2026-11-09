/**
 * The crawl queue (crawl_queue). Web and worker both enqueue; only the worker claims and runs items.
 *
 *   PRIORITY.lookup 1   a person waiting: a character search, a sign-in
 *   PRIORITY.auto   2   characters found on a Battle.net account at sign-in
 *   PRIORITY.daily  3   the daily refresh of every tracked character
 *   PRIORITY.roster 4   guild-roster expansion
 *
 * One pending item per (kind, key): enqueueing it again raises its priority (and 'full' beats 'check'), never adds a
 * second. Finished items stay an hour (so a waiting lookup can read its outcome), then sweepQueue deletes them.
 */
export const PRIORITY = Object.freeze({ lookup: 1, auto: 2, daily: 3, roster: 4 });
export const FINISHED_KEEP_MS = 60 * 60 * 1000;
export const STALE_RUNNING_MS = 5 * 60 * 1000;

export async function enqueue(q, { kind = 'character', key, priority, mode = 'full', accountId = null, notBefore = null }) {
  const row = await q.one(
    `INSERT INTO crawl_queue (kind, key, mode, priority, account_id, not_before) VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))
     ON CONFLICT (kind, key) WHERE state IN ('queued', 'running') DO UPDATE SET
       priority = LEAST(crawl_queue.priority, EXCLUDED.priority),
       mode = CASE WHEN EXCLUDED.mode = 'full' THEN 'full' ELSE crawl_queue.mode END,
       account_id = coalesce(crawl_queue.account_id, EXCLUDED.account_id),
       not_before = LEAST(crawl_queue.not_before, EXCLUDED.not_before)
     RETURNING id, state`,
    [kind, String(key).slice(0, 200), mode, priority, accountId, notBefore],
  );
  return row;
}

/** Many at once (the daily refresh, a roster): one statement. */
export async function enqueueMany(q, list) {
  // One statement can't touch the same pending row twice: keep each (kind, key) once, at its most urgent priority.
  const byKey = new Map();
  for (const i of list) {
    const k = `${i.kind ?? 'character'}|${i.key}`;
    if (!byKey.has(k) || byKey.get(k).priority > i.priority) byKey.set(k, i);
  }
  const items = [...byKey.values()];
  if (!items.length) return 0;
  const rows = await q.query(
    `INSERT INTO crawl_queue (kind, key, mode, priority)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::smallint[])
     ON CONFLICT (kind, key) WHERE state IN ('queued', 'running') DO UPDATE SET priority = LEAST(crawl_queue.priority, EXCLUDED.priority)
     RETURNING id`,
    [items.map((i) => i.kind ?? 'character'), items.map((i) => String(i.key).slice(0, 200)), items.map((i) => i.mode ?? 'full'), items.map((i) => i.priority)],
  );
  return rows.length;
}

/** Claims the most urgent due item with priority ≤ maxPriority, or null. */
export async function claim(q, { maxPriority = 4 } = {}) {
  return q.one(
    `UPDATE crawl_queue SET state = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM crawl_queue WHERE state = 'queued' AND not_before <= now() AND priority <= $1
                   ORDER BY priority, not_before, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [maxPriority],
  );
}

export async function finish(q, id, state, outcome) {
  await q.query('UPDATE crawl_queue SET state = $2, outcome = $3, finished_at = now() WHERE id = $1', [id, state, String(outcome ?? '').slice(0, 200)]);
}

/** Puts a running item back in the queue, to be tried again after `delayMs`. */
export async function retryLater(q, id, delayMs, outcome) {
  await q.query(
    `UPDATE crawl_queue SET state = 'queued', outcome = $3, not_before = now() + ($2 || ' milliseconds')::interval WHERE id = $1`,
    [id, String(Math.round(delayMs)), String(outcome ?? '').slice(0, 200)],
  );
}

/** Items left 'running' by a worker that stopped go back in the queue; old finished items are deleted. */
export async function sweepQueue(q) {
  await q.query(
    `UPDATE crawl_queue SET state = 'queued' WHERE state = 'running' AND started_at < now() - ($1 || ' milliseconds')::interval`,
    [String(STALE_RUNNING_MS)],
  );
  await q.query(
    `DELETE FROM crawl_queue WHERE state IN ('done', 'failed') AND finished_at < now() - ($1 || ' milliseconds')::interval`,
    [String(FINISHED_KEEP_MS)],
  );
}

/** Waits (polling) until item `id` has finished, up to timeoutMs. → the row, or null on timeout. */
export async function waitFor(q, id, { timeoutMs = 20_000, pollMs = 150, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const until = now() + timeoutMs;
  for (;;) {
    const row = await q.one('SELECT id, state, outcome FROM crawl_queue WHERE id = $1', [id]);
    if (!row || row.state === 'done' || row.state === 'failed') return row;
    if (now() >= until) return null;
    await sleep(pollMs);
  }
}

/** Queue depth by priority, for the admin page. */
export async function queueDepth(q) {
  const rows = await q.query("SELECT priority, state, count(*)::int AS n FROM crawl_queue WHERE state IN ('queued', 'running') GROUP BY priority, state LIMIT 20");
  const out = { 1: { queued: 0, running: 0 }, 2: { queued: 0, running: 0 }, 3: { queued: 0, running: 0 }, 4: { queued: 0, running: 0 } };
  for (const r of rows) out[r.priority][r.state] = r.n;
  return out;
}
