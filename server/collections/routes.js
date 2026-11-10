import { scopeSql } from '../core/config.js';
import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { PRIORITY } from '../crawler/queue.js';
import { getSource } from '../sources/registry.js';
import { parseSlug } from '../stats/slug.js';
import { rulesetList } from '../characters/routes.js';
import { COLLECTIONS_STALE_MS, queueCollections } from './fetch.js';
import { GOLD_FIELDS, goldBoard, goldFor, setGoldPublic } from './gold.js';
import { kindById } from './registry.js';
import { collectionSection, collectionsOverview } from './view.js';

/**
 * Collections and gold (0.9.0).
 *
 *   GET  /api/characters/:slug/collections            the tab: counts, section summaries, Legacy, gold (owner, or
 *                                                     public by opt-in). Opening it on data older than a day (or none)
 *                                                     queues a refresh at lookup priority (the per-network look-up
 *                                                     limit applies) and says `refreshing`; the page polls.
 *   GET  /api/characters/:slug/collections/:kind      one section in full (transmog ?slot=, quests ?q=&cursor=)
 *   POST /api/characters/:slug/collections/refresh    "Refresh now" (same limit)
 *   PUT  /api/account/characters/:id/gold-public      the owner's "Show my gold stats publicly"
 *   GET  /api/gold-boards?ruleset=                    which gold boards exist, with counts
 *   GET  /api/gold-boards/:ruleset/:field             one gold board (opted-in characters only)
 */
const SECTION_KINDS = new Set([...kindById.keys(), 'legacy']);

export function createCollectionsRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const viewerOf = (req) => (req.session?.stage === 'full' ? req.session.accountId : null);

  async function character(req) {
    const parsed = parseSlug(req.params.slug);
    if (!parsed) throw new HttpError(400, 'That isn’t a character name and surname.', 'invalid');
    const row = await db.one(`SELECT * FROM characters WHERE slug = $1 AND ${scopeSql()}`, [parsed.slug]);
    const viewer = viewerOf(req);
    const mine = Boolean(viewer && row && Number(row.owner_account_id) === Number(viewer));
    if (!row || row.profile_state !== 'ok') return { status: 'not_found', slug: parsed.slug };
    if (row.hidden && !mine) return { status: 'hidden', slug: parsed.slug };
    if (row.missing_since) return { status: 'missing', slug: parsed.slug, since: row.data_fetched_at };
    return { status: 'ok', row, mine, viewer };
  }

  const pending = async (slug) => Boolean(await db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections' AND key = $1 AND state IN ('queued', 'running')", [slug]));

  /** Queues a lookup-priority refresh if allowed. → 'queued' | 'pending' | 'rate_limited' | 'not_configured' | 'too_low' */
  async function refresh(req, row) {
    if ((row.level ?? 0) < 10) return 'too_low';
    if (await pending(row.slug)) {
      await queueCollections(db, { slug: row.slug, realmSlug: row.realm_slug }, PRIORITY.lookup, { version: row.game_version, region: row.region }); // raises a queued background refresh to lookup priority
      return 'pending';
    }
    if (!(await isConfigured(db, getSource('blizzard').credential))) return 'not_configured';
    if (!limits.lookups.take(networkOf(req))) return 'rate_limited';
    await queueCollections(db, { slug: row.slug, realmSlug: row.realm_slug }, PRIORITY.lookup, { version: row.game_version, region: row.region });
    return 'queued';
  }

  r.get('/characters/:slug/collections', route(async (req, res) => {
    const c = await character(req);
    if (c.status !== 'ok') return res.json(c);
    const stale = !c.row.collections_fetched_at || Date.now() - new Date(c.row.collections_fetched_at).getTime() > COLLECTIONS_STALE_MS;
    const refreshNote = stale ? await refresh(req, c.row) : (await pending(c.row.slug)) ? 'pending' : null;
    res.json({
      status: 'ok',
      character: { id: c.row.id, slug: c.row.slug, name: c.row.name, surname: c.row.surname, class: c.row.class, level: c.row.level, ruleset: c.row.ruleset_id, hidden: c.row.hidden, mine: c.mine },
      refreshing: refreshNote === 'queued' || refreshNote === 'pending',
      refresh: refreshNote,
      ...(await collectionsOverview(db, c.row)),
      gold: await goldFor(db, c.row, c.viewer),
    });
  }));

  r.post('/characters/:slug/collections/refresh', route(async (req, res) => {
    const c = await character(req);
    if (c.status !== 'ok') throw new HttpError(404, 'Everstats doesn’t track that character.', 'not_found');
    const out = await refresh(req, c.row);
    if (out === 'rate_limited') {
      const { retryAfterMs } = limits.lookups.check(networkOf(req));
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Too many look-ups from your network. Wait a little and try again.', code: 'rate_limited', retryAfterMs });
    }
    res.json({ refresh: out });
  }));

  r.get('/characters/:slug/collections/:kind', route(async (req, res) => {
    if (!SECTION_KINDS.has(req.params.kind)) throw new HttpError(404, 'Not found');
    const c = await character(req);
    if (c.status !== 'ok') return res.json(c);
    const q = { q: typeof req.query.q === 'string' ? req.query.q : '', cursor: req.query.cursor, slot: typeof req.query.slot === 'string' && /^[A-Z0-9_]{1,30}$/.test(req.query.slot) ? req.query.slot : null };
    res.json({ status: 'ok', section: await collectionSection(db, c.row, req.params.kind, q) });
  }));

  r.put('/account/characters/:id/gold-public', route(async (req, res) => {
    const viewer = viewerOf(req);
    if (!viewer) throw new HttpError(401, 'Sign in first.', 'signed_out');
    if (!limits.writes.take(networkOf(req))) throw new HttpError(429, 'Too many changes. Wait a little.', 'rate_limited');
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) throw new HttpError(404, 'Not found');
    const on = req.body?.public === true;
    const row = await db.one('SELECT id FROM characters WHERE id = $1 AND owner_account_id = $2', [id, viewer]);
    if (!row) throw new HttpError(404, 'That isn’t one of your characters.', 'not_yours');
    await db.tx((q) => setGoldPublic(q, id, viewer, on));
    res.json({ public: on });
  }));

  // The owner's own gold, for the dashboard: every owned character Everstats has gold for (private unless shared).
  r.get('/account/gold', route(async (req, res) => {
    const viewer = viewerOf(req);
    if (!viewer) throw new HttpError(401, 'Sign in first.', 'signed_out');
    const rows = await db.query(
      `SELECT c.id, c.slug, c.name, c.surname, g.money, g.gold_gained, g.gold_lost, g.item_value_gained, g.fetched_at,
              EXISTS (SELECT 1 FROM character_gold_public p WHERE p.character_id = c.id AND p.account_id = $1) AS public
         FROM characters c JOIN character_gold g ON g.character_id = c.id AND g.account_id = $1
        WHERE c.owner_account_id = $1 ORDER BY g.money DESC NULLS LAST, c.id LIMIT 50`,
      [viewer],
    );
    const n = (v) => (v === null ? null : Number(v));
    res.json({ characters: rows.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, surname: r.surname, public: r.public, fetchedAt: r.fetched_at, fields: { money: n(r.money), gained: n(r.gold_gained), lost: n(r.gold_lost), items: n(r.item_value_gained) } })) });
  }));

  r.get('/gold-boards', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    const asked = req.query.ruleset !== undefined ? Number(req.query.ruleset) : null;
    const ruleset = rulesets.find((x) => x.id === asked) ?? [...rulesets].sort((a, b) => b.tracked - a.tracked)[0] ?? null;
    if (!ruleset) return res.json({ rulesets, ruleset: null, boards: [] });
    const boards = [];
    for (const f of GOLD_FIELDS) {
      const b = await goldBoard(db, { rulesetId: ruleset.id, field: f.key, limit: 3 });
      boards.push({ key: f.key, label: f.label, ranked: b.ranked, top: b.rows });
    }
    res.json({ rulesets, ruleset, boards });
  }));

  r.get('/gold-boards/:ruleset/:field', route(async (req, res) => {
    const rulesetId = Number(req.params.ruleset);
    const rulesets = await rulesetList(db);
    const ruleset = rulesets.find((x) => x.id === rulesetId);
    if (!ruleset) throw new HttpError(404, 'Everstats has no such board.', 'no_board');
    const b = await goldBoard(db, { rulesetId, field: req.params.field, cursor: req.query.cursor, limit: req.query.limit });
    if (!b) throw new HttpError(404, 'Everstats has no such board.', 'no_board');
    res.json({ ruleset, rulesets, fields: GOLD_FIELDS.map((f) => ({ key: f.key, label: f.label })), ...b });
  }));

  return r;
}
