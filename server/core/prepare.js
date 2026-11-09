import { config } from './config.js';
import { runMigrations } from './migrations.js';
import { migrations } from './schema.js';
import { ensureSnapshotTablespace } from './tablespace.js';

/**
 * Start-up for every process that opens the database (web, worker): waits for Postgres (the database container may
 * still be starting), makes sure the snapshots tablespace is where config says, then runs migrations. Both steps are
 * safe to run from two processes at once (migrations take an advisory lock; the tablespace check is idempotent and
 * runs under the same lock).
 */
export async function prepareDatabase(db, { processName, waitMs = 60_000, production = process.env.NODE_ENV === 'production' } = {}) {
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
      await ensureSnapshotTablespace(q, config.snapshotTablespaceDir, { production });
    } finally {
      await q.query('SELECT pg_advisory_unlock(4812002)');
    }
  });
  await runMigrations(db, migrations);
}
