/**
 * In-memory sliding-window limiter, keyed by network (core/network.js). It survives nothing: a restart forgets every
 * count, which is fine for limits measured in minutes.
 *
 *   check(key)          → { ok, retryAfterMs }   is there room for one more?
 *   take(key)           → slot | null           count one now (null when there's no room); a slot can be refunded
 *   refund(slot)                                 un-count a slot (a 2FA code that turned out to be right)
 *
 * take() is what makes concurrent attempts safe: each one claims its place before any slow work (hashing) starts, so
 * ten in flight at once can't all slip under a limit of ten.
 *
 * Memory is bounded: past maxKeys networks, expired entries are swept and then the oldest-touched dropped.
 */
export function createLimiter({ limit, windowMs, now = Date.now, maxKeys = 50_000 }) {
  const hits = new Map(); // key → ascending timestamps within the window

  const live = (key) => {
    const list = hits.get(key);
    if (!list) return [];
    const from = now() - windowMs;
    while (list.length && list[0] <= from) list.shift();
    if (!list.length) hits.delete(key);
    return list;
  };

  const sweep = () => {
    for (const key of hits.keys()) live(key);
    for (const key of hits.keys()) {
      if (hits.size <= maxKeys) break;
      hits.delete(key);
    }
  };

  const check = (key) => {
    const list = live(key);
    if (list.length < limit) return { ok: true, retryAfterMs: 0 };
    return { ok: false, retryAfterMs: Math.max(1000, list[list.length - limit] + windowMs - now()) };
  };

  return {
    limit,
    windowMs,
    check,
    take(key) {
      if (!check(key).ok) return null;
      const at = now();
      const list = hits.get(key) ?? [];
      list.push(at);
      // Re-insert so Map order is "least recently touched first" for the sweep.
      hits.delete(key);
      hits.set(key, list);
      if (hits.size > maxKeys) sweep();
      return { key, at };
    },
    refund(slot) {
      if (!slot) return;
      const list = hits.get(slot.key);
      const i = list ? list.indexOf(slot.at) : -1;
      if (i >= 0) list.splice(i, 1);
      if (list && !list.length) hits.delete(slot.key);
    },
    size: () => hits.size,
  };
}

export const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * The app's limits, one instance per app (tests build their own with their own clock). In memory: a restart forgets
 * them, which is fine for windows measured in minutes. Keyed by network (core/network.js) unless noted.
 */
export function createLimits({ now = Date.now } = {}) {
  return {
    // Character / guild lookups (a search will refresh the character from Blizzard): 30 per 15 minutes.
    lookups: createLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES, now }),
    // Starting a sign-in, link or merge (OAuth redirects, passkey challenges): 30 per 15 minutes.
    authStarts: createLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES, now }),
    // Wrong 2FA or recovery codes: 10 per network AND 5 per account per 15 minutes (both are checked). A right code
    // gives its slot back; success never resets the count.
    secondFactorByNetwork: createLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES, now }),
    secondFactorByAccount: createLimiter({ limit: 5, windowMs: FIFTEEN_MINUTES, now }),
    // Admin sign-in and enrolment attempts: 10 per 15 minutes.
    admin: createLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES, now }),
    // Username availability checks (signed in only): 60 per network AND 30 per account per 15 minutes, so the check
    // can't be used to walk the namespace or the reserved list.
    usernameChecksByNetwork: createLimiter({ limit: 60, windowMs: FIFTEEN_MINUTES, now }),
    usernameChecksByAccount: createLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES, now }),
    // Account and admin changes (theme, unlinking, 2FA setup, keys): 120 per 15 minutes. A bound on abuse only.
    writes: createLimiter({ limit: 120, windowMs: FIFTEEN_MINUTES, now }),
  };
}

/** Express middleware: counts one request against `limiter`, answering 429 with Retry-After when there's no room. */
export function limitBy(limiter, networkOf) {
  return (req, res, next) => {
    const key = networkOf(req);
    if (limiter.take(key)) return next();
    const { retryAfterMs } = limiter.check(key);
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Too many tries. Wait a little and try again.', code: 'rate_limited', retryAfterMs });
  };
}
