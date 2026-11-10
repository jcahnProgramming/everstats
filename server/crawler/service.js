import { getSetting } from '../admin/settings.js';
import { SourceError } from '../sources/blizzard.js';
import { openSource as defaultOpenSource } from '../sources/registry.js';
import { createBackoff, createBudget } from './budget.js';
import { RetryableError, fetchCharacter, fetchGuildRoster } from './fetch.js';
import { fetchItemMedia } from './items.js';
import { fetchCollections } from '../collections/fetch.js';
import { fetchCatalogStep } from '../collections/catalog.js';
import { PRIORITY, PRIORITY_VALUES, claim, finish, retryLater, sweepQueue } from './queue.js';
import { countRequests } from './stats.js';
import { PRIMARY_SCOPE } from '../core/config.js';
import { isVersionEnabled } from '../core/gameVersions.js';

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
 * 0.10.0: every request names its game version and region (client.request's `version` / `region`, default the
 * primary scope). The source is per region (its API host); the budget is one for every region or one per region
 * (admin setting crawler.budgetScope), and each version's requests stay under its ceiling (crawler.versionShares).
 * Back-off is per version and endpoint: a 429 on Retail's profile endpoint never slows Forever's.
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
  let settings = { at: 0, perSecond: 8, paused: false, versionShares: {}, budgetScope: 'client' };
  const versionShares = () => Object.fromEntries(Object.entries(settings.versionShares ?? {}).map(([v, pct]) => [v, pct / 100]));
  const budgets = new Map(); // 'client' or a region id → budget
  const budgetFor = (region) => {
    const key = settings.budgetScope === 'region' ? region : 'client';
    if (!budgets.has(key)) budgets.set(key, createBudget({ perSecond: () => settings.perSecond, now, versionShares }));
    return budgets.get(key);
  };
  const backoff = createBackoff({ now, sleep });
  const inFlight = new Map(); // id → { priority, kind, key, startedAt }
  const minutes = new Map(); // minute → { requests, errors, throttled }
  let pending = { requests: 0, errors: 0, throttled: 0 };
  let lastError = null;
  const sources = new Map(); // region → { source, at }
  let sourceProblem = null;
  let running = false;
  let loopDone = null;
  let lastStatusAt = 0;
  const startedAt = new Date(now()).toISOString();

  async function refreshSettings() {
    if (now() - settings.at < SETTINGS_EVERY_MS) return;
    settings = {
      at: now(), perSecond: await getSetting(db, 'crawler.requestsPerSecond'), paused: await getSetting(db, 'crawler.paused'),
      versionShares: await getSetting(db, 'crawler.versionShares'), budgetScope: await getSetting(db, 'crawler.budgetScope'),
    };
  }

  async function ensureSource(region = PRIMARY_SCOPE.region) {
    const known = sources.get(region);
    if (known && now() - known.at < SOURCE_EVERY_MS) return known.source;
    try {
      // Pacing happens in the budget, so the source itself doesn't pace; one attempt, the crawler retries.
      const source = await openSource(db, 'blizzard', { fetch, perSecond: 1000, maxInFlight: 32, maxAttempts: 1, now, sleep, region });
      sources.set(region, { source, at: now() });
      sourceProblem = null;
      return source;
    } catch (err) {
      sources.delete(region);
      sourceProblem = err instanceof SourceError ? err.code : (err?.code ?? err?.name ?? 'error');
      return null;
    }
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
    async request(endpoint, path, { priority = PRIORITY.daily, namespace, query = null, version = PRIMARY_SCOPE.version, region = PRIMARY_SCOPE.region } = {}) {
      if (!isVersionEnabled(version)) throw new RetryableError(`${version} is not enabled: nothing of it is crawled`, 'version_disabled');
      // The primary version's endpoints keep their plain names (the admin page and its history); others are prefixed.
      const key = version === PRIMARY_SCOPE.version && region === PRIMARY_SCOPE.region ? endpoint : `${version}/${region}:${endpoint}`;
      const wait = backoff.waitMs(key);
      if (wait > 0) {
        if (priority === PRIORITY.lookup && wait > 15_000) throw new RetryableError(`${endpoint}: Blizzard asked us to slow down`, 'backoff');
        await backoff.wait(key);
      }
      await budgetFor(region).take(priority, version);
      const src = await ensureSource(region);
      if (!src) throw new RetryableError('Blizzard keys are not configured', 'not_configured');
      const r = await src.get(path, { namespace, query });
      tally('requests');
      const bad = r.status === null || r.status === 429 || r.status >= 500;
      if (bad) {
        tally('errors');
        if (r.status === 429) tally('throttled');
        const ra = Number(r.headers?.['retry-after']);
        backoff.fail(key, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
        lastError = { at: new Date(now()).toISOString(), endpoint: key, status: r.status, error: r.error ?? null };
      } else {
        backoff.succeed(key);
      }
      return r;
    },
  };

  async function runItem(item) {
    inFlight.set(item.id, { priority: item.priority, kind: item.kind, key: item.key, version: item.game_version, region: item.region, startedAt: new Date(now()).toISOString() });
    try {
      const ctx = { db, client, now };
      const handler = { guild: fetchGuildRoster, items: fetchItemMedia, character: fetchCharacter, collections: fetchCollections, catalog: fetchCatalogStep }[item.kind] ?? fetchCharacter;
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
      waitingForBudget: [...budgets.values()].reduce((acc, b) => {
        for (const [k, n] of Object.entries(b.waiting())) acc[k] = (acc[k] ?? 0) + n;
        return acc;
      }, Object.fromEntries(PRIORITY_VALUES.map((x) => [x, 0]))),
      waitingByVersion: [...budgets.values()].reduce((acc, b) => {
        for (const [k, n] of Object.entries(b.waitingByVersion())) acc[k] = (acc[k] ?? 0) + n;
        return acc;
      }, {}),
      versionShares: settings.versionShares,
      budgetScope: settings.budgetScope,
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
