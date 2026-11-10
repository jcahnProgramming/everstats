import { PRIMARY_SCOPE } from '../core/config.js';
import { regionById } from '../core/gameVersions.js';

/**
 * The Blizzard source: an app token (client credentials) and paced, retried GETs against the regional API host.
 * Everything that reads Blizzard goes through one of these (sources/registry.js), so a second source can be added
 * beside it without touching the callers.
 *
 *   const src = createBlizzardSource({ clientId, clientSecret, fetch, perSecond, region })
 *   await src.get('/data/wow/ruleset/index', { namespace: ctx.namespaces.dynamic })           app token
 *   (0.10.0: one source per REGION: its API host, OAuth host and locale come from core/gameVersions.js REGIONS; the
 *   namespace, which names the game version, is always the caller's.)
 *   await src.get(href, { auth: 'user', userToken })                                            a user's token
 *   await src.get('/data/wow/search/mount', { namespace, query: { orderby: 'id', _page: 1 } })  named extra parameters
 *   → { path, namespace, auth, status, latencyMs, attempts, headers, contentType, bytes, body, truncated, json,
 *       error, fetchedAt }
 *
 * Rules:
 *   - Tokens travel ONLY in the Authorization header, never in a URL, so a stored path can never hold one.
 *   - Only the API host gets a token: an href pointing anywhere else is refused (foreign_host), never fetched.
 *   - Pacing: at most `perSecond` requests start per second and `maxInFlight` run at once. Blizzard documents
 *     100 requests a second and 36,000 an hour per client.
 *   - 429 and 503 are retried (Retry-After when given, else 1 s, 2 s), up to `maxAttempts`; the final answer is
 *     what's returned, with the attempt count.
 *   - Response headers are kept (minus set-cookie) because nobody has documented Forever's rate-limit headers yet.
 *   - Errors are this module's own words or a name/code: never a response body, never a token.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class SourceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createBlizzardSource({
  clientId,
  clientSecret,
  fetch = globalThis.fetch,
  perSecond = 10,
  maxInFlight = 4,
  maxAttempts = 3,
  timeoutMs = 20_000,
  region = PRIMARY_SCOPE.region,
  locale = null,
  now = Date.now,
  sleep = defaultSleep,
  api = null,
} = {}) {
  const reg = regionById(region);
  if (!reg && !api) throw new SourceError(`Unknown region ${region}`, 'bad_region');
  api ??= { apiHost: reg.apiHost, oauthHost: reg.oauthHost };
  locale ??= reg?.locale ?? null;
  const apiOrigin = new URL(api.apiHost).origin;
  let token = null; // { value, expiresAt }

  // ---- pacing: a start-time ladder plus an in-flight cap
  let nextStart = 0;
  let inFlight = 0;
  const waiting = [];
  async function slot() {
    if (inFlight >= maxInFlight) await new Promise((r) => waiting.push(r));
    inFlight += 1;
    const t = now();
    const at = Math.max(t, nextStart);
    nextStart = at + 1000 / perSecond;
    if (at > t) await sleep(at - t);
  }
  function release() {
    inFlight -= 1;
    waiting.shift()?.();
  }

  async function appToken() {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
    let res;
    try {
      res = await fetch(`${api.oauthHost}/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SourceError(`Couldn't reach Battle.net for an app token (${err?.name ?? 'Error'})`, 'token_unreachable');
    }
    const body = res.ok ? await res.json().catch(() => null) : null;
    if (!body?.access_token) {
      throw new SourceError(`Battle.net refused an app token (HTTP ${res.status}). Check the Blizzard keys in the admin key manager.`, 'token_refused');
    }
    token = { value: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }

  /**
   * A path or an href → { url, path, namespace }. Refuses any host but the API's. An href's own query is dropped (only
   * its namespace is kept); `query` adds parameters the caller names (search filters, 0.8.3), never a namespace, locale
   * or token, and they are part of the returned `path`, so a stored row says exactly what was asked.
   */
  function resolve(pathOrHref, namespace, query = null) {
    let url;
    try {
      url = new URL(pathOrHref, apiOrigin);
    } catch {
      throw new SourceError('Not a URL', 'bad_url');
    }
    if (url.origin !== apiOrigin) throw new SourceError('Refused: that link points away from the Blizzard API host', 'foreign_host');
    const ns = namespace ?? url.searchParams.get('namespace') ?? null;
    const clean = new URL(url.pathname, apiOrigin);
    if (ns) clean.searchParams.set('namespace', ns);
    if (locale) clean.searchParams.set('locale', locale);
    const extra = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (k === 'namespace' || k === 'locale' || /token/i.test(k)) throw new SourceError('Refused: the source sets that parameter itself', 'bad_query');
      extra.set(k, String(v));
      clean.searchParams.set(k, String(v));
    }
    const qs = extra.toString();
    return { url: clean.toString(), path: qs ? `${url.pathname}?${qs}` : url.pathname, namespace: ns };
  }

  async function get(pathOrHref, { namespace, auth = 'app', userToken = null, query = null } = {}) {
    const { url, path, namespace: ns } = resolve(pathOrHref, namespace, query);
    if (auth === 'user' && !userToken) throw new SourceError('No user token for a user-token request', 'no_user_token');
    const bearer = auth === 'user' ? userToken : await appToken();
    const out = { path, namespace: ns, auth, status: null, latencyMs: null, attempts: 0, headers: {}, contentType: null, bytes: null, body: null, truncated: false, json: null, error: null, fetchedAt: null };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await slot();
      out.attempts = attempt;
      out.fetchedAt = new Date(now()).toISOString();
      const started = performance.now();
      let res;
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
        const buf = Buffer.from(await res.arrayBuffer());
        out.latencyMs = Math.round(performance.now() - started);
        out.status = res.status;
        out.headers = {};
        for (const [k, v] of res.headers) if (k !== 'set-cookie') out.headers[k] = v;
        out.contentType = res.headers.get('content-type');
        out.bytes = buf.length;
        out.truncated = buf.length > MAX_BODY_BYTES;
        out.body = buf.subarray(0, MAX_BODY_BYTES).toString('utf8');
        out.error = null;
      } catch (err) {
        out.latencyMs = Math.round(performance.now() - started);
        out.status = null;
        out.error = `${err?.name ?? 'Error'}${err?.code ? ` (${err.code})` : ''}`.slice(0, 200);
      } finally {
        release();
      }
      const retryable = out.status === 429 || out.status === 503;
      if (!retryable || attempt === maxAttempts) break;
      const after = Number(res?.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1000 * attempt);
    }
    if (out.body !== null && !out.truncated) {
      try {
        out.json = JSON.parse(out.body);
      } catch {
        out.json = null;
      }
    }
    return out;
  }

  return { id: 'blizzard', region, apiHost: api.apiHost, get, appToken, resolve };
}
