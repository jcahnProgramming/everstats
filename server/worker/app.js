import express from 'express';
import { createErrorHandler } from '../core/errors.js';
import { securityHeaders } from '../core/headers.js';
import { APP_VERSION } from '../core/version.js';

/** The worker's only HTTP surface: /api/health, for the deploy and the container healthcheck. */
export function createWorkerApp({ loop, db }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.get('/api/health', async (req, res) => {
    const h = loop.health();
    let database = 'ok';
    try {
      await db.ping();
    } catch {
      database = 'unreachable';
    }
    const ok = h.healthy && database === 'ok';
    res.set('Cache-Control', 'no-store');
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      service: 'worker',
      version: APP_VERSION,
      database,
      loop: { state: h.state, ticks: h.ticks, lastTickAt: h.lastTickAt, jobs: h.jobs.length, problem: h.problem },
    });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(createErrorHandler('worker'));
  return app;
}
