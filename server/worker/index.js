// Worker entrypoint: the background crawler. Its own container (everstats-worker) from the same image as the web app,
// sharing the database. It has no public face: its port answers only /api/health, for the deploy and the container
// healthcheck, and is never put in the tunnel.
import { hostname } from 'node:os';
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { prepareDatabase } from '../core/prepare.js';
import { APP_VERSION } from '../core/version.js';
import { requireRootKey } from '../credentials/crypto.js';
import { createWorkerApp } from './app.js';
import { JOBS } from './jobs.js';
import { createLoop } from './loop.js';

requireRootKey('worker');

const db = createDb({ max: 4 });
await prepareDatabase(db, { processName: 'worker' });

// One row per worker in worker_status. Stable across restarts of the same container (its hostname).
const workerId = process.env.WORKER_ID || `worker-${hostname()}`;
const loop = createLoop({ db, jobs: JOBS, workerId, version: APP_VERSION });

await loop.start();
const server = createWorkerApp({ loop, db }).listen(config.workerPort, config.listenHost, () => {
  console.log(`[worker] Everstats worker ${APP_VERSION} (${workerId}) on ${config.listenHost}:${config.workerPort}; ${JOBS.length} job(s) registered`);
});

async function shutdown() {
  await loop.stop();
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
