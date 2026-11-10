import express from 'express';
import { backupStatus } from '../core/backup.js';
import { BACKUP_KEEP_MONTHLY, BACKUP_KEEP_NIGHTLY } from '../retention/policy.js';
import { ENVIRONMENT } from '../core/environment.js';
import { config } from '../core/config.js';
import { createErrorHandler } from '../core/errors.js';
import { securityHeaders } from '../core/headers.js';
import { APP_VERSION } from '../core/version.js';

/**
 * The worker's only HTTP surface: /api/health, for the deploy and the container healthcheck (LAN only, never in the
 * tunnel). It also says how backups stand: when the last good one finished, its size, whether the newest attempt
 * failed. A failing backup does not make the worker unhealthy (the deploy must not roll back over it); the admin
 * page shows why it failed.
 */
export function createWorkerApp({ loop, db, backupDir = config.backupDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.get('/api/health', async (req, res) => {
    const h = loop.health();
    let database = 'ok';
    let backup = null;
    try {
      await db.ping();
      const s = await backupStatus(db);
      backup = {
        configured: Boolean(backupDir),
        lastSuccessAt: s.lastSuccessAt,
        lastSuccessBytes: s.lastSuccessBytes,
        lastFailureAt: s.lastFailureAt,
        failing: s.failing,
        running: s.running,
        // 0.5.0: dumps hold only Everstats' own data: the newest N nightly ones plus the first of each month are kept.
        // 0.10.2: dev keeps the last 3 and no monthly copies (core/environment.js).
        keepNightly: BACKUP_KEEP_NIGHTLY,
        monthly: BACKUP_KEEP_MONTHLY,
      };
    } catch {
      database = 'unreachable';
    }
    const ok = h.healthy && database === 'ok';
    res.set('Cache-Control', 'no-store');
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      service: 'worker',
      environment: ENVIRONMENT.id,
      version: APP_VERSION,
      database,
      loop: { state: h.state, ticks: h.ticks, lastTickAt: h.lastTickAt, jobs: h.jobs.length, problem: h.problem },
      backup,
    });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(createErrorHandler('worker'));
  return app;
}
