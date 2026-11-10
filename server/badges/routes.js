import express from 'express';
import { requireAccount } from '../auth/sessions.js';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { BADGE_ALIASES, FAMILIES, FEATURED_MAX } from './catalog.js';
import {
  LOGO_SIZES, availabilityFor, badgeContext, clearToasts, definitionById, heldAwards, holderCounts, isHidden, loadDefinitions, pendingToasts, publicBadge,
  rowOrder, setDisplay,
} from './store.js';

/**
 * Badge pages and the player's badge settings (0.7.0).
 *   GET  /api/badges/:id                 the badge detail page (public)
 *   GET  /api/badges/:id/logo/:size.png  a badge's logo (64, 128 or 256 px; the admin's re-encoded upload; mark.png = 256)
 *   GET  /api/account/badges             Settings → Badges: earned, earnable, no longer available
 *   PUT  /api/account/badges             { shown, featured, pinned }
 *   POST /api/account/badges/seen        { ids } clears "new" (the popover or the detail page was opened)
 *   GET  /api/account/badges/toasts      earned / granted / removed toasts waiting for this account
 *   POST /api/account/badges/toasts/ack  { ids }
 */
const HOLDERS_SHOWN = 60;
const viewerOf = (req) => (req.session?.stage === 'full' ? req.session.accountId : null);
const idOf = (raw) => {
  const id = String(raw ?? '');
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(id)) throw new HttpError(404, 'No such badge.', 'no_badge');
  return id;
};

export function createBadgeRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);

  r.get('/badges/:id', route(async (req, res) => {
    const asked = idOf(req.params.id);
    const def = await definitionById(db, BADGE_ALIASES[asked] ?? asked);
    const ctx = await badgeContext(db);
    if (!def || isHidden(def, ctx)) throw new HttpError(404, 'No such badge.', 'no_badge');
    const viewer = viewerOf(req);
    const counts = await holderCounts(db);
    const defs = (await loadDefinitions(db)).filter((d) => !isHidden(d, ctx));
    const mine = viewer ? new Map((await heldAwards(db, viewer)).map((a) => [a.id, a])) : new Map();
    const account = viewer ? await db.one('SELECT id, created_at FROM accounts WHERE id = $1', [viewer]) : null;
    const stateOf = (d) => {
      if (mine.has(d.id)) return { state: 'earned' };
      const a = availabilityFor(d, ctx, account);
      return { state: a.status === 'unavailable' ? 'unavailable' : a.status === 'ineligible' ? 'ineligible' : 'locked', note: a.note };
    };
    const held = mine.get(def.id);
    let character = null;
    if (held?.character_id) {
      const c = await db.one("SELECT name, surname, slug FROM characters WHERE id = $1 AND profile_state <> 'purged'", [held.character_id]);
      if (c?.name) character = { name: c.name, surname: c.surname, slug: c.slug };
    }
    // Who has it: automatic badges list players who chose to show it publicly (with a username). Granted badges show
    // only the count. The count includes everyone, public or not (a number names nobody).
    let holders = null;
    if (def.award === 'automatic') {
      const rows = await db.query(
        `SELECT ac.username, a.earned_at FROM badge_awards a JOIN accounts ac ON ac.id = a.account_id
          WHERE a.badge_id = $1 AND a.state = 'held' AND a.shown AND ac.username_claimed AND NOT everstats_banned(ac.id) ORDER BY a.earned_at, ac.username LIMIT $2`,
        [def.id, HOLDERS_SHOWN + 1],
      );
      holders = { list: rows.slice(0, HOLDERS_SHOWN).map((x) => ({ username: x.username, earnedAt: x.earned_at })), more: rows.length > HOLDERS_SHOWN };
    }
    res.json({
      badge: publicBadge(def, ctx),
      heldBy: counts.get(def.id) ?? 0,
      signedIn: Boolean(viewer),
      mine: held ? { earnedAt: held.earned_at, source: held.source, shown: held.shown, featured: held.featured, pinned: held.pinned, isNew: !held.seen_at, character } : null,
      status: viewer ? stateOf(def) : null,
      holders,
      siblings: defs.filter((d) => d.family === def.family && d.id !== def.id).map((d) => ({ ...publicBadge(d, ctx), ...(viewer ? stateOf(d) : { state: 'plain' }) })),
    });
  }));

  // 0.10.4: a badge's saved logo, one of our own re-encoded PNGs (never the uploaded file). The address carries ?v=<hash>,
  // so a replaced logo is a new address; a removed one answers 404. mark.png is the 0.7.0 address (the 256 px size).
  const sendLogo = async (req, res, px) => {
    const row = await db.one(`SELECT png_${px} AS png FROM badge_logos WHERE badge_id = $1 AND stage = 'saved'`, [idOf(req.params.id)]);
    if (!row) throw new HttpError(404, 'No logo.', 'no_logo');
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `inline; filename="logo-${px}.png"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(row.png);
  };
  r.get('/badges/:id/logo/:size.png', route(async (req, res) => {
    const px = Number(req.params.size);
    if (!LOGO_SIZES.includes(px)) throw new HttpError(404, 'No logo.', 'no_logo');
    await sendLogo(req, res, px);
  }));
  r.get('/badges/:id/mark.png', route((req, res) => sendLogo(req, res, 256)));

  r.use('/account/badges', requireAccount);

  r.get('/account/badges', route(async (req, res) => res.json(await settingsView(db, req.session.accountId))));

  r.put('/account/badges', writes, route(async (req, res) => {
    await db.tx((q) => setDisplay(q, req.session.accountId, req.body));
    res.json(await settingsView(db, req.session.accountId));
  }));

  r.post('/account/badges/seen', writes, route(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string').slice(0, 100) : [];
    if (ids.length) await db.query("UPDATE badge_awards SET seen_at = now() WHERE account_id = $1 AND badge_id = ANY($2::text[]) AND seen_at IS NULL AND state = 'held'", [req.session.accountId, ids]);
    res.json({ ok: true });
  }));

  r.get('/account/badges/toasts', route(async (req, res) => res.json({ toasts: await pendingToasts(db, req.session.accountId) })));

  r.post('/account/badges/toasts/ack', writes, route(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string').slice(0, 100) : [];
    if (ids.length) await clearToasts(db, req.session.accountId, ids);
    res.json({ ok: true });
  }));

  return r;
}

/** Settings → Badges for one account. */
export async function settingsView(db, accountId) {
  const ctx = await badgeContext(db);
  const account = await db.one('SELECT id, created_at, username, username_claimed FROM accounts WHERE id = $1', [accountId]);
  const defs = (await loadDefinitions(db)).filter((d) => !isHidden(d, ctx));
  const held = (await heldAwards(db, accountId)).filter((d) => !isHidden(d, ctx));
  const heldIds = new Set(held.map((h) => h.id));
  const counts = await holderCounts(db);
  const chars = held.filter((h) => h.character_id).map((h) => h.character_id);
  const names = chars.length
    ? new Map((await db.query("SELECT id, name, surname, slug FROM characters WHERE id = ANY($1::bigint[]) AND profile_state <> 'purged' AND name IS NOT NULL", [chars])).map((c) => [Number(c.id), c]))
    : new Map();
  const earned = held.sort(rowOrder).map((h) => {
    const c = h.character_id ? names.get(Number(h.character_id)) : null;
    return {
      ...publicBadge(h, ctx), heldBy: counts.get(h.id) ?? 0, earnedAt: h.earned_at, source: h.source, isNew: !h.seen_at,
      shown: h.shown, featured: h.featured, position: h.position, pinned: h.pinned,
      character: c ? { name: c.name, surname: c.surname, slug: c.slug } : null,
    };
  });
  const earnable = [];
  const unavailable = [];
  const ineligible = [];
  for (const d of defs) {
    if (heldIds.has(d.id)) continue;
    const a = availabilityFor(d, ctx, account);
    const view = { ...publicBadge(d, ctx), heldBy: counts.get(d.id) ?? 0, note: a.note };
    if (a.status === 'earnable') earnable.push(view);
    else if (a.status === 'unavailable') unavailable.push(view);
    else if (a.status === 'ineligible') ineligible.push(view);
  }
  return {
    max: FEATURED_MAX,
    username: account.username_claimed ? account.username : null,
    families: FAMILIES,
    earned,
    earnable,
    unavailable,
    // 0.7.1: badges this account was never eligible for while they can still be earned (Beta Tester for an account
    // made before the beta opened). Not "no longer available": that is only for after a window closes.
    ineligible,
  };
}
