import express from 'express';
import { getSetting } from '../admin/settings.js';
import { logAccountEvent } from '../auth/sessions.js';
import { HttpError, route } from '../core/errors.js';
import { parseGuildSlug, parseSlug } from '../stats/slug.js';
import { boardPage } from '../stats/boards.js';
import { loadCatalog } from '../stats/catalog.js';
import { periodsInfo } from '../characters/routes.js';
import { characterView } from '../characters/view.js';
import { guildRole } from '../guilds/manage.js';
import { guildLinksView } from '../guilds/manage.js';
import { guildBadgesView } from '../guildBadges/view.js';
import { guildPeriodStart } from '../stats/guildBoards.js';
import { ACCENTS, BOARD_PERIODS, CARD_TYPES, FORMATS, MAX_STATS, THEMES, THEME_LABELS, cleanOptions, defaultOptions, decodeOptions, optionsKey, statsShown } from './catalog.js';
import { buildCard, characterStatChoices, defaultStatIds, periodLabel } from './data.js';
import { fetchImages, fetchRender } from './images.js';
import { renderSwitch } from '../characters/renders.js';
import { RendererBusy } from './render.js';
import { cacheKey, cachedImage, previewOptions, saveDefault, savedDefault, storeImage } from './store.js';

/**
 * Share-card routes (0.8.0).
 *
 *   GET  /api/cards/maker?type=…&<subject>    the card maker's state: what this subject's card can show, the saved
 *                                              default, whether the viewer may save one
 *   PUT  /api/cards/default                    "Save as my default" (the owner; for guild cards the Guild Master or an
 *                                              officer). Logged on the account (and the guild's log)
 *   GET  /card.png?type=…&<subject>&o=…        a card with explicit options (the maker's preview, Download, Copy)
 *   GET  /og/c/{slug}.png  /og/t/{slug}.png    link-preview images: the saved default (wide) or the README's defaults
 *   GET  /og/g/{slug}.png  /og/b/{ruleset}/{statistic}.png?c=|g=&period=&mode=
 *
 * Subjects: character and tier ?c=slug · guild ?g=slug · board ?ruleset=&statistic=&period=&c=slug (or g=slug&mode=).
 * A hidden character has no card: 404 for its images, "can't be shared" in the maker.
 *
 * Cost: an image is served from the cache when nothing that decides its pixels changed (store.js). Only a render
 * counts against the limits (40 per network, 60 per account per 15 minutes); identical requests in flight share one
 * render; the renderer refuses a full queue (503 + Retry-After). Built card data is memoised for MEMO_MS so a burst of
 * link-preview fetches costs one set of queries.
 */
const MEMO_MS = 60_000;
const memo = new Map();
const inflight = new Map();

const str = (v, max = 200) => (typeof v === 'string' && v.length <= max ? v : null);

/** The subject's parameters from a query string, validated. → { type, params } or throws 404. */
export function subjectFrom(type, q) {
  if (!CARD_TYPES[type]) throw new HttpError(404, 'No such card.', 'no_card');
  if (type === 'character' || type === 'tier' || type === 'collections') {
    const c = parseSlug(str(q.c) ?? '');
    if (!c) throw new HttpError(404, 'No such character.', 'not_found');
    return { type, params: { c: c.slug } };
  }
  if (type === 'guild') {
    const g = parseGuildSlug(str(q.g) ?? '');
    if (!g) throw new HttpError(404, 'No such guild.', 'not_found');
    return { type, params: { g } };
  }
  const rulesetId = Number(q.ruleset);
  const statisticId = Number(q.statistic);
  const period = BOARD_PERIODS.includes(q.period) ? q.period : 'overall';
  if (!Number.isSafeInteger(rulesetId) || !Number.isSafeInteger(statisticId)) throw new HttpError(404, 'No such board.', 'not_found');
  const c = q.c !== undefined ? parseSlug(str(q.c) ?? '') : null;
  const g = q.g !== undefined ? parseGuildSlug(str(q.g) ?? '') : null;
  if (!c && !g) throw new HttpError(404, 'Say whose placement to share.', 'not_found');
  return { type, params: { rulesetId, statisticId, period, c: c?.slug ?? null, g: g ?? null, mode: q.mode === 'average' ? 'average' : 'total' } };
}

/** The query string that addresses a subject (the maker builds image URLs from it). */
export function subjectQuery(type, p) {
  const q = new URLSearchParams({ type });
  if (p.c) q.set('c', p.c);
  if (p.g) q.set('g', p.g);
  if (type === 'board') {
    q.set('ruleset', String(p.rulesetId));
    q.set('statistic', String(p.statisticId));
    q.set('period', p.period);
    if (p.g) q.set('mode', p.mode);
  }
  return q.toString();
}

async function built(db, type, params, options) {
  const key = `${type}|${JSON.stringify(params)}|${optionsKey(options)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  const value = await buildCard(db, type, params, options);
  memo.set(key, { at: Date.now(), value });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return value;
}
export const clearCardMemo = () => memo.clear();

/** Blizzard's images in the data → data: URIs (images.js). A render that can't be fetched → the crest version. */
async function withImages(data, fetch) {
  const urls = [...(data.gear ?? []), ...(data.showcase ?? [])].map((g) => g.icon).filter(Boolean);
  if (!urls.length && !data.render) return data;
  const [got, render] = await Promise.all([fetchImages(urls, { fetch }), data.render ? fetchRender(data.render, { fetch }) : null]);
  return {
    ...data,
    render: data.render ? render ?? null : data.render,
    ...(data.gear ? { gear: data.gear.map((g) => ({ ...g, icon: g.icon ? got.get(g.icon) ?? null : null })) } : {}),
    ...(data.showcase ? { showcase: data.showcase.map((g) => ({ ...g, icon: g.icon ? got.get(g.icon) ?? null : null })) } : {}),
  };
}

const NOT_FOUND = { not_found: 'Everstats doesn’t have that card.', hidden: 'This character is hidden by its owner, so it can’t be shared.' };

/**
 * One card image: from the cache, or rendered (limits, dedupe, busy). → { png, cached, ms } or throws HttpError.
 */
async function cardImage({ db, limits, networkOf, fetch, renderer }, req, type, params, options) {
  const card = await built(db, type, params, options);
  if (card.status === 'not_found' || card.status === 'hidden') throw new HttpError(404, NOT_FOUND[card.status], card.status);
  if (card.status !== 'ok') throw new HttpError(409, card.reason ?? 'This card can’t be made yet.', 'unavailable');
  const template = CARD_TYPES[type].template(options.format, options.layout, card.subject);
  const key = cacheKey({ type, template, data: card.data });
  const cached = await cachedImage(db, key);
  if (cached) return { png: cached.png, cached: true, ms: cached.ms, card };
  if (inflight.has(key)) return inflight.get(key);
  const net = networkOf(req);
  const account = req.session?.stage === 'full' ? String(req.session.accountId) : null;
  const slot = limits.cardRendersByNetwork.take(net);
  const aslot = slot && account ? limits.cardRendersByAccount.take(account) : null;
  if (!slot || (account && !aslot)) {
    limits.cardRendersByNetwork.refund(slot);
    const retry = Math.max(limits.cardRendersByNetwork.check(net).retryAfterMs, account ? limits.cardRendersByAccount.check(account).retryAfterMs : 0);
    throw Object.assign(new HttpError(429, 'Too many new cards from your network or account. Wait a little and try again.', 'rate_limited'), { retryAfterMs: retry });
  }
  const job = (async () => {
    try {
      const data = await withImages(card.data, fetch);
      const out = await renderer.render({ type, format: options.format, layout: options.layout, subject: card.subject, data });
      await storeImage(db, { key, subject: card.subjectKey, characterIds: card.characterIds, guildIds: card.guildIds, png: out.png, ms: out.ms, dataAt: card.dataAt });
      return { png: out.png, cached: false, ms: out.ms, card };
    } catch (err) {
      limits.cardRendersByNetwork.refund(slot);
      if (aslot) limits.cardRendersByAccount.refund(aslot);
      if (err instanceof RendererBusy) throw Object.assign(new HttpError(503, 'Lots of cards are being made right now. Try again in a few seconds.', 'busy'), { retryAfterMs: 5000 });
      if (err instanceof HttpError) throw err;
      throw new HttpError(500, 'Couldn’t generate the image.', 'render_failed');
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

function sendPng(res, out, { filename = null, maxAge = 300 } = {}) {
  res.set('Content-Type', 'image/png');
  // Short and public: a link-preview fetcher may cache it, and a character hidden later stops showing within minutes.
  res.set('Cache-Control', `public, max-age=${maxAge}`);
  res.set('X-Card-Cache', out.cached ? 'hit' : 'miss');
  if (Number.isFinite(out.ms)) res.set('X-Card-Render-Ms', String(out.ms));
  if (filename) res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(out.png);
}

function sendError(res, err) {
  if (err.retryAfterMs) res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
  res.set('Cache-Control', 'no-store');
  res.status(err.status ?? 500).json({ error: err.message, code: err.code ?? 'error' });
}

/** The id a saved default is stored under, or null. */
async function subjectId(db, type, params) {
  if (type === 'character' || type === 'tier' || type === 'collections') return (await db.one('SELECT id FROM characters WHERE slug = $1 AND NOT hidden', [params.c]))?.id ?? null;
  if (type === 'guild') return (await db.one('SELECT id FROM guilds WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1', [params.g]))?.id ?? null;
  return null;
}

/** Whether the signed-in viewer may "Save as my default" for this subject: 'owner' | 'gm' | 'officer' | null. */
async function saveRole(db, req, type, params) {
  if (req.session?.stage !== 'full') return null;
  const me = Number(req.session.accountId);
  if (type === 'character' || type === 'tier' || type === 'collections') {
    const row = await db.one('SELECT owner_account_id FROM characters WHERE slug = $1 AND NOT hidden', [params.c]);
    return row && Number(row.owner_account_id) === me ? 'owner' : null;
  }
  if (type === 'guild') {
    const id = await subjectId(db, 'guild', params);
    return id ? guildRole(db, id, me) : null;
  }
  return null; // a board placement belongs to no one: its choices are never saved
}

/** What the maker offers for this subject. */
async function makerChoices(db, type, params) {
  if (type === 'character') {
    const row = await db.one('SELECT * FROM characters WHERE slug = $1', [params.c]);
    const c = await characterView(db, row);
    const stats = await characterStatChoices(db, row);
    return {
      stats: stats.map((s) => ({ id: s.id, name: s.text ? `${s.name} · ${s.text}` : s.name, category: s.category, value: s.value, rank: s.rank, available: s.available })),
      defaultStats: await defaultStatIds(db, row, stats),
      render: c.renderHidden ? { available: false, reason: 'Its owner hid the render, so the card uses the crest version.' }
        : c.media.state !== 'ok' ? { available: false, reason: 'Blizzard’s render isn’t ready yet, so the card uses the crest version.' } : { available: true },
      transmog: (c.equipment ?? []).some((i) => i.transmog),
      badge: Boolean(c.claimedBy?.badge),
      guild: Boolean(c.guild),
    };
  }
  if (type === 'guild') {
    const g = await db.one('SELECT * FROM guilds WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1', [params.g]);
    const badges = await guildBadgesView(db, g);
    const { statistics } = await loadCatalog(db);
    const totals = await db.query(
      "SELECT statistic_id, total FROM guild_totals WHERE guild_id = $1 AND period = 'overall' AND period_start = $2 AND total > 0 ORDER BY total DESC LIMIT 300",
      [g.id, guildPeriodStart('overall')],
    );
    const links = await guildLinksView(db, g.id);
    return {
      badges: [...(badges?.row ?? []), ...(badges?.more ?? [])].map((b) => ({ id: b.id, name: b.name, numeral: b.numeral, art: b.art })),
      totals: totals.map((t) => ({ id: Number(t.statistic_id), name: statistics.get(Number(t.statistic_id))?.name ?? null, total: t.total })).filter((t) => t.name),
      discord: links?.discord?.code ? `discord.gg/${links.discord.code}` : null,
    };
  }
  if (type === 'board') {
    const info = await periodsInfo(db);
    return { periods: await Promise.all(BOARD_PERIODS.map(async (p) => ({ id: p, label: await periodLabel(db, p), open: p === 'overall' || Boolean(info[p]?.open) }))) };
  }
  return {};
}

export function createCardApiRouter({ db, limits, networkOf }) {
  const r = express.Router();

  r.get('/cards/maker', route(async (req, res) => {
    const type = String(req.query.type ?? '');
    const { params } = subjectFrom(type, req.query);
    const id = await subjectId(db, type, params);
    const role = await saveRole(db, req, type, params);
    const saved = id && ['character', 'tier', 'guild', 'collections'].includes(type) ? await savedDefault(db, type, id) : null;
    const MAKER_FORMAT = { character: 'square', guild: 'square', board: 'story', tier: 'wide', collections: 'square' };
    const initial = saved?.options ?? cleanOptions(type, { ...defaultOptions(type), format: MAKER_FORMAT[type] });
    const card = await built(db, type, params, initial);
    const head = {
      type,
      subject: params,
      query: subjectQuery(type, params),
      formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label, width: f.width, height: f.height, hint: f.hint })),
      themes: THEMES.map((id) => ({ id, label: THEME_LABELS[id] })),
      accents: ACCENTS,
      layouts: Object.entries(CARD_TYPES[type].layouts).map(([id, label]) => ({ id, label })),
      toggles: Object.keys(CARD_TYPES[type].toggles),
      maxStats: MAX_STATS,
      statsShown: Object.fromEntries(Object.keys(FORMATS).flatMap((f) => ['a', 'b'].map((l) => [`${f}-${l}`, statsShown(f, l)]))),
    };
    if (card.status === 'hidden') return res.json({ ...head, status: 'hidden' });
    if (card.status === 'not_found') throw new HttpError(404, 'Everstats doesn’t have that yet.', 'not_found');
    res.json({
      ...head,
      status: card.status,
      reason: card.status === 'ok' ? null : card.reason,
      title: card.title ?? null,
      page: card.page ?? null,
      canSave: Boolean(role),
      role,
      saved: saved ? { options: saved.options, savedAt: saved.savedAt } : null,
      initial,
      choices: await makerChoices(db, type, params),
      linkPreview: card.status === 'ok' ? ogPath(type, params) : null,
      // 0.8.1: Blizzard renders switched off by the admin: cards use the crest; the maker says why
      rendersPaused: await (async () => { const r = await renderSwitch(db); return r.paused ? r.note : null; })(),
    });
  }));

  r.put('/cards/default', limitWrites(limits, networkOf), route(async (req, res) => {
    if (req.session?.stage !== 'full') throw new HttpError(401, 'Sign in first.', 'signed_out');
    const type = String(req.body?.type ?? '');
    if (!['character', 'tier', 'guild'].includes(type)) throw new HttpError(400, 'Only character, tier and guild cards have a saved default.', 'invalid');
    const { params } = subjectFrom(type, req.body?.subject ?? {});
    const role = await saveRole(db, req, type, params);
    if (!role) throw new HttpError(403, type === 'guild' ? 'Only the Guild Master and officers can save this guild’s default card.' : 'Only the character’s owner can save its default card.', 'forbidden');
    const id = await subjectId(db, type, params);
    const options = await db.tx(async (q) => {
      const clean = await saveDefault(q, { kind: type, subjectId: id, options: req.body?.options, accountId: req.session.accountId });
      await logAccountEvent(q, req.session.accountId, 'share_card.default_saved', { kind: type, subject: Number(id) });
      if (type === 'guild') {
        await q.query("INSERT INTO guild_events (guild_id, type, account_id, actor_account_id, actor, detail) VALUES ($1, 'share_card.default_saved', $2, $2, 'player', '{}'::jsonb)", [id, req.session.accountId]);
      }
      return clean;
    });
    clearCardMemo();
    res.json({ saved: { options, savedAt: new Date().toISOString() } });
  }));
  return r;
}

function limitWrites(limits, networkOf) {
  return (req, res, next) => {
    const key = networkOf(req);
    if (limits.writes.take(key)) return next();
    res.set('Retry-After', String(Math.ceil(limits.writes.check(key).retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Too many changes. Wait a little and try again.', code: 'rate_limited' });
  };
}

/** The link-preview image path of a subject (meta.js adds the version). */
export function ogPath(type, p) {
  if (type === 'character') return `/og/c/${encodeURIComponent(p.c)}.png`;
  if (type === 'tier') return `/og/t/${encodeURIComponent(p.c)}.png`;
  if (type === 'collections') return `/og/k/${encodeURIComponent(p.c)}.png`;
  if (type === 'guild') return `/og/g/${encodeURIComponent(p.g)}.png`;
  const q = new URLSearchParams();
  if (p.c) q.set('c', p.c);
  if (p.g) {
    q.set('g', p.g);
    if (p.mode === 'average') q.set('mode', 'average');
  }
  if (p.period && p.period !== 'overall') q.set('period', p.period);
  return `/og/b/${p.rulesetId}/${p.statisticId}.png${q.size ? `?${q}` : ''}`;
}

export function createCardImageRouter(deps) {
  const { db } = deps;
  const r = express.Router();

  r.get('/card.png', async (req, res) => {
    try {
      const type = String(req.query.type ?? '');
      const { params } = subjectFrom(type, req.query);
      const options = decodeOptions(type, req.query.o);
      const out = await cardImage(deps, req, type, params, options);
      const name = (params.c ?? params.g ?? `board-${params.statisticId}`).replace(/[^a-z0-9-]/gi, '');
      sendPng(res, out, { filename: req.query.download === '1' ? `everstats-${name}-${type}-${options.format}.png` : null });
    } catch (err) {
      sendError(res, err);
    }
  });

  const og = (type, read) => async (req, res) => {
    try {
      const file = String(req.params.file ?? '');
      if (!file.endsWith('.png')) throw new HttpError(404, 'Not found', 'not_found');
      const { params } = await read(file.slice(0, -4), req);
      const id = await subjectId(db, type, params);
      const options = type === 'board' ? cleanOptions('board', defaultOptions('board')) : await previewOptions(db, type, id);
      const out = await cardImage(deps, req, type, params, options);
      sendPng(res, out, { maxAge: 600 });
    } catch (err) {
      sendError(res, err);
    }
  };
  r.get('/og/c/:file', og('character', (s) => subjectFrom('character', { c: s })));
  r.get('/og/k/:file', og('collections', (s) => subjectFrom('collections', { c: s })));
  r.get('/og/t/:file', og('tier', (s) => subjectFrom('tier', { c: s })));
  r.get('/og/g/:file', og('guild', (s) => subjectFrom('guild', { g: s })));
  r.get('/og/b/:ruleset/:file', og('board', async (s, req) => {
    const q = { ...req.query, ruleset: req.params.ruleset, statistic: s };
    if (q.c === undefined && q.g === undefined) {
      // A board page itself: its #1 (the board's own top row), if it has one.
      const top = (await boardPage(db, { statisticId: Number(s), rulesetId: Number(req.params.ruleset), period: BOARD_PERIODS.includes(q.period) ? q.period : 'overall', limit: 1 })).rows[0];
      const slug = top ? (await db.one('SELECT slug FROM characters WHERE id = $1', [top.characterId]))?.slug : null;
      if (!slug) throw new HttpError(404, 'This board has nobody on it yet.', 'not_found');
      q.c = slug;
    }
    return subjectFrom('board', q);
  }));
  return r;
}

export { getSetting };
