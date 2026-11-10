import express from 'express';
import { versionById } from './gameVersions.js';
import { KEY_JOIN, inPrimaryScope, liveScope, runInScope } from './scope.js';

/**
 * URLs for game versions and regions (0.10.0 proposal; approved by the owner and built in 0.11.1).
 *
 *   The primary version in the configured region keeps EVERY existing URL, unprefixed and unchanged:
 *     /c/{name-surname}  /g/{guild}  /leaderboards/…  /tiers  /c/{slug}/share  /og/…png
 *   Every other version lives under /{version}/{region}/ with the same page names:
 *     /retail/us/c/{realm}/{name}            a character (realm versions: realm slug + name)
 *     /retail/us/g/{realm}/{guild}           a guild
 *     /retail/us/leaderboards/…              its boards (one pool per region on Retail; realm type is a filter)
 *     /api/v/{version}/{region}/…            the matching API: the SAME routers, run in that scope (core/scope.js)
 *   /{primary}/{configured region}/… redirects (301) to the unprefixed URL, so there is one address per page.
 *
 * While a version (or region) is not switched on, everything under its prefix answers a plain 404, pages and API
 * alike: nothing about the version is said.
 */
export function parseVersionPrefix(path) {
  const m = /^\/([a-z0-9-]{2,32})\/([a-z]{2})(\/.*)?$/.exec(String(path));
  if (!m || !versionById(m[1])) return null;
  return { version: m[1], region: m[2], rest: m[3] ?? '/' };
}

/**
 * On a realm version a character or guild is two path segments (realm, name). The routers match ONE key segment, so
 * the two are joined ("area-52~thrall") before routing: `/characters/{realm}/{name}/collections` can then never read a
 * name as a sub-page. `heads` are the path heads whose next two segments are a realm and a name.
 */
export function joinRealmKeys(url, heads) {
  const q = url.indexOf('?');
  const path = q >= 0 ? url.slice(0, q) : url;
  const query = q >= 0 ? url.slice(q) : '';
  for (const head of heads) {
    if (!path.startsWith(`${head}/`)) continue;
    const rest = path.slice(head.length + 1).split('/');
    if (rest.length < 2 || !rest[0] || !rest[1] || rest[0].includes(KEY_JOIN)) return url;
    return `${head}/${rest[0]}${KEY_JOIN}${rest.slice(1).join('/')}${query}`;
  }
  return url;
}
const API_KEY_HEADS = ['/characters', '/guilds'];
const PAGE_KEY_HEADS = ['/og/c', '/og/k', '/og/t', '/og/g'];

/** Pages: /{version}/{region}/… → the primary scope redirects to the unprefixed URL; a version that isn't on is a 404. */
export function versionPageGate() {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = parseVersionPrefix(req.path);
    if (!p) return next();
    const scope = liveScope(p.version, p.region);
    if (scope && inPrimaryScope(scope)) {
      const q = req.originalUrl.indexOf('?');
      return res.redirect(301, `${p.rest}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
    }
    // Not switched on (or no such region): a plain 404, nothing about the version is said.
    if (!scope) return res.status(404).type('text/plain').send('Not found');
    return next();
  };
}

/**
 * Runs `router` for /{prefix}/{version}/{region}/… inside that scope. A version that isn't on answers `notFound(res)`;
 * the primary scope has no prefixed API (its API is the unprefixed one), so it is a 404 there too.
 */
function scoped(router, { heads, notFound }) {
  const r = express.Router();
  r.use('/:version/:region', (req, res, next) => {
    const scope = liveScope(String(req.params.version), String(req.params.region));
    if (!scope || inPrimaryScope(scope)) return notFound(res);
    if (versionById(scope.version).realms) req.url = joinRealmKeys(req.url, heads);
    return runInScope(scope, () => router(req, res, next));
  });
  return r;
}

/** API: mount at /api/v. Everything the routers don't answer falls through to the API's own 404. */
export const versionApi = (router) => scoped(router, { heads: API_KEY_HEADS, notFound: (res) => res.status(404).json({ error: 'Not found' }) });

/**
 * Card images under a version's page prefix (/retail/us/card.png, /retail/us/og/c/{realm}/{name}.png): mount at /.
 * Only paths the image router knows are taken; every other /{version}/{region}/… page goes on to the client.
 */
export function versionImages(router) {
  const inner = scoped(router, { heads: PAGE_KEY_HEADS, notFound: (res) => res.status(404).type('text/plain').send('Not found') });
  return (req, res, next) => {
    const p = parseVersionPrefix(req.path);
    if (!p || !(p.rest === '/card.png' || p.rest.startsWith('/og/'))) return next();
    return inner(req, res, next);
  };
}
