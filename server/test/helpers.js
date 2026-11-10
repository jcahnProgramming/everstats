import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Tests never touch data/ or a real server: each file gets a fresh in-memory Postgres (PGlite) on its own port, and a
// root key of its own. Set before any app module reads them.
process.env.EVERSTATS_ROOT_KEY ??= randomBytes(32).toString('base64');
process.env.PUBLIC_ORIGIN ??= 'http://localhost:3000';
process.env.EVERSTATS_TESTING = '1';
for (const k of ['BLIZZARD_CLIENT_ID', 'BLIZZARD_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']) delete process.env[k];

export const ORIGIN = process.env.PUBLIC_ORIGIN;

let nextPort = 15_400 + Math.floor(Math.random() * 2000);

/**
 * 0.9.2: makes every connection's extended-query sequence reach PGlite in ONE piece. PGlite is a single Postgres session
 * behind the socket server, whose queue runs each protocol MESSAGE exclusively and keeps a connection's messages
 * together only inside an explicit transaction. Outside one, two pooled connections (say the running crawler and a
 * test's own queries) could interleave Parse / Bind / Execute, and one connection's Bind met the other's unnamed
 * statement ("bind message supplies 1 parameters, but prepared statement "" requires 2"), at random: the guild-fetch
 * test's intermittent failure. Here each connection's messages are held until its Sync (or a simple Query, Flush,
 * Terminate, or a non-typed startup message) and handed over together; the earlier ones resolve at once with nothing
 * written, and PGlite's answers go to the socket through the last message's writer, which is the same socket.
 */
const BOUNDARY = new Set(['S', 'Q', 'H', 'X', 'p'].map((c) => c.charCodeAt(0)));
function wholeSequences(queue) {
  if (!queue || typeof queue.enqueue !== 'function') throw new Error('pglite-socket changed: no queryQueue.enqueue to wrap');
  const original = queue.enqueue.bind(queue);
  const held = new Map(); // handler id → Buffer of messages waiting for their Sync
  queue.enqueue = (id, message, onData) => {
    const type = message[0];
    const typed = type >= 0x41 && type <= 0x7a; // a startup / SSL / cancel message starts with its length, not a letter
    const buf = held.has(id) ? Buffer.concat([held.get(id), Buffer.from(message)]) : Buffer.from(message);
    if (typed && !BOUNDARY.has(type)) {
      held.set(id, buf);
      return Promise.resolve(0);
    }
    held.delete(id);
    return original(id, new Uint8Array(buf), onData);
  };
}

/** A fresh, migrated database: { db, close }. */
export async function startDb() {
  const { createDb } = await import('../core/db.js');
  const { prepareDatabase } = await import('../core/prepare.js');
  const pglite = await PGlite.create();
  // Test files run in parallel, each picking a random port: on a clash (EADDRINUSE), pick another.
  let port;
  let server;
  for (let attempt = 0; ; attempt++) {
    port = attempt === 0 ? nextPort++ : 15_400 + Math.floor(Math.random() * 20_000);
    server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 16 });
    try {
      await server.start();
      break;
    } catch (err) {
      if (err?.code !== 'EADDRINUSE' || attempt >= 10) throw err;
    }
  }
  wholeSequences(server.queryQueue);
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
export async function startApp({ fetch: outbound, now, onHeader, trustedProxies, renderer, environment } = {}) {
  const { createApp } = await import('../app.js');
  const { db, close: closeDb } = await startDb();
  const app = createApp({ db, fetch: outbound, now, ...(onHeader ? { onHeader } : {}), ...(trustedProxies !== undefined ? { trustedProxies } : {}), ...(renderer ? { renderer } : {}), ...(environment ? { environment } : {}) });
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
      del: (p, h, b) => request('DELETE', p, b, h),
    };
  }

  return {
    app,
    db,
    base,
    client,
    async close() {
      await new Promise((res) => server.close(res));
      await app.locals.cardRenderer?.close?.();
      await closeDb();
    },
  };
}
