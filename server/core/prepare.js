import { config } from './config.js';
import { ENVIRONMENT, ENVIRONMENTS } from './environment.js';
import { runMigrations } from './migrations.js';
import { migrations } from './schema.js';
import { ensureSnapshotTablespace } from './tablespace.js';

/**
 * Start-up for every process that opens the database (web, worker): waits for Postgres (the database container may
 * still be starting), makes sure the snapshots tablespace is where config says, then runs migrations. Both steps are
 * safe to run from two processes at once (migrations take an advisory lock; the tablespace check is idempotent and
 * runs under the same lock).
 */
export async function prepareDatabase(db, { processName, waitMs = 60_000, production = process.env.NODE_ENV === 'production', environment = ENVIRONMENT } = {}) {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      await db.ping();
      break;
    } catch (err) {
      if (Date.now() > until) throw new Error(`database unreachable after ${waitMs / 1000}s (${err.code ?? err.name})`);
      console.log(`[${processName}] waiting for the database…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await db.withClient(async (q) => {
    await q.query('SELECT pg_advisory_lock(4812002)');
    try {
      // 0.10.2: BEFORE any migration runs, so a process in the wrong environment changes nothing.
      // A process outside Docker (npm run dev, tests) is always 'local' here, whatever ENVIRONMENT says, so a local
      // database is never stamped production or dev.
      await checkEnvironmentMarker(q, production ? environment : ENVIRONMENTS.local, { deployed: production });
      await ensureSnapshotTablespace(q, config.snapshotTablespaceDir, { production });
    } finally {
      await q.query('SELECT pg_advisory_unlock(4812002)');
    }
  });
  await runMigrations(db, migrations);
  await db.withClient((q) => recordEnvironmentMarker(q, production ? environment : ENVIRONMENTS.local));
}

/**
 * 0.10.2: the database remembers which environment it belongs to (environment_marker, one row, written by the first
 * process that starts on it). A process of another environment refuses to touch it, so dev pointed at production's
 * database (or a production backup restored into dev) stops here, before a migration runs. A database with no marker:
 *   - production's own from before 0.10.2: taken as production's on its first start with ENVIRONMENT=production;
 *   - for a DEPLOYED dev process it must be EMPTY (no accounts, no characters): dev starts from nothing, never from a
 *     copy of production.
 */
export async function checkEnvironmentMarker(q, environment, { deployed = false } = {}) {
  const has = async (table) => Boolean((await q.one('SELECT to_regclass($1) AS t', [`public.${table}`]))?.t);
  if (await has('environment_marker')) {
    const row = await q.one('SELECT environment FROM environment_marker LIMIT 1');
    if (row && row.environment !== environment.id) {
      throw new Error(`this database belongs to the ${row.environment} environment and this process is ${environment.id}: refusing to touch it`);
    }
    if (row) return;
  }
  if (environment.id === 'dev' && deployed) {
    for (const table of ['accounts', 'characters']) {
      if ((await has(table)) && (await q.one(`SELECT 1 AS x FROM ${table} LIMIT 1`))) {
        throw new Error(`a dev database must start empty, and this one already has rows in ${table} (is it production's?): refusing to touch it`);
      }
    }
  }
}

/** Writes the marker once (the first start on a database), then reads it back (two processes may race). */
export async function recordEnvironmentMarker(q, environment) {
  await q.query('INSERT INTO environment_marker (environment) VALUES ($1) ON CONFLICT DO NOTHING', [environment.id]);
  const row = await q.one('SELECT environment FROM environment_marker LIMIT 1');
  if (row?.environment !== environment.id) throw new Error(`this database belongs to the ${row?.environment} environment, not ${environment.id}`);
}
