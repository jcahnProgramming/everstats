import { PRIMARY_SCOPE } from './config.js';
import { isRegionEnabled, isVersionEnabled, versionById } from './gameVersions.js';

/**
 * URLs for game versions and regions (0.10.0; the scheme is the owner's to approve before 0.11.0 shows it).
 *
 *   The primary version in the configured region keeps EVERY existing URL, unprefixed and unchanged:
 *     /c/{name-surname}  /g/{guild}  /leaderboards/…  /tiers  /c/{slug}/share  /og/…png
 *   Every other version, and any version in another region, lives under /{version}/{region}/ with the same page names:
 *     /retail/us/c/{realm}/{name}            a character (realm versions: realm slug + name)
 *     /retail/us/g/{realm}/{guild}           a guild
 *     /retail/us/leaderboards/{realm-type}/… boards within a realm category
 *     /forever/eu/c/{name-surname}           a realmless version in another region (1.0)
 *     /api/v/{version}/{region}/…            the matching API
 *   /{primary}/{configured region}/… redirects (301) to the unprefixed URL, so there is one address per page.
 *
 * While a version (or region) is not enabled, everything under its prefix answers 404, pages and API alike. An enabled
 * non-primary version's pages arrive with 0.11.0; until then they 404 too (nothing pretends to work).
 */
export function parseVersionPrefix(path) {
  const m = /^\/([a-z0-9-]{2,32})\/([a-z]{2})(\/.*)?$/.exec(String(path));
  if (!m || !versionById(m[1])) return null;
  return { version: m[1], region: m[2], rest: m[3] ?? '/' };
}

const live = ({ version, region }) => isVersionEnabled(version) && isRegionEnabled(region) && versionById(version).regions.includes(region);

/** Pages: /{version}/{region}/… */
export function versionPageGate() {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = parseVersionPrefix(req.path);
    if (!p) return next();
    if (p.version === PRIMARY_SCOPE.version && p.region === PRIMARY_SCOPE.region) {
      const q = req.originalUrl.indexOf('?');
      return res.redirect(301, `${p.rest}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
    }
    // Not enabled: a plain 404, nothing about the version is said.
    if (!live(p)) return res.status(404).type('text/plain').send('Not found');
    // Enabled, but its pages arrive with 0.11.0: still a 404, never a page that pretends to work.
    return res.status(404).type('text/plain').send('Not found');
  };
}

/** API: /api/v/{version}/{region}/… (nothing is served there before 0.11.0). */
export function versionApiGate() {
  return (req, res, next) => {
    const m = /^\/v\/([a-z0-9-]{2,32})\/([a-z]{2})(\/.*)?$/.exec(req.path);
    if (!m) return next();
    return res.status(404).json({ error: 'Not found' });
  };
}
