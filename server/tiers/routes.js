import express from 'express';
import { TIER_SETTING_KEYS, checkSetting, getSetting, listSettings, setSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { PRIMARY_VERSION, versionById } from '../core/gameVersions.js';
import { rulesetList } from '../characters/routes.js';
import { weightsProblem } from './engine.js';
import { countingNow, eligibleCount, previewTiers, requestTierRecompute } from './store.js';
import { adminTierState, howTiersWork, tierBoard } from './view.js';

/**
 * Tier routes (0.6.0).
 *   public  GET /api/tiers/how            the "How tiers work" page: live settings, what counts (owner's decisions)
 *           GET /api/tiers/boards         a tier board: ?ruleset=&scope=overall|<category key>&cursor=
 *   admin   GET  /api/admin/tiers         settings, what counts (with reasons and inconsistencies), runs, rulesets
 *           POST /api/admin/tiers/preview letters per ruleset with proposed settings; nothing is saved
 *           PUT  /api/admin/tiers/settings save the tier settings (each change logged, with the admin's reason since
 *                                          0.10.3; a full grading follows)
 *           POST /api/admin/tiers/regrade ask for a full grading now → the run it queued or joined + the gradings
 *           GET  /api/admin/tiers/runs    (0.10.3) the gradings and this version's rulesets only: what the Tiers page polls
 *                                          while a grading is pending or running, so "Grade everyone now" shows
 *                                          queued → grading → done with its result in place
 * 0.10.3: the version comes as `version` or `v` (the admin's version switcher writes ?v=&r=).
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

const versionFromQuery = (query) => versionOf(query?.version ?? query?.v);

/**
 * The gradings (tier_runs: one grading covers every version) with, per run, what it did on THIS version's realm
 * categories: how many were graded, how many characters, the overall letters summed. Plus the version's categories now.
 */
async function tierRunsView(db, version) {
  const rows = await db.query(
    'SELECT r.id, r.name, t.population, t.graded, t.computed_at FROM rulesets r LEFT JOIN tier_rulesets t ON t.ruleset_id = r.id WHERE r.game_version = $1 ORDER BY r.id LIMIT 50',
    [version],
  );
  const mine = new Set(rows.map((r) => Number(r.id)));
  const runs = await db.query('SELECT id, status, reasons, requested_at, started_at, finished_at, ms, summary, problem FROM tier_runs ORDER BY id DESC LIMIT 10');
  const rulesets = [];
  for (const r of rows) rulesets.push({ id: r.id, name: r.name, eligible: await eligibleCount(db, r.id), graded: Boolean(r.graded), gradedAt: r.computed_at ?? null, gradedPopulation: r.population ?? null });
  return {
    version,
    rulesets,
    runs: runs.map((run) => {
      const here = (run.summary?.rulesets ?? []).filter((x) => mine.has(Number(x.rulesetId)));
      const letters = { S: 0, A: 0, B: 0, C: 0, D: 0, unranked: 0 };
      for (const x of here) for (const k of Object.keys(letters)) letters[k] += Number(x.overall?.[k] ?? 0);
      return {
        ...run,
        here: run.summary ? {
          rulesets: here.length,
          graded: here.filter((x) => x.graded).length,
          characters: here.filter((x) => x.graded).reduce((n, x) => n + Number(x.population ?? 0), 0),
          letters: here.some((x) => x.graded) ? letters : null,
        } : null,
      };
    }),
  };
}

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
  r.get('/tiers', route(async (req, res) => {
    const version = versionFromQuery(req.query);
    // 0.10.3: each tier setting's label, help, default and when it was last saved, for the setting rows.
    const meta = (await listSettings(db, { version })).filter((s) => TIER_SETTING_KEYS.includes(s.key))
      .map((s) => ({ key: s.key, label: s.label, help: s.help, default: s.default, updatedAt: s.updatedAt, min: s.min ?? null, max: s.max ?? null }));
    res.json({ ...(await adminTierState(db, { version })), meta });
  }));
  r.get('/tiers/runs', route(async (req, res) => res.json(await tierRunsView(db, versionFromQuery(req.query)))));

  r.post('/tiers/preview', writes, route(async (req, res) => {
    const version = versionOf(req.body?.version);
    const settings = await settingsFrom(db, req.body);
    res.json({ settings, preview: await previewTiers(db, settings, { version }) });
  }));

  r.put('/tiers/settings', writes, route(async (req, res) => {
    const version = versionOf(req.body?.version);
    const settings = await settingsFrom(db, req.body);
    // 0.10.3: the admin's reason ("Save and regrade") goes into each change's audit-log entry.
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
    await db.tx(async (q) => {
      for (const [field, key] of Object.entries(FIELDS)) {
        const now = await getSetting(q, key, { version });
        if (JSON.stringify(now) !== JSON.stringify(settings[field])) await setSetting(q, key, settings[field], { q, version, reason });
      }
    });
    res.json(await adminTierState(db, { version }));
  }));

  // One grading covers every version; `version` says which page asked (the log, and whose rulesets the answer lists).
  r.post('/tiers/regrade', writes, route(async (req, res) => {
    const version = versionOf(req.body?.version);
    const runId = await db.tx(async (q) => {
      const id = await requestTierRecompute(q, 'admin asked');
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('tiers.regrade_requested', $1::jsonb)", [JSON.stringify({ version, run: id })]);
      return id;
    });
    res.json({ runId, ...(await tierRunsView(db, version)) });
  }));
  return r;
}

export { TIER_SETTING_KEYS };
