import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../credentials/crypto.js';
import { COOKIE, readCookie } from '../auth/cookies.js';
import { config } from '../core/config.js';
import { ENVIRONMENTS } from '../core/environment.js';
import { getSetting } from '../admin/settings.js';
import { featureById } from '../features/registry.js';
import { linkPreviewFor, withPreview } from '../cards/meta.js';
import { DEV_TESTER_PATH, usableSecret } from './endpoint.js';

/**
 * DEV SIDE of the dev tester gate (0.10.3). Only on the dev site (environment 'dev') AND while its Features switch
 * "Dev tester gate" (features.devGate, default OFF) is on. Then:
 *
 *   - Every page and API needs a full sign-in (Battle.net, Discord or a passkey), except ALLOW below: what signing in
 *     needs, static files, /api/health, and the admin's own sign-in / enrolment. Dev's admin session passes the whole
 *     gate.
 *   - After sign-in, dev asks PRODUCTION (ENVIRONMENTS.production.origin + /api/internal/dev-tester, devgate/endpoint.js)
 *     about each provider identity linked to the account, until one says yes. Tester → in. Anyone else → the client
 *     shows "This is Everstats' private test site" (client/src/chrome/DevGatePage.jsx) with Sign out; the API answers
 *     403 { code: 'dev_gate' }.
 *   - Answers are cached in memory per account for CACHE_MS (3 minutes): a revoked badge locks the person out within that.
 *   - FAIL CLOSED: no secret on dev, a network error, a timeout (4 s), anything but 200 { tester: boolean } → state
 *     'unavailable': nobody but the admin gets in, and the page says production couldn't be asked. Failures are cached
 *     only FAIL_CACHE_MS, so it recovers quickly once production answers again.
 *   - Pages are served as the plain shell with the plain link preview while the gate is on (no character, guild or
 *     profile name in the head), whoever asks.
 *   - Only the yes / no ever comes back from production. Logs hold statuses and error names, never an id.
 *
 * Cloudflare Access's own paths (/cdn-cgi/access/…) are answered at Cloudflare's edge and never reach the origin, and
 * cloudflared's tunnel health checks don't reach the app either: the only origin health path is /api/health, which is
 * answered before this gate runs (app.js).
 */
export const CACHE_MS = 3 * 60 * 1000;
export const FAIL_CACHE_MS = 15 * 1000;
export const ASK_TIMEOUT_MS = 4000;
const CACHE_MAX = 5000;
const MAX_IDENTITIES = 10;

const API_ALLOW = [
  /^\/api\/health$/,
  /^\/api\/session$/,
  /^\/api\/dev-gate$/,
  /^\/api\/maintenance$/, // 0.10.3: the maintenance notice (admin-written text, nothing about anyone; release/maintenance.js)
  /^\/api\/theme-boot\.js$/,
  /^\/api\/auth\//, // providers, OAuth start, passkey sign-in, the 2FA code, sign-out
  /^\/api\/admin\/(sign-in|enroll)\//, // the admin's own sign-in and enrolment (every other admin route 404s without an admin session anyway)
];
const OTHER_ALLOW = [
  /^\/auth\/[a-z]+\/callback$/, // OAuth callbacks
  /^\/assets\//,
  /^\/licenses\//,
  /^\/fonts\//,
  /^\/favicon\.(ico|svg|png)$/,
  /^\/(site\.)?(manifest\.json|manifest\.webmanifest|webmanifest)$/,
  /^\/robots\.txt$/,
];
/** Pages the client draws normally while the gate blocks (it draws DevGatePage on every other page). */
export const PAGE_ALLOW = ['/sign-in', '/sign-in/2fa', '/admin/sign-in', '/admin/enroll'];

export const isAllowedPath = (path) => (path.startsWith('/api/') ? API_ALLOW : OTHER_ALLOW).some((re) => re.test(path));
/** A request for a page (the SPA shell), not a file or an image route. */
const isPageRequest = (req) => (req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/')
  && !/\.[a-z0-9]{2,5}$/i.test(req.path) && !req.path.startsWith('/og/') && !req.path.startsWith('/auth/');

async function isAdmin(db, req) {
  const token = readCookie(req, COOKIE.admin);
  if (!token) return false;
  return Boolean(await db.one('SELECT 1 AS x FROM admin_sessions WHERE id_hash = $1 AND expires_at > now()', [sha256Hex(token)]));
}

/**
 * @param {object} o
 * @param {object} o.db
 * @param {object} o.environment  this process's environment (core/environment.js)
 * @param {typeof fetch} [o.fetch] outbound HTTP (tests fake production)
 * @param {() => number} [o.now]   the clock the cache runs on (tests move it)
 * @param {() => string} [o.secret] DEV_TESTER_SECRET (the same value production has)
 */
export function createDevGate({ db, environment, fetch = globalThis.fetch, now = Date.now, secret = () => process.env.DEV_TESTER_SECRET, log = console }) {
  const url = `${ENVIRONMENTS.production.origin}${DEV_TESTER_PATH}`;
  const cache = new Map(); // accountId → { answer, at, ttl }
  const inFlight = new Map(); // accountId → Promise<answer>
  let lastLogAt = 0;

  /** Is the gate on? Dev only, and its Features switch (read from the feature's own store, for THIS environment). */
  async function isOn() {
    if (environment.id !== 'dev') return false;
    const f = featureById('dev-gate');
    return Boolean(await getSetting(db, f.store.setting));
  }

  const note = (what) => {
    if (now() - lastLogAt < 60_000) return;
    lastLogAt = now();
    log.warn(`[devgate] production couldn't be asked: ${what}`);
  };

  /** One identity → true | false, or throws when production didn't answer properly. */
  async function askOne(key, identity) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: identity.provider, subject: identity.subject }),
        redirect: 'error',
        signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      });
    } catch (err) {
      throw Object.assign(new Error('no answer'), { why: err?.name ?? 'error' });
    }
    if (res.status !== 200) throw Object.assign(new Error('bad status'), { why: `status ${res.status}` });
    let body;
    try {
      body = await res.json();
    } catch {
      throw Object.assign(new Error('bad body'), { why: 'not JSON' });
    }
    if (typeof body?.tester !== 'boolean') throw Object.assign(new Error('bad body'), { why: 'unexpected answer' });
    return body.tester;
  }

  /** 'allowed' | 'denied' | 'unavailable' for a signed-in account (asks production unless cached). */
  async function answerFor(accountId) {
    const hit = cache.get(accountId);
    if (hit && now() - hit.at < hit.ttl) return hit.answer;
    if (inFlight.has(accountId)) return inFlight.get(accountId);
    const p = (async () => {
      const key = usableSecret(secret());
      let answer;
      if (!key) {
        note('DEV_TESTER_SECRET is not set (or shorter than 32 characters) on this site');
        answer = 'unavailable';
      } else {
        const ids = await db.query('SELECT provider, subject FROM account_identities WHERE account_id = $1 ORDER BY linked_at, id LIMIT $2', [accountId, MAX_IDENTITIES]);
        let failed = false;
        answer = 'denied';
        for (const identity of ids) {
          try {
            if (await askOne(key, identity)) {
              answer = 'allowed';
              break;
            }
          } catch (err) {
            failed = true;
            note(err.why);
          }
        }
        // Fail closed: a "no" from one identity and no answer from another can't be told apart from a "yes" we missed.
        if (answer !== 'allowed' && failed) answer = 'unavailable';
      }
      if (cache.size >= CACHE_MAX) {
        for (const [k, v] of cache) if (now() - v.at >= v.ttl) cache.delete(k);
        while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      }
      cache.set(accountId, { answer, at: now(), ttl: answer === 'unavailable' ? FAIL_CACHE_MS : CACHE_MS });
      return answer;
    })().finally(() => inFlight.delete(accountId));
    inFlight.set(accountId, p);
    return p;
  }

  /** The gate state for this request: 'off' | 'sign-in' | 'allowed' | 'denied' | 'unavailable'. */
  async function stateFor(req) {
    if (!(await isOn())) return 'off';
    if (await isAdmin(db, req)) return 'allowed';
    const s = req.session;
    if (!s || s.stage === 'second_factor') return 'sign-in';
    if (s.stage !== 'full') return 'denied'; // a banned session
    return answerFor(Number(s.accountId));
  }

  let shell = null;
  /** The plain shell: index.html with the plain Everstats preview, never a character's, guild's or player's. */
  async function plainShell(req, res, next) {
    try {
      shell ??= await readFile(join(config.clientDist, 'index.html'), 'utf8');
    } catch {
      return next(); // no built client (dev with Vite, tests)
    }
    res.set('Cache-Control', 'no-cache');
    return res.type('html').send(withPreview(shell, await linkPreviewFor(db, '/', {}), `${config.publicOrigin}/`));
  }

  /** Middleware for every request after the session is loaded. */
  const middleware = async (req, res, next) => {
    try {
      if (!(await isOn())) return next();
      if (isAllowedPath(req.path)) return next();
      // Every page is the plain shell while the gate is on; the client asks /api/dev-gate and draws DevGatePage itself.
      if (isPageRequest(req)) return plainShell(req, res, next);
      const state = await stateFor(req);
      if (state === 'allowed') return next();
      res.set('Cache-Control', 'no-store');
      const message = state === 'unavailable'
        ? 'This is Everstats’ private test site, and production couldn’t be asked whether you’re a tester. Try again in a minute.'
        : 'This is Everstats’ private test site. Sign in with an account that tests Everstats.';
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: message, code: 'dev_gate', gate: state });
      return res.status(403).type('text/plain').send(message);
    } catch (err) {
      return next(err);
    }
  };

  /** GET /api/dev-gate → { gate }. */
  const route = async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ gate: await stateFor(req) });
    } catch (err) {
      next(err);
    }
  };

  return { middleware, route, stateFor, isOn, clear: () => cache.clear() };
}
