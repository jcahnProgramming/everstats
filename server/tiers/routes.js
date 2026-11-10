import express from 'express';
import { TIER_SETTING_KEYS, checkSetting, getSetting, setSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { PRIMARY_VERSION, versionById } from '../core/gameVersions.js';
import { rulesetList } from '../characters/routes.js';
import { weightsProblem } from './engine.js';
import { countingNow, previewTiers, requestTierRecompute } from './store.js';
import { adminTierState, howTiersWork, tierBoard } from './view.js';

/**
 * Tier routes (0.6.0).
 *   public  GET /api/tiers/how            the "How tiers work" page: live settings, what counts (owner's decisions)
 *           GET /api/tiers/boards         a tier board: ?ruleset=&scope=overall|<category key>&cursor=
 *   admin   GET  /api/admin/tiers         settings, what counts (with reasons and inconsistencies), runs, rulesets
 *           POST /api/admin/tiers/preview letters per ruleset with proposed settings; nothing is saved
 *           PUT  /api/admin/tiers/settings save the tier settings (each change logged; a full grading follows)
 *           POST /api/admin/tiers/regrade ask for a full grading now
 * The admin ones are mounted inside the admin router, after its gate: a plain 404 without an admin session.
 */
const FIELDS = { shares: 'tiers.shares', minPopulation: 'grading.minPopulation', categoryHalf: 'tiers.categoryHalf', overallHalf: 'tiers.overallHalf', weights: 'tiers.weights' };

/**
 * The tier settings from a request body, each validated by the settings registry, and the weight pins also against
 * the live categories (an older admin page that doesn't send weights keeps the saved pins).
 */
// 0.10.0: the tier settings are per game version ({ version } in the body or query; default the primary).
const versionOf = (x) => {
  const v = String(x ?? PRIMARY_VERSION.id);
  if (!versionById(v)) throw new HttpError(400, 'Unknown game version', 'invalid');
  return v;
};

async function settingsFrom(db, body) {
  const version = versionOf(body?.version);
  const out = {};
  for (const [field, key] of Object.entries(FIELDS)) {
    out[field] = field === 'weights' && body?.weights === undefined ? await getSetting(db, key, { version }) : checkSetting(key, body?.[field]);
  }
  const { plan } = await countingNow(db, { fresh: true, version });
  const problem = weightsProblem(plan, out.weights);
  if (problem) throw new HttpError(400, problem, 'invalid');
  return { ...out, weighting: 'sqrt' };
}

export function createTierRouter({ db }) {
  const r = express.Router();
  r.get('/tiers/how', route(async (req, res) => res.json(await howTiersWork(db))));

  r.get('/tiers/boards', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    const asked = req.query.ruleset !== undefined ? Number(req.query.ruleset) : null;
    const ruleset = rulesets.find((x) => x.id === asked) ?? [...rulesets].sort((a, b) => b.tracked - a.tracked)[0] ?? null;
    const scope = typeof req.query.scope === 'string' && /^[a-z0-9-]{1,80}$/.test(req.query.scope) ? req.query.scope : 'overall';
    if (!ruleset) return res.json({ rulesets, ruleset: null, scope, rows: [] });
    const board = await tierBoard(db, { rulesetId: ruleset.id, scope, cursor: req.query.cursor, limit: req.query.limit });
    if (board.missingScope) throw new HttpError(404, 'That category has no tier board on this ruleset.', 'no_board');
    const ids = board.rows.map((x) => x.characterId);
    const chars = ids.length ? await db.query(
      `SELECT c.id, c.slug, c.name, c.surname, c.level, c.race, c.class, g.name AS guild, g.slug AS guild_slug
         FROM characters c LEFT JOIN guilds g ON g.id = c.guild_id WHERE c.id = ANY($1::bigint[]) LIMIT 200`,
      [ids],
    ) : [];
    const byId = new Map(chars.map((c) => [Number(c.id), c]));
    const viewer = req.session?.stage === 'full' ? req.session.accountId : null;
    const owned = viewer ? new Set((await db.query('SELECT id FROM characters WHERE owner_account_id = $1 LIMIT 50', [viewer])).map((x) => Number(x.id))) : new Set();
    res.json({
      rulesets, ruleset, ...board,
      rows: board.rows.map((x) => {
        const c = byId.get(x.characterId);
        return {
          rank: x.rank, score: x.score, letter: x.letter, slug: c?.slug ?? null, name: c?.name ?? '', surname: c?.surname ?? '', level: c?.level ?? null,
          race: c?.race ?? null, class: c?.class ?? null, guild: c?.guild ?? null, guildSlug: c?.guild_slug ?? null, mine: owned.has(x.characterId),
        };
      }),
    });
  }));
  return r;
}

export function createAdminTierRouter({ db, writes }) {
  const r = express.Router();
  r.get('/tiers', route(async (req, res) => res.json(await adminTierState(db, { version: versionOf(req.query.version) }))));

  r.post('/tiers/preview', writes, route(async (req, res) => {
    const version = versionOf(req.body?.version);
    const settings = await settingsFrom(db, req.body);
    res.json({ settings, preview: await previewTiers(db, settings, { version }) });
  }));

  r.put('/tiers/settings', writes, route(async (req, res) => {
    const version = versionOf(req.body?.version);
    const settings = await settingsFrom(db, req.body);
    await db.tx(async (q) => {
      for (const [field, key] of Object.entries(FIELDS)) {
        const now = await getSetting(q, key, { version });
        if (JSON.stringify(now) !== JSON.stringify(settings[field])) await setSetting(q, key, settings[field], { q, version });
      }
    });
    res.json(await adminTierState(db, { version }));
  }));

  r.post('/tiers/regrade', writes, route(async (req, res) => {
    await db.tx(async (q) => {
      await requestTierRecompute(q, 'admin asked');
      await q.query("INSERT INTO admin_events (type) VALUES ('tiers.regrade_requested')");
    });
    res.json(await adminTierState(db));
  }));
  return r;
}

export { TIER_SETTING_KEYS };
