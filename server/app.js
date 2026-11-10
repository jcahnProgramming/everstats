import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { createAccountRouter, THEMES } from './account/routes.js';
import { createAdminRouter } from './admin/routes.js';
import { createAuthRouter, createCallbackRouter } from './auth/routes.js';
import { loadSession } from './auth/sessions.js';
import { config } from './core/config.js';
import { createErrorHandler, route } from './core/errors.js';
import { securityHeaders } from './core/headers.js';
import { createNetworkResolver, logHeaderSources, trustedProxyCheck, trustedProxyEntries } from './core/network.js';
import { createLimits, limitBy } from './core/rateLimit.js';
import { requireSameOrigin } from './core/sameOrigin.js';
import { APP_VERSION } from './core/version.js';
import { ENVIRONMENT } from './core/environment.js';
import { createPublicRouter } from './characters/routes.js';
import { createGuildRouter } from './guilds/routes.js';
import { createGuildFetchRouter } from './guilds/fetchRoutes.js';
import { createTierRouter } from './tiers/routes.js';
import { createBadgeRouter } from './badges/routes.js';
import { createGuildManageRouter } from './guilds/manage.js';
import { createGuildBadgeRouter } from './guildBadges/routes.js';
import { createFeedbackRouter } from './feedback/routes.js';
import { createModerationPlayerRouter } from './moderation/player.js';
import { createCardApiRouter, createCardImageRouter } from './cards/routes.js';
import { createCardRenderer } from './cards/render.js';
import { spaWithPreviews } from './cards/meta.js';
import { versionApi, versionImages, versionPageGate } from './core/versionRoutes.js';
import { versionSwitchMiddleware } from './core/versionSwitch.js';
import { createCollectionsRouter } from './collections/routes.js';
import { createFollowRouter } from './guilds/follow.js';
import { getSetting } from './admin/settings.js';
import { createDevTesterEndpoint, DEV_TESTER_PATH } from './devgate/endpoint.js';
import { createDevGate } from './devgate/gate.js';
import { createMaintenanceRouter } from './release/maintenance.js';

/**
 * The web app (API + built client), without listening. index.js starts it; tests build it with their own database,
 * limits and fetch.
 *
 * @param {object} opts
 * @param {ReturnType<import('./core/db.js').createDb>} opts.db
 * @param {() => number} [opts.now] the clock the rate limits run on
 * @param {typeof fetch} [opts.fetch] outbound HTTP (OAuth token + identity calls, key tests); tests pass a fake
 * @param {string} [opts.trustedProxies] see core/network.js
 * @param {Function} [opts.onHeader] told where each CF-Connecting-IP arrived from (default: log each new source once
 *   and keep the list for the admin page, core/network.js)
 * @param {object} [opts.renderer] the share-card renderer (cards/render.js); tests pass a fake
 */
export function createApp({ db, now = Date.now, fetch = globalThis.fetch, trustedProxies = process.env.TRUSTED_PROXIES, onHeader = logHeaderSources(), renderer = null, environment = ENVIRONMENT } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: config.secureCookies }));
  // 0.10.2: the private test site is never indexed: every answer says so, robots.txt disallows everything and there is
  // no sitemap. Production is unchanged.
  if (environment.noindex) {
    app.use((req, res, next) => {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      next();
    });
    app.get('/robots.txt', (req, res) => res.set('Cache-Control', 'no-cache').type('text/plain').send(['User-agent: *', 'Disallow: /', ''].join('\n')));
    app.get('/sitemap.xml', (req, res) => res.status(404).type('text/plain').send('Not found'));
  }

  const limits = createLimits({ now });
  const networkOf = createNetworkResolver({ trustedProxies, onHeader });
  app.locals.limits = limits;
  // 0.8.0: share cards. One headless Chromium for the whole web process, launched on the first render.
  const cards = renderer ?? createCardRenderer({ maxConcurrent: () => getSetting(db, 'cards.maxConcurrent') });
  app.locals.cardRenderer = cards;

  // Every request, pages and files included, goes past the resolver once, so the first page load through the tunnel
  // logs where CF-Connecting-IP arrives from (TRUSTED_PROXIES discovery). Rate limits still run their own lookup.
  app.use((req, res, next) => {
    networkOf(req);
    next();
  });
  app.use(express.json({ limit: '50kb' }));

  // The deploy probes this (and checks the version against CHANGELOG.json), as do the container healthcheck and
  // anyone curious. Status, environment (0.10.2: production or dev), version and whether the database answers: nothing
  // else, the app is public.
  app.get('/api/health', route(async (req, res) => {
    let database = 'ok';
    try {
      await db.ping();
    } catch {
      database = 'unreachable';
    }
    res.set('Cache-Control', 'no-store');
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', service: 'web', environment: environment.id, version: APP_VERSION, database });
  }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // 0.10.3: the dev tester question (devgate/endpoint.js), production only, off unless DEV_TESTER_SECRET is set. The ONE
  // path mounted before the CSRF Origin check: it carries no cookies and reads no session; the shared secret is its
  // authentication. Every other /api write still needs Origin (server/test/devgate.test.js checks both).
  app.post(DEV_TESTER_PATH, createDevTesterEndpoint({ db, limits, networkOf, environment }));
  app.use('/api', requireSameOrigin(config.publicOrigin));
  // 0.11.1: which switchable game versions are on (Features), fresh before anything is routed (core/versionSwitch.js).
  app.use(versionSwitchMiddleware(db));
  app.use(loadSession(db));
  // 0.10.3: the dev tester gate (devgate/gate.js): on the dev site with its Features switch on, every page and API but
  // sign-in, static files and /api/health needs a signed-in tester (production says who) or dev's admin. Off: nothing.
  const devGate = createDevGate({ db, environment, fetch, now });
  app.use(devGate.middleware);
  app.get('/api/dev-gate', devGate.route);

  // The theme, applied before first paint by a blocking <script> in index.html. Logged-out visitors (and a half
  // signed-in 2FA session) ALWAYS get Forever; the account's choice is stored on the account, never in the browser.
  app.get('/api/theme-boot.js', route(async (req, res) => {
    let theme = 'forever';
    if (req.session?.stage === 'full') {
      const row = await db.one('SELECT theme FROM accounts WHERE id = $1', [req.session.accountId]);
      if (THEMES.includes(row?.theme)) theme = row.theme;
    }
    // 0.10.2: the environment marker (DEV) is set here too, before first paint, so it never flashes in late. The id comes
    // from the registry (core/environment.js), never from a request.
    const env = environment.marker ? `document.documentElement.setAttribute('data-es-env','${environment.id}');\n` : '';
    res.type('application/javascript').send(`document.documentElement.setAttribute('data-theme','${theme}');\n${env}`);
  }));

  // 0.10.3: the maintenance banner players see (release/maintenance.js; set from Admin → Release tools). Public.
  app.use('/api', createMaintenanceRouter({ db }));
  // The routers that are about ONE game version and region. 0.11.1: each is mounted twice, at /api (the primary scope:
  // WoW Forever, as always) and at /api/v/{version}/{region} for every other version that is switched on, where the
  // same handlers run inside that scope (core/scope.js, core/versionRoutes.js).
  const versioned = express.Router();
  // Character lookups, leaderboards, the statistics catalog, coverage and the beta (characters/routes.js).
  versioned.use(createPublicRouter({ db, limits, networkOf }));
  // Guild pages, guild boards, the guild index and search (guilds/routes.js, 0.5.0).
  versioned.use(createGuildRouter({ db, limits, networkOf }));
  // 0.9.0: "Fetch all members" on guild pages (guilds/fetchRoutes.js).
  versioned.use(createGuildFetchRouter({ db, limits, networkOf }));
  versioned.use(createTierRouter({ db }));
  // Guild page management (0.7.0): the Guild Master's and officers' panel, "Report this link", "Your guilds".
  versioned.use(createGuildManageRouter({ db, limits, networkOf }));
  // 0.7.1: guild badges (detail pages, emblems, Manage → Badges, GM/officer toasts).
  versioned.use(createGuildBadgeRouter({ db, limits, networkOf }));
  // 0.8.2: the ban notice and appeal, moderation notices (warnings), and "Report" on profiles and guild descriptions.
  versioned.use(createModerationPlayerRouter({ db, limits, networkOf }));
  // 0.8.0: share cards (the maker's state, "Save as my default").
  versioned.use(createCardApiRouter({ db, limits, networkOf }));
  // 0.9.0: collections, the transmog tracker, Legacy Points and opt-in gold (collections/routes.js).
  versioned.use(createCollectionsRouter({ db, limits, networkOf }));
  app.use('/api/v', versionApi(versioned));
  app.use('/api', versioned);
  // Badges (0.7.0): badge pages, partner marks, and the player's badge settings and toasts.
  app.use('/api', createBadgeRouter({ db, limits, networkOf }));
  app.use('/api', createFeedbackRouter({ db, limits, networkOf }));
  // 0.9.1: "Your guilds" on the home page, and "Pin to dashboard" on guild pages (guilds/follow.js).
  app.use('/api', createFollowRouter({ db, limits, networkOf }));

  app.use('/api/auth', createAuthRouter({ db, limits, networkOf, fetch }));
  app.use('/api/admin', createAdminRouter({
    db, limits, networkOf, fetch,
    proxies: () => ({ trustedProxies: trustedProxyEntries(trustedProxies), sources: onHeader?.sources?.() ?? [], check: trustedProxyCheck(trustedProxies) }),
    cardStats: () => cards.stats(),
  }));
  app.use('/api', createAccountRouter({ db, limits, networkOf }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // /{version}/{region}/… pages (core/versionRoutes.js): the primary scope redirects to the unprefixed URL; a version
  // that isn't switched on answers 404; one that is gets the same client and its own link previews (0.11.1).
  app.use(versionPageGate());

  // OAuth callbacks: /auth/battlenet/callback and /auth/discord/callback (registered with both providers).
  app.use('/auth', createCallbackRouter({ db, fetch }));

  // 0.8.0: share-card images (/card.png for the maker, /og/… for link previews).
  const cardImages = createCardImageRouter({ db, limits, networkOf, fetch, renderer: cards });
  // 0.11.1: /{version}/{region}/card.png and /{version}/{region}/og/… are the same images, in that version's scope.
  app.use(versionImages(cardImages));
  app.use(cardImages);

  // Serve the built client (production / Docker). In dev, Vite serves it instead.
  if (existsSync(config.clientDist)) {
    app.use('/assets', express.static(join(config.clientDist, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
    // 0.8.2: files outside /assets have no content hash in their name (licence texts, index.html if asked for by name),
    // so they are revalidated on every use: no-cache (an ETag answer is cheap). Hashed /assets stay immutable for a year.
    app.use(express.static(config.clientDist, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
    // 0.8.0: every page gets its link-preview tags (cards/meta.js); pages with a card get its image.
    app.get('/{*splat}', spaWithPreviews(db));
  }

  app.use(createErrorHandler('web'));
  return app;
}

/**
 * Deletes expired sessions, flows, admin sessions/invites and discovery Battle.net tokens (CLAUDE.md names this as a
 * deletion exception).
 */
export async function sweepExpired(db) {
  await db.query('DELETE FROM discovery_grants WHERE expires_at <= now()');
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  await db.query('DELETE FROM auth_flows WHERE expires_at <= now()');
  await db.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
  await db.query("DELETE FROM admin_invites WHERE expires_at <= now() - interval '1 day'");
}
