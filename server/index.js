// Web app entrypoint: REST API, OAuth callbacks and the built React client.
import { existsSync } from 'node:fs';
import { createApp, sweepExpired } from './app.js';
import { config } from './core/config.js';
import { createDb } from './core/db.js';
import { describeTrust, trustedProxyCheck } from './core/network.js';
import { prepareDatabase } from './core/prepare.js';
import { APP_VERSION } from './core/version.js';
import { requireRootKey } from './credentials/crypto.js';

requireRootKey('web');

if (!existsSync(config.clientDist)) {
  console.warn(`[web] No built client at ${config.clientDist}: run \`npm run build\` (or use Vite in dev).`);
}

const db = createDb();
await prepareDatabase(db, { processName: 'web' });

const app = createApp({ db });
const httpServer = app.listen(config.port, config.listenHost, () => {
  console.log(`[web] Everstats ${APP_VERSION} listening on ${config.listenHost}:${config.port} for ${config.publicOrigin}`);
  console.log(`[web] Rate limits per network: ${describeTrust()}`);
  const trust = trustedProxyCheck();
  if (trust.state === 'outside') {
    console.warn(`[web] WARNING: TRUSTED_PROXIES is set, but none of it is inside this container's network (${trust.networks.join(', ') || 'none found'}). CF-Connecting-IP will be ignored and every tunnel visitor shares one rate-limit bucket. Set it to the network's gateway (docker-compose.yml, EVERSTATS_SUBNET_PREFIX).`);
  }
});

const sweep = () => sweepExpired(db).catch((err) => console.error(`[web] sweeping expired sessions failed: ${err.code ?? err.name}`));
sweep();
const sweeper = setInterval(sweep, 60 * 60 * 1000);
// Blizzard's 30-day rule: the web app sweeps too (hourly), so a stopped worker doesn't stop it. Only one process
// sweeps at a time (an advisory lock); backups are pruned by the worker, which holds the folder.
const retain = () => import('./retention/sweep.js').then(({ runRetentionSweep }) => runRetentionSweep(db, { processName: 'web' }))
  .catch((err) => console.error(`[retention] sweep failed: ${err.code ?? err.name}`));
setTimeout(retain, 5 * 60 * 1000).unref();
const retainer = setInterval(retain, 60 * 60 * 1000);
retainer.unref();
sweeper.unref();

function shutdown() {
  clearInterval(sweeper);
  // 0.8.0: the share-card renderer's Chromium goes with the process.
  app.locals.cardRenderer?.close?.();
  httpServer.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
