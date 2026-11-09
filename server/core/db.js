import pg from 'pg';
import { config } from './config.js';

// BIGINT (int8) comes back as a string by default; every id and count here fits in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * The Postgres pool. The web app, the worker (and later the read-only MCP container) each open their own.
 * In production DATABASE_URL points at the everstats-db container; in `npm run dev` and in tests it points at an
 * embedded PGlite behind a socket (scripts/dev-db.js, server/test/helpers.js), so there is one code path.
 *
 *   db.query(sql, params)   → rows
 *   db.one(sql, params)     → first row or null
 *   db.tx(async (q) => …)   → runs fn inside BEGIN/COMMIT on one connection; q has query/one too
 */
export function createDb({ url = config.databaseUrl, max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000 });
  // An idle client losing its connection (the database restarting) must not crash the process.
  pool.on('error', (err) => console.error(`[db] idle connection error: ${err.code ?? err.name}`));

  const wrap = (client) => ({
    query: async (sql, params) => (await client.query(sql, params)).rows,
    one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
  });
  const base = wrap(pool);

  return {
    ...base,
    pool,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    /** One connection for work that must stay on it (an advisory lock, a statement outside a transaction). */
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await fn(wrap(client), client);
      } finally {
        client.release();
      }
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}

/**
 * Cursor pagination. Every list query in this app goes through it: no unbounded selects, ever.
 * `limit` is clamped to [1, max]; the caller asks for limit + 1 rows to know whether there is a next page.
 */
export function pageLimit(raw, { fallback = 50, max = 100 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
