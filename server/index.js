// Web app entrypoint: REST API, OAuth callbacks and the built React client.
import { existsSync } from 'node:fs';
import { createApp, sweepExpired } from './app.js';
import { config } from './core/config.js';
import { createDb } from './core/db.js';
import { describeTrust, logHeaderSources } from './core/network.js';
import { prepareDatabase } from './core/prepare.js';
import { APP_VERSION } from './core/version.js';
import { requireRootKey } from './credentials/crypto.js';

requireRootKey('web');

if (!existsSync(config.clientDist)) {
  console.warn(`[web] No built client at ${config.clientDist}: run \`npm run build\` (or use Vite in dev).`);
}

const db = createDb();
await prepareDatabase(db, { processName: 'web' });

const app = createApp({ db, onHeader: logHeaderSources() });
const httpServer = app.listen(config.port, config.listenHost, () => {
  console.log(`[web] Everstats ${APP_VERSION} listening on ${config.listenHost}:${config.port} for ${config.publicOrigin}`);
  console.log(`[web] Rate limits per network: ${describeTrust()}`);
});

const sweep = () => sweepExpired(db).catch((err) => console.error(`[web] sweeping expired sessions failed: ${err.code ?? err.name}`));
sweep();
const sweeper = setInterval(sweep, 60 * 60 * 1000);
sweeper.unref();

function shutdown() {
  clearInterval(sweeper);
  httpServer.close(() => {
    db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
