import express from 'express';
import { requireAccount } from '../auth/sessions.js';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { guildRole } from '../guilds/manage.js';
import { parseGuildSlug } from '../stats/slug.js';
import { FAMILIES } from './catalog.js';
import { evaluationInputs, guildFacts } from './rules.js';
import {
  guildDefinitionById, guildHolderCounts, guildInlineBadges, isUnlisted, loadGuildDefinitions, logGuildBadgeEvent, progressOf,
  publicGuildBadge, setGuildDisplay,
} from './store.js';
import { manageBadgesView, notYetReason } from './view.js';

/**
 * Guild badges (0.7.1).
 *   GET  /api/guild-badges                        every listed guild badge, by family, with holder counts
 *   GET  /api/guild-badges/:id                    a badge's detail page: levels ladder, holders, the viewer's guild
 *   GET  /api/guild-badges/marks/:guildId.png     a partner guild's emblem (the admin's re-encoded upload)
 *   GET  /api/guilds/:slug/badges/manage          Manage guild → Badges (Guild Master and officers only)
 *   PUT  /api/guilds/:slug/badges/manage          { order, shown, pinned }: display only, never an award
 *   GET  /api/guilds/:slug/badges/toasts          unlocks and losses since this GM/officer last looked
 *   POST /api/guilds/:slug/badges/toasts/ack
 */
const TOP_SHOWN = 10;
const viewerOf = (req) => (req.session?.stage === 'full' ? req.session.accountId : null);
const idOf = (raw) => {
  const id = String(raw ?? '');
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(id)) throw new HttpError(404, 'No such guild badge.', 'no_badge');
  return id;
};
async function guildOf(db, raw) {
  const slug = parseGuildSlug(raw);
  if (!slug) throw new HttpError(404, 'Not found');
  const g = await db.one('SELECT id, slug, name, ruleset_id, first_seen_at, profile_fetched_at, totals_built_at FROM guilds WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1', [slug]);
  if (!g) throw new HttpError(404, 'Everstats doesn’t know this guild yet.', 'no_guild');
  return g;
}

/** The guild a signed-in viewer belongs to (their tracked characters' guild with the most tracked members), or null. */
async function viewerGuild(db, accountId) {
  if (!accountId) return null;
  return db.one(
    `SELECT g.id, g.slug, g.name, g.ruleset_id, g.first_seen_at, g.profile_fetched_at, g.totals_built_at
       FROM characters c JOIN guilds g ON g.id = c.guild_id
      WHERE c.owner_account_id = $1 AND NOT c.hidden AND c.profile_state = 'ok' AND c.stats_fetched_at IS NOT NULL AND c.missing_since IS NULL
      GROUP BY g.id ORDER BY count(*) DESC, g.id LIMIT 1`,
    [accountId],
  );
}

export function createGuildBadgeRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);

  r.get('/guild-badges', route(async (req, res) => {
    const inp = await evaluationInputs(db);
    const counts = await guildHolderCounts(db);
    const defs = inp.defs.filter((d) => !isUnlisted(d, inp.ctx));
    res.json({
      families: FAMILIES.map((f) => ({
        ...f,
        badges: defs.filter((d) => d.family === f.id).map((d) => ({ ...publicGuildBadge(d, { level: d.levelled ? 5 : null }), heldBy: counts.total.get(d.id) ?? 0 })),
      })),
    });
  }));

  r.get('/guild-badges/marks/:file', route(async (req, res) => {
    const m = /^(\d{1,20})\.png$/.exec(String(req.params.file));
    const row = m ? await db.one('SELECT mark FROM guild_partner_marks WHERE guild_id = $1 AND mark IS NOT NULL', [m[1]]) : null;
    if (!row) throw new HttpError(404, 'No emblem.', 'no_mark');
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': 'inline; filename="emblem.png"',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(row.mark);
  }));

  r.get('/guild-badges/:id', route(async (req, res) => {
    const def = await guildDefinitionById(db, idOf(req.params.id));
    const inp = await evaluationInputs(db);
    if (!def || isUnlisted(def, inp.ctx)) throw new HttpError(404, 'No such guild badge.', 'no_badge');
    const counts = await guildHolderCounts(db);
    const viewer = viewerOf(req);
    const mine = await viewerGuild(db, viewer);
    let yours = null;
    if (mine) {
      const award = await db.one('SELECT state, level, first_at, level_at, held_since, lost_at FROM guild_badge_awards WHERE guild_id = $1 AND badge_id = $2', [mine.id, def.id]);
      const f = await guildFacts(db, mine, inp);
      const value = f.values.get(def.id);
      const level = award?.level ?? 0;
      yours = {
        guild: { slug: mine.slug, name: mine.name },
        state: award?.state ?? null,
        level: def.levelled ? level : null,
        firstAt: award?.first_at ?? null,
        levelAt: award?.level_at ?? null,
        heldSince: award?.held_since ?? null,
        lostAt: award?.lost_at ?? null,
        measured: def.levelled ? value !== null && value !== undefined : null,
        progress: def.levelled && value !== null && value !== undefined ? progressOf(def, level, value) : null,
        value: def.levelled ? value ?? null : null,
        reason: award?.state === 'held' || def.levelled || def.award !== 'automatic' ? null : notYetReason(def, f, inp.ctx),
      };
    }
    // Who holds it: highest level first, then the earliest to reach it. Names come from guilds Everstats still has.
    const top = await db.query(
      `SELECT g.slug, g.name, a.level, a.level_at, a.held_since FROM guild_badge_awards a JOIN guilds g ON g.id = a.guild_id
        WHERE a.badge_id = $1 AND a.state = 'held' ORDER BY a.level DESC NULLS LAST, a.level_at, g.name LIMIT $2`,
      [def.id, TOP_SHOWN],
    );
    const ctx = inp.ctx;
    res.json({
      badge: publicGuildBadge(def, { level: def.levelled ? 5 : null }),
      heldBy: counts.total.get(def.id) ?? 0,
      levels: def.levelled ? def.thresholds.map((t, i) => ({ ...publicGuildBadge(def, { level: i + 1 }), threshold: t, guilds: counts.byLevel.get(`${def.id}:${i + 1}`) ?? 0 })) : null,
      window: def.rule?.type === 'early-guild' && ctx.early.set ? { start: ctx.early.start, end: ctx.early.end, closed: ctx.early.closed }
        : def.rule?.type === 'founding' ? { beta: true, open: ctx.beta.open } : null,
      signedIn: Boolean(viewer),
      yours,
      top: top.map((x) => ({ slug: x.slug, name: x.name, level: x.level, levelAt: x.level_at, heldSince: def.kept_while_held ? x.held_since : null })),
      siblings: inp.defs.filter((d) => d.family === def.family && d.id !== def.id && !isUnlisted(d, ctx)).map((d) => publicGuildBadge(d, { level: d.levelled ? 5 : null })),
    });
  }));

  // ---- The Guild Master's and officers' Badges panel. Display only: nobody can award a badge here.
  r.use('/guilds/:slug/badges', requireAccount);

  const editorOf = async (req) => {
    const g = await guildOf(db, req.params.slug);
    const role = await guildRole(db, g.id, req.session.accountId);
    return { g, role };
  };

  r.get('/guilds/:slug/badges/manage', route(async (req, res) => {
    const { g, role } = await editorOf(req);
    if (!role) return res.json({ role: null });
    res.json({ role, guild: { slug: g.slug, name: g.name }, ...(await manageBadgesView(db, g)) });
  }));

  r.put('/guilds/:slug/badges/manage', writes, route(async (req, res) => {
    const { g, role } = await editorOf(req);
    if (!role) throw new HttpError(403, 'Only this guild’s Guild Master and the officers they add can choose its badges.', 'not_editor');
    await db.tx(async (q) => {
      await setGuildDisplay(q, g.id, req.body);
      await logGuildBadgeEvent(q, { type: 'display', guildId: g.id, actor: 'editor', actorAccountId: req.session.accountId, detail: { role, pinned: req.body?.pinned ?? null, shown: (req.body?.shown ?? []).length } });
    });
    res.json({ role, guild: { slug: g.slug, name: g.name }, ...(await manageBadgesView(db, g)) });
  }));

  r.get('/guilds/:slug/badges/toasts', route(async (req, res) => {
    const { g, role } = await editorOf(req);
    if (!role) return res.json({ toasts: [] });
    const seen = await db.one('SELECT seen_at FROM guild_badge_toast_seen WHERE guild_id = $1 AND account_id = $2', [g.id, req.session.accountId]);
    const events = await db.query(
      `SELECT e.id, e.at, e.type, e.badge_id, e.level, e.detail FROM guild_badge_events e
        WHERE e.guild_id = $1 AND e.notify AND e.type IN ('unlocked', 'level', 'regained', 'granted', 'lost')
          AND e.at > coalesce($2::timestamptz, now() - interval '7 days') ORDER BY e.at LIMIT 50`,
      [g.id, seen?.seen_at ?? null],
    );
    const defs = new Map((await loadGuildDefinitions(db)).map((d) => [d.id, d]));
    const toasts = events.filter((e) => defs.has(e.badge_id)).map((e) => ({
      kind: e.type === 'lost' ? 'lost' : 'unlocked',
      at: e.at,
      badge: publicGuildBadge(defs.get(e.badge_id), { level: e.level }),
    }));
    res.json({ toasts, until: events.at(-1)?.at ?? null });
  }));

  r.post('/guilds/:slug/badges/toasts/ack', writes, route(async (req, res) => {
    const { g, role } = await editorOf(req);
    if (!role) return res.json({ ok: true });
    const until = Date.parse(req.body?.until);
    const at = Number.isFinite(until) ? new Date(Math.min(until, Date.now())) : new Date();
    await db.query(
      `INSERT INTO guild_badge_toast_seen (guild_id, account_id, seen_at) VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, account_id) DO UPDATE SET seen_at = GREATEST(guild_badge_toast_seen.seen_at, EXCLUDED.seen_at)`,
      [g.id, req.session.accountId, at],
    );
    res.json({ ok: true });
  }));

  return r;
}

export { guildInlineBadges };
