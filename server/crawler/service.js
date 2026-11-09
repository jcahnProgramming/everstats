import { getSetting } from '../admin/settings.js';
import { SourceError } from '../sources/blizzard.js';
import { openSource as defaultOpenSource } from '../sources/registry.js';
import { createBackoff, createBudget } from './budget.js';
import { RetryableError, fetchCharacter, fetchGuildRoster } from './fetch.js';
import { fetchItemMedia } from './items.js';
import { PRIORITY, PRIORITY_VALUES, claim, finish, retryLater, sweepQueue } from './queue.js';
import { countRequests } from './stats.js';

/**
 * The crawler: runs inside the worker, all the time (not on the 30-second job tick). It claims queue items most
 * urgent first and runs up to CONCURRENCY at once, but background items (daily refresh, rosters) may hold at most
 * BACKGROUND_SLOTS of them: one slot is always free for a person waiting on a lookup or sign-in, and their requests
 * jump the shared budget's queue (crawler/budget.js). Every Blizzard request goes through client.request().
 *
 * 0.9.0: a guild fetch's members (PRIORITY.guild) hold at most GUILD_SLOTS slots, and together with the background
 * items still at most BACKGROUND_SLOTS: a lookup always has a slot, and the daily refresh gets every slot that frees
 * while no guild fetch is waiting for one. (Their requests are also capped at half the budget: crawler/budget.js.)
 *
 * Paused (admin setting crawler.paused): background items and guild fetches wait; lookups, sign-ins and auto-fetch
 * still run.
 */
export const CONCURRENCY = 4;
export const BACKGROUND_SLOTS = 3;
export const GUILD_SLOTS = 2;

/** Which priorities may take a free slot, given what is running now. → claim()'s { maxPriority, skip }. */
export function claimable({ inFlight, paused }) {
  const list = [...inFlight];
  const background = list.filter((x) => x.priority >= PRIORITY.daily).length;
  const guild = list.filter((x) => x.priority === PRIORITY.guild).length;
  const allowed = new Set([PRIORITY.lookup, PRIORITY.auto]);
  if (!paused && guild < GUILD_SLOTS && guild + background < BACKGROUND_SLOTS) allowed.add(PRIORITY.guild);
  if (!paused && guild + background < BACKGROUND_SLOTS) {
    allowed.add(PRIORITY.daily);
    allowed.add(PRIORITY.roster);
  }
  const maxPriority = Math.max(...allowed);
  return { maxPriority, skip: PRIORITY_VALUES.filter((p) => p <= maxPriority && !allowed.has(p)) };
}
const IDLE_MS = 250;
const STATUS_EVERY_MS = 5000;
const SETTINGS_EVERY_MS = 5000;
const SOURCE_EVERY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createCrawler({ db, fetch = globalThis.fetch, now = Date.now, sleep = defaultSleep, openSource = defaultOpenSource, log = console } = {}) {
  let settings = { at: 0, perSecond: 8, paused: false };
  const budget = createBudget({ perSecond: () => settings.perSecond, now });
  const backoff = createBackoff({ now, sleep });
  const inFlight = new Map(); // id → { priority, kind, key, startedAt }
  const minutes = new Map(); // minute → { requests, errors, throttled }
  let pending = { requests: 0, errors: 0, throttled: 0 };
  let lastError = null;
  let source = null;
  let sourceAt = 0;
  let sourceProblem = null;
  let running = false;
  let loopDone = null;
  let lastStatusAt = 0;
  const startedAt = new Date(now()).toISOString();

  async function refreshSettings() {
    if (now() - settings.at < SETTINGS_EVERY_MS) return;
    settings = { at: now(), perSecond: await getSetting(db, 'crawler.requestsPerSecond'), paused: await getSetting(db, 'crawler.paused') };
  }

  async function ensureSource() {
    if (source && now() - sourceAt < SOURCE_EVERY_MS) return source;
    try {
      // Pacing happens in the budget, so the source itself doesn't pace; one attempt, the crawler retries.
      source = await openSource(db, 'blizzard', { fetch, perSecond: 1000, maxInFlight: 32, maxAttempts: 1, now, sleep });
      sourceAt = now();
      sourceProblem = null;
    } catch (err) {
      source = null;
      sourceProblem = err instanceof SourceError ? err.code : (err?.code ?? err?.name ?? 'error');
    }
    return source;
  }

  function tally(kind) {
    const m = Math.floor(now() / 60_000);
    const b = minutes.get(m) ?? { requests: 0, errors: 0, throttled: 0 };
    b[kind] += 1;
    minutes.set(m, b);
    pending[kind] += 1;
    for (const k of minutes.keys()) if (k < m - 60) minutes.delete(k);
  }

  /** The one way the crawler asks Blizzard anything: per-endpoint back-off, then the shared budget, then the GET. */
  const client = {
    async request(endpoint, path, { priority = PRIORITY.daily, namespace } = {}) {
      const wait = backoff.waitMs(endpoint);
      if (wait > 0) {
        if (priority === PRIORITY.lookup && wait > 15_000) throw new RetryableError(`${endpoint}: Blizzard asked us to slow down`, 'backoff');
        await backoff.wait(endpoint);
      }
      await budget.take(priority);
      const src = await ensureSource();
      if (!src) throw new RetryableError('Blizzard keys are not configured', 'not_configured');
      const r = await src.get(path, { namespace });
      tally('requests');
      const bad = r.status === null || r.status === 429 || r.status >= 500;
      if (bad) {
        tally('errors');
        if (r.status === 429) tally('throttled');
        const ra = Number(r.headers?.['retry-after']);
        backoff.fail(endpoint, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
        lastError = { at: new Date(now()).toISOString(), endpoint, status: r.status, error: r.error ?? null };
      } else {
        backoff.succeed(endpoint);
      }
      return r;
    },
  };

  async function runItem(item) {
    inFlight.set(item.id, { priority: item.priority, kind: item.kind, key: item.key, startedAt: new Date(now()).toISOString() });
    try {
      const ctx = { db, client, now };
      const handler = { guild: fetchGuildRoster, items: fetchItemMedia, character: fetchCharacter }[item.kind] ?? fetchCharacter;
      const outcome = await handler(ctx, item);
      await finish(db, item.id, 'done', outcome);
    } catch (err) {
      const why = err instanceof RetryableError ? err.message : `${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}`;
      if (!(err instanceof RetryableError)) {
        log.error(`[crawler] ${item.kind} item ${item.id} failed: ${why}\n${String(err?.stack ?? '').split('\n').slice(1, 4).join('\n')}`);
        lastError = { at: new Date(now()).toISOString(), endpoint: item.kind, status: null, error: why.slice(0, 120) };
      }
      // A person waiting gets an answer now ("couldn't reach Blizzard"), never a silent retry.
      if (item.priority === PRIORITY.lookup || item.attempts >= MAX_ATTEMPTS || !(err instanceof RetryableError)) {
        await finish(db, item.id, 'failed', why).catch(() => {});
      } else {
        await retryLater(db, item.id, Math.min(60 * 60 * 1000, 30_000 * 2 ** item.attempts), why).catch(() => {});
      }
    } finally {
      inFlight.delete(item.id);
    }
  }

  async function writeStatus(force = false) {
    if (!force && now() - lastStatusAt < STATUS_EVERY_MS) return;
    lastStatusAt = now();
    const flush = pending;
    pending = { requests: 0, errors: 0, throttled: 0 };
    try {
      await countRequests(db, flush, now());
    } catch {
      pending.requests += flush.requests;
      pending.errors += flush.errors;
      pending.throttled += flush.throttled;
    }
    await db.query(
      `INSERT INTO crawler_status (id, updated_at, detail) VALUES (1, now(), $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = now(), detail = EXCLUDED.detail`,
      [JSON.stringify(status())],
    ).catch(() => {});
  }

  function status() {
    let requestsLastHour = 0;
    let errorsLastHour = 0;
    const m = Math.floor(now() / 60_000);
    for (const [k, b] of minutes) {
      if (k > m - 60) {
        requestsLastHour += b.requests;
        errorsLastHour += b.errors;
      }
    }
    return {
      state: sourceProblem === 'not_configured' ? 'not_configured' : settings.paused ? 'paused' : inFlight.size ? 'running' : 'idle',
      startedAt,
      perSecond: settings.perSecond,
      paused: settings.paused,
      inFlight: [...inFlight.values()],
      waitingForBudget: budget.waiting(),
      requestsLastHour,
      errorsLastHour,
      lastError,
      backoffs: backoff.active(),
      sourceProblem,
    };
  }

  async function loop() {
    let lastSweep = 0;
    while (running) {
      try {
        await refreshSettings();
        if (now() - lastSweep > 60_000) {
          await sweepQueue(db);
          lastSweep = now();
        }
        await writeStatus();
        let item = null;
        if (inFlight.size < CONCURRENCY && (await ensureSource())) {
          item = await claim(db, claimable({ inFlight: inFlight.values(), paused: settings.paused }));
        }
        if (item) runItem(item);
        else await sleep(IDLE_MS);
      } catch (err) {
        log.error(`[crawler] loop: ${err?.code ?? err?.name ?? 'error'}`);
        await sleep(2000);
      }
    }
    while (inFlight.size) await sleep(50);
  }

  return {
    client,
    status,
    async start() {
      if (running) return;
      running = true;
      // Items a stopped worker left running go back in the queue at once.
      await db.query("UPDATE crawl_queue SET state = 'queued' WHERE state = 'running'").catch(() => {});
      loopDone = loop();
    },
    async stop() {
      running = false;
      await loopDone;
      await writeStatus(true);
    },
    runItem,
  };
}
