/**
 * Which Everstats this process is (0.10.2): `production` (https://everstats.app) or `dev` (https://dev.everstats.app,
 * the private test site). The ONE place the two environments are described. Both run the same image; only the
 * environment variable ENVIRONMENT, the compose file (docker-compose.yml / docker-compose.dev.yml) and each one's
 * own .env differ. RELEASING.md has the branch model.
 *
 * In Docker (NODE_ENV=production) ENVIRONMENT is required, and a process refuses to start unless everything it was
 * given matches its environment exactly: the public origin, the database host, the database name and the database
 * user. So a dev container handed production's database URL (or the other way round) stops before it connects.
 * The database itself also remembers which environment it belongs to (environment_marker, core/prepare.js): a dev
 * process that reaches production's database anyway refuses to touch it, and a dev database must start empty.
 *
 * Outside Docker (`npm run dev`, tests) ENVIRONMENT may be left out: that is `local`, with none of the checks.
 * ENVIRONMENT=dev locally shows the DEV marker and the dev defaults without the origin/database checks (for looking
 * at them); it is never what a deployed dev site runs as, because there NODE_ENV=production turns the checks on.
 */
export const ENVIRONMENTS = Object.freeze({
  production: Object.freeze({
    id: 'production',
    marker: null, // production never shows a marker
    origin: 'https://everstats.app',
    database: Object.freeze({ host: 'everstats-db', name: 'everstats', user: 'everstats' }),
    noindex: false,
    // Nightly backups kept (retention/policy.js): the newest 14 plus the first of every month.
    backups: Object.freeze({ nightly: 14, monthly: true }),
    // Admin settings whose default differs here (admin/settings.js). None: production's defaults are the registry's.
    settingDefaults: Object.freeze({}),
  }),
  dev: Object.freeze({
    id: 'dev',
    marker: 'DEV',
    origin: 'https://dev.everstats.app',
    database: Object.freeze({ host: 'everstats-dev-db', name: 'everstats_dev', user: 'everstats_dev' }),
    noindex: true,
    // Owner's decision (0.10.2): the last 3 nightly dumps, no monthly copies.
    backups: Object.freeze({ nightly: 3, monthly: false }),
    // Until dev's own Blizzard client ("Everstats Dev") is entered and the admin switches it on, the background crawl
    // is paused and the budget is low. A value saved on dev's admin page wins, as everywhere.
    settingDefaults: Object.freeze({ 'crawler.paused': true, 'crawler.requestsPerSecond': 2, 'discovery.requestsPerSecond': 2 }),
  }),
  local: Object.freeze({
    id: 'local',
    marker: null,
    origin: null,
    database: null,
    noindex: false,
    backups: Object.freeze({ nightly: 14, monthly: true }),
    settingDefaults: Object.freeze({}),
  }),
});

/** The two environments a deployed process may be. */
export const DEPLOYED = Object.freeze(['production', 'dev']);

const urlParts = (databaseUrl) => {
  try {
    const u = new URL(databaseUrl);
    return { host: u.hostname, name: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username) };
  } catch {
    return null;
  }
};

/**
 * Reads the environment from process variables → { env, problems }. `problems` lists, in words, every way the
 * variables don't match the environment (never a secret: the database password is never read here).
 */
export function resolveEnvironment(vars = process.env) {
  const deployed = vars.NODE_ENV === 'production';
  const asked = (vars.ENVIRONMENT ?? '').trim().toLowerCase();
  const problems = [];
  if (!asked) {
    if (deployed) problems.push('ENVIRONMENT is not set. Set ENVIRONMENT=production (everstats.app) or ENVIRONMENT=dev (dev.everstats.app) in this stack\'s .env.');
    return { env: ENVIRONMENTS.local, problems };
  }
  if (!DEPLOYED.includes(asked)) {
    problems.push(`ENVIRONMENT=${asked} is not one of ${DEPLOYED.join(', ')}.`);
    return { env: ENVIRONMENTS.local, problems };
  }
  const env = ENVIRONMENTS[asked];
  if (!deployed) return { env, problems };

  const origin = (vars.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  if (origin !== env.origin) problems.push(`ENVIRONMENT=${env.id} must serve ${env.origin}, but PUBLIC_ORIGIN is ${origin || 'not set'}.`);
  const db = urlParts(vars.DATABASE_URL ?? '');
  if (!db) {
    problems.push('DATABASE_URL is missing or not a URL.');
  } else {
    for (const part of ['host', 'name', 'user']) {
      if (db[part] !== env.database[part]) problems.push(`ENVIRONMENT=${env.id} must use the database ${part} "${env.database[part]}", but DATABASE_URL names "${db[part]}".`);
    }
  }
  // The other environment's values, named outright, so the message says what went wrong.
  for (const other of DEPLOYED.filter((id) => id !== env.id).map((id) => ENVIRONMENTS[id])) {
    if (origin === other.origin) problems.push(`PUBLIC_ORIGIN is ${other.id}'s address.`);
    if (db && db.host === other.database.host) problems.push(`DATABASE_URL points at ${other.id}'s database container.`);
  }
  return { env, problems };
}

const resolved = resolveEnvironment();
/** This process's environment (one of ENVIRONMENTS). */
export const ENVIRONMENT = resolved.env;

/** Start-up check for every process: exits with the reasons when the environment doesn't add up. */
export function assertEnvironment(processName, { exit = (code) => process.exit(code), log = console } = {}) {
  if (resolved.problems.length === 0) {
    log.log(`[${processName}] Environment: ${ENVIRONMENT.id}`);
    return ENVIRONMENT;
  }
  for (const p of resolved.problems) log.error(`[${processName}] Refusing to start: ${p}`);
  exit(1);
  return null;
}

/** The default of an admin setting in this environment (admin/settings.js). */
export function environmentDefault(key, registryDefault, env = ENVIRONMENT) {
  return Object.hasOwn(env.settingDefaults, key) ? env.settingDefaults[key] : registryDefault;
}
