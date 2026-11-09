import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { createAccountRouter, THEMES } from './account/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { getSetting } from './admin/settings.js';
import { createAuthRouter, createCallbackRouter } from './auth/routes.js';
import { loadSession } from './auth/sessions.js';
import { config } from './core/config.js';
import { createErrorHandler, HttpError, route } from './core/errors.js';
import { securityHeaders } from './core/headers.js';
import { createNetworkResolver } from './core/network.js';
import { createLimits, limitBy } from './core/rateLimit.js';
import { requireSameOrigin } from './core/sameOrigin.js';
import { APP_VERSION } from './core/version.js';
import { parseSlug } from './stats/slug.js';

/**
 * The web app (API + built client), without listening. index.js starts it; tests build it with their own database,
 * limits and fetch.
 *
 * @param {object} opts
 * @param {ReturnType<import('./core/db.js').createDb>} opts.db
 * @param {() => number} [opts.now] the clock the rate limits run on
 * @param {typeof fetch} [opts.fetch] outbound HTTP (OAuth token + identity calls, key tests); tests pass a fake
 * @param {string} [opts.trustedProxies] see core/network.js
 * @param {Function} [opts.onHeader] told where each CF-Connecting-IP arrived from
 */
export function createApp({ db, now = Date.now, fetch = globalThis.fetch, trustedProxies, onHeader } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: config.secureCookies }));
  app.use(express.json({ limit: '50kb' }));

  const limits = createLimits({ now });
  const networkOf = createNetworkResolver({ trustedProxies, onHeader });
  app.locals.limits = limits;

  // The deploy probes this (and checks the version against CHANGELOG.json), as do the container healthcheck and
  // anyone curious. Status, version and whether the database answers: nothing else, the app is public.
  app.get('/api/health', route(async (req, res) => {
    let database = 'ok';
    try {
      await db.ping();
    } catch {
      database = 'unreachable';
    }
    res.set('Cache-Control', 'no-store');
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', service: 'web', version: APP_VERSION, database });
  }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireSameOrigin(config.publicOrigin));
  app.use(loadSession(db));

  // The theme, applied before first paint by a blocking <script> in index.html. Logged-out visitors (and a half
  // signed-in 2FA session) ALWAYS get Forever; the account's choice is stored on the account, never in the browser.
  app.get('/api/theme-boot.js', route(async (req, res) => {
    let theme = 'forever';
    if (req.session?.stage === 'full') {
      const row = await db.one('SELECT theme FROM accounts WHERE id = $1', [req.session.accountId]);
      if (THEMES.includes(row?.theme)) theme = row.theme;
    }
    res.type('application/javascript').send(`document.documentElement.setAttribute('data-theme','${theme}');\n`);
  }));

  // What Everstats covers right now. Every page's empty state reads this, so "not built yet", "no coverage" and
  // "Unranked" come from one place. null means unknown / not measured, never zero.
  app.get('/api/coverage', route(async (req, res) => {
    res.json({
      region: config.region,
      lookups: 'not_built',
      rulesets: null,
      trackedCharacters: null,
      minPopulation: await getSetting(db, 'grading.minPopulation'),
    });
  }));

  // Character lookup. Not built: answers honestly, and is already rate-limited the way the real lookup will be (a
  // search refreshes the character from Blizzard).
  app.get('/api/characters/:slug', limitBy(limits.lookups, networkOf), route(async (req, res) => {
    const parsed = parseSlug(req.params.slug);
    if (!parsed) throw new HttpError(400, 'That isn’t a character name and surname.', 'invalid');
    res.json({ slug: parsed.slug, status: 'not_built' });
  }));

  app.use('/api/auth', createAuthRouter({ db, limits, networkOf, fetch }));
  app.use('/api/admin', createAdminRouter({ db, limits, networkOf, fetch }));
  app.use('/api', createAccountRouter({ db, limits, networkOf }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // OAuth callbacks: /auth/battlenet/callback and /auth/discord/callback (registered with both providers).
  app.use('/auth', createCallbackRouter({ db, fetch }));

  // Serve the built client (production / Docker). In dev, Vite serves it instead.
  if (existsSync(config.clientDist)) {
    app.use('/assets', express.static(join(config.clientDist, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
    app.use(express.static(config.clientDist, { index: false }));
    app.get('/{*splat}', (req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }

  app.use(createErrorHandler('web'));
  return app;
}

/** Deletes expired sessions, flows and admin sessions/invites (CLAUDE.md names this as a deletion exception). */
export async function sweepExpired(db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  await db.query('DELETE FROM auth_flows WHERE expires_at <= now()');
  await db.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
  await db.query("DELETE FROM admin_invites WHERE expires_at <= now() - interval '1 day'");
}
