import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // Region is configuration, not code. 1.0 is US only; nothing else is accepted until it is built.
  region: (process.env.REGION || 'us').toLowerCase(),
};

if (config.region !== 'us') {
  throw new Error(`REGION=${config.region} is not supported: Everstats 1.0 covers the US region only`);
}

/**
 * Blizzard WoW Forever API placeholders. UNDOCUMENTED and UNVERIFIED (community probing, Nov 2026): nothing calls
 * these yet. The discovery pass with real credentials confirms or corrects every value before anything is built on it.
 */
export const BLIZZARD_API = Object.freeze({
  apiHost: `https://${config.region}.api.blizzard.com`,
  oauthHost: 'https://oauth.battle.net',
  namespaces: Object.freeze({
    static: `static-forever-${config.region}`,
    dynamic: `dynamic-forever-${config.region}`,
    profile: `profile-forever-${config.region}`,
  }),
  paths: Object.freeze({
    rulesets: '/data/wow/ruleset/index', // dynamic namespace
    character: '/profile/wow/character/{slug}', // profile namespace; slug is {name}-{surname}, lower case
    accountCharacters: '/profile/user/wow', // user token, scope wow.profile
  }),
});
