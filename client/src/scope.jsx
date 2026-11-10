import { forwardRef, useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  Link as RouterLink, NavLink as RouterNavLink, Navigate as RouterNavigate, useLocation, useNavigate as useRouterNavigate, useParams as useRouterParams,
} from 'react-router-dom';
import { useSession } from './session.jsx';

/**
 * GAME VERSIONS on the public site (0.11.1). The server says which versions a visitor can see (`/api/session`
 * `versions`: the primary one, plus every version the admin has switched on); nothing here names a version.
 *
 * Addresses (approved scheme, server/core/versionRoutes.js):
 *   the primary version    /c/{name-surname}  /g/{guild}  /leaderboards/…  /guilds  /tiers          (unchanged, unprefixed)
 *   every other version    /{version}/{region}/c/{realm}/{name}  …/g/{realm}/{guild}  …/leaderboards/…  …/guilds  …/tiers
 *   and its API            /api/v/{version}/{region}/…  (the same answers, about that version)
 *
 * A page's version is the one in ITS ADDRESS. Every page component is used for both shapes, unchanged: this module's
 * `Link`, `NavLink`, `Navigate`, `useNavigate` and `useParams` stand in for react-router's (every public page imports
 * them from here) and keep a page inside its version:
 *   - a link to a version page (`/c/…`, `/g/…`, `/leaderboards…`, `/guilds`, `/tiers…`) written the old way gets the
 *     current page's prefix; a link that names its own version (`scope={version id}`: a dashboard or profile row,
 *     which lists several versions) gets that one's;
 *   - `useParams().slug` is "realm/name" on a version with realms, so `/c/${slug}` and `/api/characters/${slug}` read
 *     the same on every version (a slug passed through encodeURIComponent has its slash put back);
 *   - `api()` (api.js) sends a version page's calls to that version's API.
 *
 * Pages that belong to no version (home, search, settings, profiles) use the visitor's CHOSEN version (the header's
 * switcher) where it matters; the choice is remembered in this browser (localStorage: a convenience, never needed).
 */
const VERSION_PAGES = /^\/(?:c|g|leaderboards|guilds|tiers)(?:\/|$|\?|#)/;
const STORE_KEY = 'everstats.gameVersion';

// ---- what the server last said (module-level, so api.js can ask without React) ----
let known = { region: null, list: [] };
export function setKnownVersions(v) {
  if (v && Array.isArray(v.list)) known = { region: v.region ?? null, list: v.list };
}
const primaryOf = (list) => list.find((v) => v.primary) ?? list[0] ?? null;
const other = (id) => known.list.find((v) => v.id === id && !v.primary) ?? null;

/** "/retail/us/leaderboards" → { version, region, rest: "/leaderboards" } when that version is on; else null. */
export function scopeOfPath(pathname) {
  const m = /^\/([a-z0-9-]{2,32})\/([a-z]{2})(\/.*)?$/.exec(String(pathname ?? ''));
  if (!m || !other(m[1]) || m[2] !== known.region) return null;
  return { version: m[1], region: m[2], rest: m[3] ?? '/' };
}
export const prefixOf = (versionId) => (other(versionId) && known.region ? `/${versionId}/${known.region}` : '');
const unslash = (path) => path.replace(/%2F/gi, '/');

/** A link target inside a version: prefixed when it is a version page and isn't prefixed already. */
export function scopedTo(to, versionId) {
  if (typeof to !== 'string' || !VERSION_PAGES.test(to)) return to;
  const q = to.search(/[?#]/);
  const path = unslash(q >= 0 ? to.slice(0, q) : to);
  return `${prefixOf(versionId)}${path}${q >= 0 ? to.slice(q) : ''}`;
}

/** The API address for a path in a version (api.js): "/api/characters/x" → "/api/v/{version}/{region}/characters/x". */
const VERSION_API = /^\/api\/(?:characters|leaderboards|guilds|guild-boards|statistics|coverage|tiers|gold-boards|items|realms|cards|search(?!\/all))(?:\/|$|\?)/;
export function scopedApi(path, versionId) {
  if (typeof path !== 'string' || !VERSION_API.test(path)) return path;
  const q = path.indexOf('?');
  const head = unslash(q >= 0 ? path.slice(0, q) : path);
  const prefix = prefixOf(versionId);
  return `${prefix ? `/api/v${prefix}` : '/api'}${head.slice(4)}${q >= 0 ? path.slice(q) : ''}`;
}
/** The version of the page the browser is on right now (api.js's default), or null for the primary one. */
export const versionOfLocation = () => (typeof window === 'undefined' ? null : scopeOfPath(window.location.pathname)?.version ?? null);

// ---- the visitor's chosen version (remembered in this browser) ----
const listeners = new Set();
let chosenMemo = null;
function readChosen() {
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function rememberVersion(id) {
  chosenMemo = id;
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    // private window or blocked storage: the choice lasts for this page load
  }
  listeners.forEach((fn) => fn());
}
const getChosen = () => chosenMemo ?? (chosenMemo = readChosen());

/**
 * The version a component is in: the page's (from the address) or, on a page of no version, the visitor's choice.
 * → { version, region, prefix, primary, fromUrl, meta, versions, rest, pick(id) }
 */
export function useScope() {
  const session = useSession();
  const { pathname } = useLocation();
  const versions = session.versions?.list ?? [];
  const region = session.versions?.region ?? null;
  setKnownVersions(session.versions);
  const chosen = useSyncExternalStore(subscribe, getChosen, () => null);
  return useMemo(() => {
    const primary = primaryOf(versions);
    const at = scopeOfPath(pathname);
    const versionPage = VERSION_PAGES.test(at ? at.rest : pathname);
    const fromUrl = Boolean(at) || versionPage;
    const id = at ? at.version : versionPage ? primary?.id : versions.some((v) => v.id === chosen) ? chosen : primary?.id;
    const meta = versions.find((v) => v.id === id) ?? primary;
    return {
      version: meta?.id ?? null, region, meta, versions, primary: Boolean(meta?.primary), fromUrl,
      prefix: meta && !meta.primary && region ? `/${meta.id}/${region}` : '',
      /** The page's own path without its version prefix ("/leaderboards/3/60"). */
      rest: at ? at.rest : pathname,
    };
  }, [versions, region, pathname, chosen]);
}

/** Its page prefix for a version id ('' for the primary one). */
export function useVersionPrefix() {
  const { versions, region } = useScope();
  return useCallback((id) => {
    const v = versions.find((x) => x.id === id);
    return v && !v.primary && region ? `/${v.id}/${region}` : '';
  }, [versions, region]);
}

// ---- react-router's pieces, kept inside the page's version ----
function useTo() {
  const scope = useScope();
  // `scope` on a link names its version outright (lists that mix versions); otherwise the page's own (from its address).
  return useCallback((to, explicit) => {
    const id = explicit === undefined ? (scope.fromUrl ? scope.version : null) : explicit;
    if (typeof to === 'string') return scopedTo(to, id);
    if (to && typeof to === 'object' && typeof to.pathname === 'string') return { ...to, pathname: scopedTo(to.pathname, id) };
    return to;
  }, [scope.fromUrl, scope.version]);
}

export const Link = forwardRef(function ScopedLink({ to, scope, ...rest }, ref) {
  const fix = useTo();
  return <RouterLink ref={ref} to={fix(to, scope)} {...rest} />;
});

export const NavLink = forwardRef(function ScopedNavLink({ to, scope, ...rest }, ref) {
  const fix = useTo();
  return <RouterNavLink ref={ref} to={fix(to, scope)} {...rest} />;
});

export function Navigate({ to, scope, ...rest }) {
  const fix = useTo();
  return <RouterNavigate to={fix(to, scope)} {...rest} />;
}

export function useNavigate() {
  const navigate = useRouterNavigate();
  const fix = useTo();
  return useCallback((to, options) => (typeof to === 'number' ? navigate(to) : navigate(fix(to, options?.scope), options)), [navigate, fix]);
}

/** react-router's params; on a version with realms `slug` is "realm/name" (the two segments of the address). */
export function useParams() {
  const p = useRouterParams();
  return useMemo(() => (p.realm && p.slug ? { ...p, slug: `${p.realm}/${p.slug}` } : p), [p]);
}
