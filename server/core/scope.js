import { AsyncLocalStorage } from 'node:async_hooks';
import { PRIMARY_VERSION, REGIONS, isRegionEnabled, isVersionEnabled, versionById } from './gameVersions.js';

/**
 * The REQUEST'S scope (0.11.1): which game version and region a public request is about.
 *
 * Every public router was written for the primary scope (WoW Forever, US): it looks characters and guilds up with
 * `scopeSql()`, loads `loadCatalog(db)`, lists `rulesetList(db)`. 0.11.1 serves the SAME routers again under
 * /api/v/{version}/{region}/… (core/versionRoutes.js); the mount runs each request inside `runInScope`, and those
 * defaults read `currentScope()` instead of the primary scope. Outside a scoped request (the unprefixed API, the
 * worker, the crawler, tests calling a function directly) `currentScope()` IS the primary scope, so nothing that
 * existed before changes what it means.
 *
 * Node only (AsyncLocalStorage): never imported by anything the client bundles (core/gameVersions.js and
 * crawler/queue.js stay browser-safe; server/test/game-versions.test.js follows the imports).
 */
const storage = new AsyncLocalStorage();
const env = process.env;
const DEFAULT_REGION = REGIONS.find((r) => r.enabled).id;
const configuredRegion = () => (env.REGION || DEFAULT_REGION).toLowerCase();

/** The primary scope, without importing core/config.js (which imports this file). */
export const primaryScope = () => ({ version: PRIMARY_VERSION.id, region: configuredRegion() });

export function currentScope() {
  return storage.getStore() ?? primaryScope();
}

/** Is the current request about a version other than the primary one (in the primary region)? */
export function inPrimaryScope(scope = currentScope()) {
  const p = primaryScope();
  return scope.version === p.version && scope.region === p.region;
}

/** A scope a request may be served in: a registry version that is enabled, in an enabled region it is played in. */
export function liveScope(version, region) {
  const v = versionById(version);
  if (!v || !isVersionEnabled(v.id) || !isRegionEnabled(region) || !v.regions.includes(region)) return null;
  return Object.freeze({ version: v.id, region });
}

export function runInScope(scope, fn) {
  return storage.run(Object.freeze({ version: scope.version, region: scope.region }), fn);
}

/** Express middleware: the rest of this request runs in `scope`. */
export const scopeMiddleware = (scope) => (req, res, next) => runInScope(scope, next);

/**
 * How a character or guild is written in a URL and in API answers (0.11.1):
 *   realmless version   "name-surname" / "guild-slug"            (unchanged)
 *   realm version       "realm-slug/name" / "realm-slug/guild"   (pages: /{version}/{region}/c/{realm}/{name})
 * Inside the API a realm version's two segments travel as ONE key, "realm~name" (core/versionRoutes.js joins them
 * before the routers see the path), so `/characters/:slug/collections` can't mistake a name for a sub-page.
 */
export const KEY_JOIN = '~';
export const pathSlug = (row) => (row?.realm_slug ? `${row.realm_slug}/${row.slug}` : row?.slug ?? null);
export function splitKey(key, scope = currentScope()) {
  const k = String(key ?? '');
  if (!versionById(scope.version)?.realms) return { realmSlug: null, slug: k };
  const i = k.indexOf(KEY_JOIN) >= 0 ? k.indexOf(KEY_JOIN) : k.indexOf('/');
  return i > 0 ? { realmSlug: k.slice(0, i).toLowerCase(), slug: k.slice(i + 1) } : { realmSlug: null, slug: k };
}
