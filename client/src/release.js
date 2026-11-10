import changelog from '../../CHANGELOG.json';

/**
 * The app version and release notes, from CHANGELOG.json at the repo root: the single place a release is recorded.
 * The newest entry is the version. Baked in at build time.
 *
 * 0.10.2: two sites (RELEASING.md). An entry may carry `kind`:
 *   'dev'      a build on the dev site only ("In testing"); never reaches production as its own entry
 *   'release'  a release to production (0.x.0): the dev builds it rolls up are kept under it in `tested`
 *   'hotfix'   a patch straight to production
 * An entry with no kind is a release from before 0.10.2.
 */
export const RELEASES = changelog.releases;
export const APP_VERSION = RELEASES[0].version;

/**
 * Which site this page is on: 'dev' when the server's theme boot (/api/theme-boot.js, before first paint) marked it,
 * else 'production'. Set by the server from its own environment, never by the page.
 */
export const SITE_ENVIRONMENT = typeof document !== 'undefined' && document.documentElement.getAttribute('data-es-env') === 'dev' ? 'dev' : 'production';

/**
 * The entries a site's changelog shows. Production: releases and hotfixes only (a dev build never shows there, even
 * if one were left in by mistake). Dev: everything.
 */
export function visibleReleases(releases = RELEASES, site = SITE_ENVIRONMENT) {
  return site === 'dev' ? releases : releases.filter((r) => r.kind !== 'dev');
}

/** "0.10.3–0.10.5" (or "0.10.3") for the dev builds a release was tested as; null when it has none. */
export function testedRange(release) {
  const versions = (release.tested ?? []).map((t) => t.version);
  if (versions.length === 0) return null;
  const sorted = [...versions].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return sorted.length === 1 ? sorted[0] : `${sorted[0]}–${sorted.at(-1)}`;
}
