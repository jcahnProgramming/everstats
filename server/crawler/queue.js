// No core/config.js here (it is Node-only and the CLIENT imports this file for the priority names): the configured
// region is loaded when something is queued.
import { PRIMARY_VERSION, enabledVersions, isVersionEnabled } from '../core/gameVersions.js';

const configuredRegion = async () => (await import('../core/config.js')).PRIMARY_SCOPE.region;

/**
 * The crawl queue (crawl_queue). Web and worker both enqueue; only the worker claims and runs items.
 *
 *   PRIORITY.lookup 1   a person waiting: a character search, a sign-in
 *   PRIORITY.guild  2   0.9.0: members of a guild someone asked to fetch whole ("Fetch all members", guilds/fetchAll.js).
 *                       Always behind a lookup; never more than GUILD_SLOTS crawler slots (crawler/service.js) or
 *                       BUDGET_SHARES of the request budget (crawler/budget.js), so the daily refresh keeps moving.
 *   PRIORITY.auto   3   characters found on a Battle.net account at sign-in
 *   PRIORITY.daily  4   the daily refresh of every tracked character
 *   PRIORITY.roster 5   guild-roster expansion
 *
 * Code uses the NAMES only: 0.9.0 renumbered them (migration 021 moved queued rows along).
 *
 * 0.10.0: every item belongs to a game version and region (crawl_queue.game_version / region; default the primary
 * scope). A version that isn't enabled is never queued (`allowDisabled` exists for tests only) and its items never run.
 *
 * One pending item per (version, region, kind, key): enqueueing it again raises its priority (and 'full' beats 'check'), never adds a
 * second. Finished items stay an hour (so a waiting lookup can read its outcome), then sweepQueue deletes them.
 */
export const PRIORITY = Object.freeze({ lookup: 1, guild: 2, auto: 3, daily: 4, roster: 5 });
export const PRIORITY_VALUES = Object.freeze(Object.values(PRIORITY).sort((a, b) => a - b));
/** The most of the request budget a priority may use (crawler/budget.js): a guild fetch never takes more than half. */
export const BUDGET_SHARES = Object.freeze({ [PRIORITY.guild]: 0.5 });
export const FINISHED_KEEP_MS = 60 * 60 * 1000;
export const STALE_RUNNING_MS = 5 * 60 * 1000;

async function scopeOf(item) {
  const version = item.version ?? PRIMARY_VERSION.id;
  const region = item.region ?? await configuredRegion();
  if (!isVersionEnabled(version) && !item.allowDisabled) throw new Error(`game version ${version} is not enabled: nothing of it is crawled`);
  return { version, region };
}

export async function enqueue(q, { kind = 'character', key, priority, mode = 'full', accountId = null, notBefore = null, version, region, allowDisabled = false }) {
  const scope = await scopeOf({ version, region, allowDisabled });
  const row = await q.one(
    `INSERT INTO crawl_queue (kind, key, mode, priority, account_id, not_before, game_version, region) VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7, $8)
     ON CONFLICT (game_version, region, kind, key) WHERE state IN ('queued', 'running') DO UPDATE SET
       priority = LEAST(crawl_queue.priority, EXCLUDED.priority),
       mode = CASE WHEN EXCLUDED.mode = 'full' THEN 'full' ELSE crawl_queue.mode END,
       account_id = coalesce(crawl_queue.account_id, EXCLUDED.account_id),
       not_before = LEAST(crawl_queue.not_before, EXCLUDED.not_before)
     RETURNING id, state`,
    [kind, String(key).slice(0, 200), mode, priority, accountId, notBefore, scope.version, scope.region],
  );
  return row;
}

/** Many at once (the daily refresh, a roster): one statement. */
export async function enqueueMany(q, list) {
  // One statement can't touch the same pending row twice: keep each (kind, key) once, at its most urgent priority.
  const byKey = new Map();
  for (const i of list) {
    Object.assign(i, { scope: await scopeOf(i) });
    const k = `${i.scope.version}|${i.scope.region}|${i.kind ?? 'character'}|${i.key}`;
    if (!byKey.has(k) || byKey.get(k).priority > i.priority) byKey.set(k, i);
  }
  const items = [...byKey.values()];
  if (!items.length) return 0;
  const rows = await q.query(
    `INSERT INTO crawl_queue (kind, key, mode, priority, game_version, region)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::smallint[], $5::text[], $6::text[])
     ON CONFLICT (game_version, region, kind, key) WHERE state IN ('queued', 'running') DO UPDATE SET priority = LEAST(crawl_queue.priority, EXCLUDED.priority)
     RETURNING id`,
    [items.map((i) => i.kind ?? 'character'), items.map((i) => String(i.key).slice(0, 200)), items.map((i) => i.mode ?? 'full'), items.map((i) => i.priority),
      items.map((i) => i.scope.version), items.map((i) => i.scope.region)],
  );
  return rows.length;
}

/** Claims the most urgent due item with priority ≤ maxPriority and not one of `skip`, or null. */
export async function claim(q, { maxPriority = PRIORITY.roster, skip = [], versions = enabledVersions().map((v) => v.id) } = {}) {
  // Only enabled versions' items are claimed (an item of a version switched off stays queued, untouched).
  return q.one(
    `UPDATE crawl_queue SET state = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM crawl_queue WHERE state = 'queued' AND not_before <= now() AND priority <= $1
                     AND NOT (priority = ANY($2::smallint[])) AND game_version = ANY($3::text[])
                   ORDER BY priority, not_before, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [maxPriority, skip, versions],
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
  const out = Object.fromEntries(PRIORITY_VALUES.map((p) => [p, { queued: 0, running: 0 }]));
  for (const r of rows) if (out[r.priority]) out[r.priority][r.state] = r.n;
  return out;
}
