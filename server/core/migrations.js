/**
 * Migration runner. Migrations are { id, up(q, ctx), transaction? } in server/core/schema.js, applied in order and
 * recorded in _migrations. The web app and the worker both run them at start-up; a Postgres advisory lock makes the
 * second one wait for the first instead of racing it. Each runs in its own transaction unless it says
 * `transaction: false` (CREATE TABLESPACE can't run inside one); those must be idempotent.
 */
const LOCK_KEY = 4_812_001; // any fixed number, the same in every process

export async function runMigrations(db, migrations, ctx = {}) {
  await db.withClient(async (q) => {
    await q.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await q.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id         text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      for (const m of migrations) {
        if (!m?.id || typeof m.up !== 'function') throw new Error('invalid migration: each needs { id, up(q, ctx) }');
        if (await q.one('SELECT 1 FROM _migrations WHERE id = $1', [m.id])) continue;
        if (m.transaction === false) {
          await m.up(q, ctx);
          await q.query('INSERT INTO _migrations (id) VALUES ($1)', [m.id]);
        } else {
          await q.query('BEGIN');
          try {
            await m.up(q, ctx);
            await q.query('INSERT INTO _migrations (id) VALUES ($1)', [m.id]);
            await q.query('COMMIT');
          } catch (err) {
            await q.query('ROLLBACK').catch(() => {});
            throw err;
          }
        }
        console.log(`[migrate] applied ${m.id}`);
      }
    } finally {
      await q.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  });
}
