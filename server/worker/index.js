// Worker entrypoint: the background crawler. Its own container (everstats-worker) from the same image as the web app,
// sharing the database. It has no public face: its port answers only /api/health, for the deploy and the container
// healthcheck, and is never put in the tunnel.
import { hostname } from 'node:os';
import { config } from '../core/config.js';
import { createDb } from '../core/db.js';
import { prepareDatabase } from '../core/prepare.js';
import { APP_VERSION } from '../core/version.js';
import { requireRootKey } from '../credentials/crypto.js';
import { assertEnvironment } from '../core/environment.js';
import { BACKUP_HOUR_UTC, run } from '../core/backup.js';
import { createWorkerApp } from './app.js';
import { createCrawler } from '../crawler/service.js';
import { createJobs } from './jobs.js';
import { createLoop } from './loop.js';

// 0.10.2: production or dev, and everything this process was given matches it (core/environment.js), or it stops here.
assertEnvironment('worker');
requireRootKey('worker');

// Backups must exist before real data does (CLAUDE.md): production refuses to start without somewhere to write them.
// docker-compose.yml always sets BACKUP_DIR=/backups in this container and mounts the host folder there.
if (process.env.NODE_ENV === 'production' && !config.backupDir) {
  console.error('[worker] BACKUP_DIR is not set: refusing to start without nightly backups (see docker-compose.yml).');
  process.exit(1);
}

const db = createDb({ max: 4 });
await prepareDatabase(db, { processName: 'worker' });

// One row per worker in worker_status. Stable across restarts of the same container (its hostname).
const workerId = process.env.WORKER_ID || `worker-${hostname()}`;
// The crawler runs continuously beside the job loop; it owns the one Blizzard request budget (crawler/service.js).
const crawler = createCrawler({ db });
const JOBS = createJobs({ crawler });
const loop = createLoop({ db, jobs: JOBS, workerId, version: APP_VERSION });

if (config.backupDir) {
  const version = await run('pg_dump', ['--version']).then((r) => r.stdout.trim(), (err) => `NOT AVAILABLE (${err.message})`);
  console.log(`[worker] Backups: nightly after ${String(BACKUP_HOUR_UTC).padStart(2, '0')}:00 UTC to ${config.backupDir} with ${version}`);
} else {
  console.log('[worker] Backups: off (BACKUP_DIR not set; local dev)');
}

await loop.start();
await crawler.start();
const server = createWorkerApp({ loop, db }).listen(config.workerPort, config.listenHost, () => {
  console.log(`[worker] Everstats worker ${APP_VERSION} (${workerId}) on ${config.listenHost}:${config.workerPort}; ${JOBS.length} job(s) registered`);
});

async function shutdown() {
  await crawler.stop();
  await loop.stop();
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
