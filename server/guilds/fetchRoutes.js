import { scopeSql } from '../core/config.js';
import express from 'express';
import { getSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { waitFor } from '../crawler/queue.js';
import { getSource } from '../sources/registry.js';
import { parseGuildSlug } from '../stats/slug.js';
import { countActivity } from '../activity/count.js';
import { FetchAllError, fetchStatus, readRoster, rosterFailed, startFetch } from './fetchAll.js';

/**
 * "Fetch all members" on guild pages (0.9.0, guilds/fetchAll.js). Anyone may use it, signed in or not.
 *
 *   GET  /api/guilds/:slug/fetch-all          where it stands (polled by the page while something is happening)
 *   POST /api/guilds/:slug/fetch-all/roster   step 1: read Blizzard's roster (2 requests, a look-up: the per-network
 *                                             look-up limit), then the counts and the cost
 *   POST /api/guilds/:slug/fetch-all/start    step 2: queue the members (guildFetchesByNetwork AND, signed in,
 *                                             guildFetchesByAccount)
 * POSTs pass the site's Origin check like every other write (core/sameOrigin.js).
 */
export const ROSTER_WAIT_MS = 20_000;

function tooMany(res, limiter, key, message) {
  const { retryAfterMs } = limiter.check(key);
  res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  return res.status(429).json({ error: message, code: 'rate_limited', retryAfterMs });
}

export function createGuildFetchRouter({ db, limits, networkOf }) {
  const r = express.Router();

  async function guildOf(raw) {
    const slug = parseGuildSlug(raw);
    if (!slug) throw new HttpError(400, 'That isn’t a guild address.', 'invalid');
    const g = await db.one(`SELECT id, slug FROM guilds WHERE slug = $1 AND ${scopeSql()} ORDER BY updated_at DESC LIMIT 1`, [slug]);
    if (!g) throw new HttpError(404, 'Everstats doesn’t know this guild yet. Open its page first.', 'no_guild');
    return g;
  }

  const view = async (g) => ({
    ...(await fetchStatus(db, { slug: g.slug, guildId: g.id })),
    configured: await isConfigured(db, getSource('blizzard').credential),
    concurrent: await getSetting(db, 'guilds.fetchConcurrent'),
    cooldownHours: await getSetting(db, 'guilds.fetchCooldownHours'),
  });

  const fail = (err) => {
    if (err instanceof FetchAllError) throw new HttpError(409, err.message, err.code);
    throw err;
  };

  r.get('/guilds/:slug/fetch-all', route(async (req, res) => {
    res.json(await view(await guildOf(req.params.slug)));
  }));

  r.post('/guilds/:slug/fetch-all/roster', route(async (req, res) => {
    const g = await guildOf(req.params.slug);
    if (!(await isConfigured(db, getSource('blizzard').credential))) throw new HttpError(503, 'Look-ups aren’t switched on yet.', 'not_configured');
    const before = await fetchStatus(db, { slug: g.slug, guildId: g.id });
    // Already reading, queued or running: show that one, ask Blizzard nothing.
    if (['roster', 'queued', 'running'].includes(before.state)) return res.json(await view(g));
    const net = networkOf(req);
    if (!limits.lookups.take(net)) return tooMany(res, limits.lookups, net, 'Too many look-ups from your network. Wait a little and try again.');
    const { row, itemId } = await readRoster(db, { slug: g.slug, guildId: g.id }).catch(fail);
    if (itemId !== null) {
      countActivity(db, 'guild.lookup');
      const done = await waitFor(db, itemId, { timeoutMs: ROSTER_WAIT_MS });
      // A failed item: Blizzard didn't answer the waiting look-up. Timed out: the page keeps polling.
      if (done?.state === 'failed') await rosterFailed(db, row.id, 'Blizzard didn’t answer just now. Try again in a minute.');
    }
    res.json(await view(g));
  }));

  r.post('/guilds/:slug/fetch-all/start', route(async (req, res) => {
    const g = await guildOf(req.params.slug);
    const before = await fetchStatus(db, { slug: g.slug, guildId: g.id });
    if (before.state === 'queued' || before.state === 'running') return res.json(await view(g)); // pressing again shows it
    const net = networkOf(req);
    const account = req.session?.stage === 'full' ? String(req.session.accountId) : null;
    if (!limits.guildFetchesByNetwork.check(net).ok) return tooMany(res, limits.guildFetchesByNetwork, net, 'Too many guild fetches from your network. Wait a little and try again.');
    if (account && !limits.guildFetchesByAccount.check(account).ok) return tooMany(res, limits.guildFetchesByAccount, account, 'You’ve started a lot of guild fetches. Wait a little and try again.');
    const row = await startFetch(db, { slug: g.slug }).catch(fail);
    if (!row) throw new HttpError(409, 'That roster count is out of date. Read it again first.', 'stale');
    limits.guildFetchesByNetwork.take(net);
    if (account) limits.guildFetchesByAccount.take(account);
    countActivity(db, 'guild.fetch');
    countActivity(db, 'guild.fetch.members', row.to_fetch);
    res.json(await view(g));
  }));

  return r;
}
