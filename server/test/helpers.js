import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Tests never touch data/ or a real server: each file gets a fresh in-memory Postgres (PGlite) on its own port, and a
// root key of its own. Set before any app module reads them.
process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
process.env.PUBLIC_ORIGIN ??= 'http://localhost:3000';
for (const k of ['BLIZZARD_CLIENT_ID', 'BLIZZARD_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']) delete process.env[k];

export const ORIGIN = process.env.PUBLIC_ORIGIN;

let nextPort = 15_400 + Math.floor(Math.random() * 2000);

/** A fresh, migrated database: { db, close }. */
export async function startDb() {
  const { createDb } = await import('../core/db.js');
  const { prepareDatabase } = await import('../core/prepare.js');
  const pglite = await PGlite.create();
  const port = nextPort++;
  const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 16 });
  await server.start();
  const db = createDb({ url: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 4 });
  await prepareDatabase(db, { processName: 'test', production: false });
  return {
    db,
    async close() {
      await db.close();
      await server.stop();
      await pglite.close();
    },
  };
}

/**
 * The web app on a real port, with a cookie jar per client.
 *   const t = await startApp({ fetch: fakeFetch }); const c = t.client(); await c.post('/api/…', body)
 */
export async function startApp({ fetch: outbound, now } = {}) {
  const { createApp } = await import('../app.js');
  const { db, close: closeDb } = await startDb();
  const app = createApp({ db, fetch: outbound, now });
  const server = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client({ ip = '203.0.113.7', origin = ORIGIN } = {}) {
    const jar = new Map();
    const store = (res) => {
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        const expired = attrs.some((a) => /^\s*expires=Thu, 01 Jan 1970/i.test(a)) || value === '';
        if (expired) jar.delete(name);
        else jar.set(name, value);
      }
    };
    async function request(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: 'manual',
        headers: {
          'CF-Connecting-IP': ip,
          ...(origin ? { Origin: origin } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      store(res);
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: res.status, headers: res.headers, json, text };
    }
    return {
      jar,
      get: (p, h) => request('GET', p, undefined, h),
      post: (p, b = {}, h) => request('POST', p, b, h),
      put: (p, b = {}, h) => request('PUT', p, b, h),
      del: (p, h) => request('DELETE', p, undefined, h),
    };
  }

  return {
    app,
    db,
    base,
    client,
    async close() {
      await new Promise((res) => server.close(res));
      await closeDb();
    },
  };
}
