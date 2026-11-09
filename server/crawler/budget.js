/**
 * The crawler's one Blizzard request budget, and its per-endpoint back-off.
 *
 * createBudget({ perSecond })   take(priority) resolves when this request may start. At most perSecond() requests
 *   start per second, across everything the worker does. Waiting requests are served by PRIORITY first (1 = a person
 *   waiting on a lookup or sign-in … 4 = guild rosters), then in arrival order: a lookup's requests go ahead of every
 *   queued background request, so the crawl can never starve someone who is waiting.
 *
 * createBackoff()   per endpoint ('profile', 'achievement-statistics', …), never per host: a 429 or 5xx on one endpoint
 *   doesn't slow the others. Each failure doubles the wait (1 s, 2 s, 4 s … 5 min, or Retry-After). Only SUSTAINED
 *   success resets it: SUCCESS_TO_RESET successes in a row (CLAUDE.md "Bugs that cost us").
 */
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBudget({ perSecond, now = Date.now, setTimer = setTimeout } = {}) {
  const rate = typeof perSecond === 'function' ? perSecond : () => perSecond;
  const waiting = []; // { priority, seq, resolve }
  let seq = 0;
  let nextAt = 0;
  let timer = null;

  function pump() {
    timer = null;
    while (waiting.length) {
      const t = now();
      if (t < nextAt) {
        timer = setTimer(pump, nextAt - t);
        return;
      }
      waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const w = waiting.shift();
      nextAt = Math.max(t, nextAt) + 1000 / Math.max(1, rate());
      w.resolve();
    }
  }

  return {
    take(priority = 4) {
      return new Promise((resolve) => {
        waiting.push({ priority, seq: seq++, resolve });
        if (!timer) pump();
      });
    },
    /** Waiting requests by priority, for the admin page. */
    waiting() {
      const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const w of waiting) out[w.priority] = (out[w.priority] ?? 0) + 1;
      return out;
    },
  };
}

export const SUCCESS_TO_RESET = 20;
export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function createBackoff({ now = Date.now, sleep = defaultSleep } = {}) {
  const state = new Map(); // endpoint → { failures, until, streak }
  const get = (e) => {
    if (!state.has(e)) state.set(e, { failures: 0, until: 0, streak: 0 });
    return state.get(e);
  };
  return {
    /** How long `endpoint` must still wait (ms, 0 = go). */
    waitMs: (endpoint) => Math.max(0, get(endpoint).until - now()),
    async wait(endpoint) {
      const ms = Math.max(0, get(endpoint).until - now());
      if (ms) await sleep(ms);
    },
    fail(endpoint, retryAfterMs = null) {
      const s = get(endpoint);
      s.failures += 1;
      s.streak = 0;
      const delay = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, MAX_BACKOFF_MS) : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (s.failures - 1));
      s.until = Math.max(s.until, now() + delay);
    },
    succeed(endpoint) {
      const s = get(endpoint);
      s.streak += 1;
      if (s.streak >= SUCCESS_TO_RESET) s.failures = 0;
    },
    /** Endpoints currently backing off, for the admin page. */
    active() {
      return [...state.entries()].filter(([, s]) => s.until > now()).map(([endpoint, s]) => ({ endpoint, until: new Date(s.until).toISOString(), failures: s.failures }));
    },
  };
}
