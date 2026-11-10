import { createHash, timingSafeEqual } from 'node:crypto';
import { getProvider } from '../auth/providers.js';
import { identityBan } from '../moderation/bans.js';

/**
 * PRODUCTION SIDE of the dev tester gate (0.10.3): POST /api/internal/dev-tester.
 *
 * The private test site (dev.everstats.app) has its own database, so it can't see who holds Dev Tester. It asks this
 * endpoint exactly one question: "does the account linked to this Battle.net account id / Discord user id hold Dev
 * Tester?" → 200 { tester: true | false }. Nothing else ever leaves production this way.
 *
 *   - Authenticated by DEV_TESTER_SECRET from .env (Authorization: Bearer …), a secret used for nothing else, at
 *     least 32 characters, compared in constant time (both sides hashed first, so the length leaks nothing either).
 *   - OFF unless the secret is set: a plain 404 { error: 'Not found' }, exactly what /api answers for a path that
 *     doesn't exist. A WRONG secret gets the same 404 (not 401): someone guessing can't even tell the endpoint is
 *     there. The dev site logs the status it got, so the owner can still tell "404 = secret wrong or not set".
 *   - Never answers on the dev environment (dev never serves it, whatever its .env says).
 *   - Mounted BEFORE the CSRF Origin check (server/app.js), the one exemption: it carries no cookies and reads no
 *     session; the secret is the authentication. Every other /api write still needs Origin.
 *   - Rate-limited per network (limits.devTesterByNetwork) and site-wide (limits.devTesterGlobal), counted BEFORE the
 *     secret is checked, so guessing is bounded too.
 *   - The same answer shape for every "no": an unknown identity, a badge never held, a revoked badge (state 'revoked')
 *     and an account with a live ban (or an identity copied into one: moderation/bans.js identityBan) are all
 *     { tester: false }.
 *   - Logs nothing per request: never an id, a subject, the secret or a body. (Counts of yes / no answers are kept in
 *     memory, `stats()`, for anyone who wants to look; nothing prints them.)
 */
export const DEV_TESTER_PATH = '/api/internal/dev-tester';
export const DEV_TESTER_BADGE = 'dev-tester';
export const SECRET_MIN_LENGTH = 32;

const digest = (s) => createHash('sha256').update(String(s), 'utf8').digest();

/** The configured secret, or null when unset or too short (then the endpoint and the gate's requests are off). */
export function usableSecret(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= SECRET_MIN_LENGTH ? s : null;
}

/** Constant-time "is this the Authorization header for this secret?". */
export function bearerMatches(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const m = /^Bearer (.+)$/.exec(header);
  const given = m ? m[1].trim() : '';
  // Both sides hashed: equal-length buffers, so timingSafeEqual never throws and the length isn't leaked.
  return timingSafeEqual(digest(given), digest(secret)) && given.length > 0;
}

/** Does this provider identity's account hold Dev Tester right now, with no live ban? */
export async function holdsDevTester(db, provider, subject) {
  if (await identityBan(db, provider, subject)) return false;
  const row = await db.one(
    `SELECT 1 AS x FROM account_identities i
       JOIN badge_awards a ON a.account_id = i.account_id AND a.badge_id = $3 AND a.state = 'held'
      WHERE i.provider = $1 AND i.subject = $2 AND NOT everstats_banned(i.account_id)
      LIMIT 1`,
    [provider, subject, DEV_TESTER_BADGE],
  );
  return Boolean(row);
}

/**
 * The handler. `secret` is a function (read per request) so tests can set it; in production the .env value never
 * changes while the process runs.
 */
export function createDevTesterEndpoint({ db, limits, networkOf, environment, secret = () => process.env.DEV_TESTER_SECRET }) {
  const counts = { yes: 0, no: 0 };
  const notFound = (res) => res.status(404).json({ error: 'Not found' });

  const handler = async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const key = usableSecret(secret());
      if (environment.id === 'dev' || !key) return notFound(res);
      // Counted before the secret is checked: guessing costs the same as asking.
      const net = limits.devTesterByNetwork.take(networkOf(req));
      const all = net && limits.devTesterGlobal.take('global');
      if (!net || !all) {
        limits.devTesterByNetwork.refund(net);
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Too many requests.', code: 'rate_limited' });
      }
      if (!bearerMatches(req.headers.authorization, key)) return notFound(res);
      const provider = typeof req.body?.provider === 'string' ? getProvider(req.body.provider) : null;
      const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';
      if (!provider || subject.length < 1 || subject.length > 100) return res.status(400).json({ error: 'Send { provider, subject }.', code: 'invalid' });
      const tester = await holdsDevTester(db, provider.id, subject);
      counts[tester ? 'yes' : 'no'] += 1;
      return res.json({ tester });
    } catch (err) {
      return next(err);
    }
  };
  handler.stats = () => ({ ...counts });
  return handler;
}
