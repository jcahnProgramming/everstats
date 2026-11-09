/**
 * The crawler's one Blizzard request budget, and its per-endpoint back-off.
 *
 * createBudget({ perSecond })   take(priority) resolves when this request may start. At most perSecond() requests
 *   start per second, across everything the worker does. Waiting requests are served by PRIORITY first (1 = a person
 *   waiting on a lookup or sign-in … 5 = guild rosters), then in arrival order: a lookup's requests go ahead of every
 *   queued background request, so the crawl can never starve someone who is waiting.
 *   `shares` caps a priority's part of the budget (0.9.0: a guild fetch, PRIORITY.guild, at most half): its requests
 *   start at most every 1 / (perSecond × share) seconds, and while one has to wait its turn the slot goes to the next
 *   request in line (the daily refresh keeps moving). A lookup is never behind one: it sorts first.
 *
 * createBackoff()   per endpoint ('profile', 'achievement-statistics', …), never per host: a 429 or 5xx on one endpoint
 *   doesn't slow the others. Each failure doubles the wait (1 s, 2 s, 4 s … 5 min, or Retry-After). Only SUSTAINED
 *   success resets it: SUCCESS_TO_RESET successes in a row (CLAUDE.md "Bugs that cost us").
 */
import { BUDGET_SHARES, PRIORITY, PRIORITY_VALUES } from './queue.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBudget({ perSecond, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, shares = BUDGET_SHARES } = {}) {
  const rate = typeof perSecond === 'function' ? perSecond : () => perSecond;
  const waiting = []; // { priority, seq, resolve }
  const shareNextAt = new Map(); // priority → earliest start of its next request
  let seq = 0;
  let nextAt = 0;
  let timer = null;
  let shareWait = false; // the timer only waits for a capped priority's turn

  const shareOf = (p) => (Number.isFinite(shares?.[p]) && shares[p] > 0 && shares[p] < 1 ? shares[p] : null);

  function pump() {
    timer = null;
    shareWait = false;
    while (waiting.length) {
      const t = now();
      if (t < nextAt) {
        timer = setTimer(pump, nextAt - t);
        return;
      }
      waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      // The most urgent request whose priority isn't over its share right now.
      const i = waiting.findIndex((w) => !shareOf(w.priority) || (shareNextAt.get(w.priority) ?? 0) <= t);
      if (i < 0) {
        const soonest = Math.min(...waiting.map((w) => shareNextAt.get(w.priority) ?? t));
        timer = setTimer(pump, Math.max(1, soonest - t));
        shareWait = true;
        return;
      }
      const [w] = waiting.splice(i, 1);
      const step = 1000 / Math.max(1, rate());
      nextAt = Math.max(t, nextAt) + step;
      const share = shareOf(w.priority);
      if (share) shareNextAt.set(w.priority, Math.max(t, shareNextAt.get(w.priority) ?? 0) + step / share);
      w.resolve();
    }
  }

  return {
    take(priority = PRIORITY.roster) {
      return new Promise((resolve) => {
        waiting.push({ priority, seq: seq++, resolve });
        // Only capped requests were waiting for their turn: anything else may start now, not after them.
        if (timer && shareWait && !shareOf(priority)) {
          clearTimer(timer);
          timer = null;
        }
        if (!timer) pump();
      });
    },
    /** Waiting requests by priority, for the admin page. */
    waiting() {
      const out = Object.fromEntries(PRIORITY_VALUES.map((p) => [p, 0]));
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
