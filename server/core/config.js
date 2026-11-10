import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIMARY_VERSION, REGIONS, blizzardContext, isRegionEnabled, regionById, versionById } from './gameVersions.js';

const DEFAULT_REGION = REGIONS.find((r) => r.enabled).id;

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');

// The two ports. These defaults are the ONE place they are written in the app; docker-compose.yml publishes the same
// numbers (WEB_PORT / WORKER_PORT override both) and the deploy probes them.
export const DEFAULT_WEB_PORT = 3260;
export const DEFAULT_WORKER_PORT = 3261;

const publicOrigin = (process.env.PUBLIC_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '');
const isHttps = publicOrigin.startsWith('https://');

export const config = {
  // Loopback by default, so `npm run dev` is never on the LAN. The Docker image sets 0.0.0.0: every interface of the
  // CONTAINER, which only the port Docker publishes on BIND_IP reaches.
  listenHost: process.env.LISTEN_HOST || '127.0.0.1',
  port: Number(process.env.PORT) || DEFAULT_WEB_PORT,
  workerPort: Number(process.env.WORKER_PORT) || DEFAULT_WORKER_PORT,
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5439/postgres',
  // Where the bulk snapshot tables live: the Postgres tablespace "snapshots" at this path INSIDE the database
  // container (docker-compose.yml mounts the array disk there). Unset (local dev): the default tablespace.
  snapshotTablespaceDir: process.env.SNAPSHOT_TABLESPACE_DIR || null,
  clientDist: resolve(REPO_ROOT, 'client', 'dist'),
  // Where the worker writes nightly database backups (core/backup.js). In Docker always /backups, the host folder in
  // the BACKUP_DIR Gitea variable mounted there (docker-compose.yml). Unset (local dev): backups are off, and say so.
  backupDir: process.env.BACKUP_DIR || null,
  // The address visitors use. OAuth redirect URIs, the passkey relying party and the CSRF origin check all derive from
  // it, so it must be exact: https://everstats.app in production, http://localhost:3000 for `npm run dev`.
  publicOrigin,
  secureCookies: isHttps,
  rpId: new URL(publicOrigin).hostname,
  // Region is configuration, not code (core/gameVersions.js REGIONS). Only an enabled region is accepted: US until 1.0.
  region: (process.env.REGION || DEFAULT_REGION).toLowerCase(),
};

if (!isRegionEnabled(config.region)) {
  throw new Error(`REGION=${config.region} is not supported yet: Everstats covers ${REGIONS.filter((r) => r.enabled).map((r) => r.id).join(', ')} until 1.0`);
}

/**
 * The primary game version in the configured region (0.10.0: built from core/gameVersions.js; before, the WoW Forever
 * namespaces were written here). The existing, unprefixed pages and jobs use this; per-version code asks
 * blizzardContext(version, region). There is no static entry: a static namespace is always DETECTED from the API's links.
 */
const primary = blizzardContext(PRIMARY_VERSION.id, config.region);
export const BLIZZARD_API = Object.freeze({
  version: primary.version,
  region: primary.region,
  apiHost: primary.apiHost,
  oauthHost: primary.oauthHost,
  locale: primary.locale,
  namespaces: primary.namespaces,
  paths: Object.freeze({
    rulesets: primary.paths.rulesets,
    character: '/profile/wow/character/{slug}', // the primary version is realmless; per-version code uses ctx.characterPath
    accountCharacters: primary.paths.accountCharacters,
  }),
});

/** The scope the existing (unprefixed) pages and jobs mean: { version, region }. */
export const PRIMARY_SCOPE = Object.freeze({ version: PRIMARY_VERSION.id, region: config.region });

/**
 * A SQL condition limiting rows to one scope: "c.game_version = 'forever' AND c.region = 'us'" for alias 'c'. Its
 * values come from the registry only (checked here), never from a request, so they are safe to write into SQL. The
 * existing pages pass nothing: the primary scope.
 */
export function scopeSql(alias = '', scope = PRIMARY_SCOPE) {
  const v = versionById(scope.version);
  const r = regionById(scope.region);
  if (!v || !r || !/^[a-z0-9-]+$/.test(v.id) || !/^[a-z]+$/.test(r.id)) throw new Error('scopeSql: not a registry scope');
  const a = alias ? `${alias}.` : '';
  return `${a}game_version = '${v.id}' AND ${a}region = '${r.id}'`;
}
