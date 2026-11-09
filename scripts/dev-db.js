// Local development database: an embedded Postgres (PGlite, WebAssembly) served on 127.0.0.1:5439 over the real
// Postgres protocol, so the web app and the worker connect with the same `pg` code they use in production. Data
// persists in ./data/dev-pglite (git-ignored). Production uses the postgres container instead (docker-compose.yml).
//
//   npm run dev starts it for you. Alone: node scripts/dev-db.js [--memory]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const memory = process.argv.includes('--memory');
const dir = resolve(import.meta.dirname, '..', 'data', 'dev-pglite');
if (!memory) mkdirSync(dir, { recursive: true });

const db = await PGlite.create(memory ? undefined : dir);
const port = Number(process.env.DEV_DB_PORT) || 5439;
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 32 });
await server.start();
console.log(`[dev-db] PGlite (${memory ? 'in memory' : dir}) on postgres://postgres@127.0.0.1:${port}/postgres`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
