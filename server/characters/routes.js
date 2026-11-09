import express from 'express';
import { getSetting } from '../admin/settings.js';
import { betaState } from '../beta.js';
import { config } from '../core/config.js';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { PRIORITY, enqueue, waitFor } from '../crawler/queue.js';
import { getSource } from '../sources/registry.js';
import { BOARD_PERIODS, boardCounts, boardPage, everyoneTied, populationOf, rankOn, statCounts } from '../stats/boards.js';
import { categoryKey, loadCatalog } from '../stats/catalog.js';
import { nextPeriodStart, periodOpen, periodStart } from '../stats/periods.js';
import { parseSlug } from '../stats/slug.js';
import { characterStatistics, characterView } from './view.js';

/**
 * The public, read-mostly API: character lookups, leaderboards, the statistics catalog, coverage and the beta.
 *
 * A lookup refreshes the character from Blizzard straight away (queued at priority 1, ahead of all background work)
 * unless it was fully fetched in the last LOOKUP_FRESH_MS: a page reload is not a reason to ask Blizzard again. Only a
 * lookup that really asks Blizzard counts against the per-network lookup limit.
 */
export const LOOKUP_FRESH_MS = 10 * 60 * 1000;
export const LOOKUP_WAIT_MS = 20_000;

const intParam = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== String(v)) throw new HttpError(404, 'Not found');
  return n;
};

async function rulesetList(db) {
  const rows = await db.query(
    `SELECT r.id, r.name, r.listed, (SELECT count(*)::int FROM characters c WHERE c.ruleset_id = r.id AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden) AS tracked
       FROM rulesets r ORDER BY r.listed DESC, r.id LIMIT 50`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, listed: r.listed, tracked: r.tracked }));
}

async function periodsInfo(db, now = Date.now) {
  const fact = await db.one("SELECT at FROM pipeline_facts WHERE key = 'first_snapshot_at'");
  const out = {};
  for (const p of ['week', 'month']) {
    const o = periodOpen(p, fact?.at ?? null, now());
    out[p] = { open: o.open, opensAt: o.opensAt, start: periodStart(p, now()).toISOString(), endsAt: nextPeriodStart(p, now()).toISOString() };
  }
  return { firstSnapshotAt: fact?.at ?? null, ...out };
}

async function charactersById(db, ids) {
  if (!ids.length) return new Map();
  const rows = await db.query(
    `SELECT c.id, c.slug, c.name, c.surname, c.level, c.race, c.class, c.faction, g.name AS guild
       FROM characters c LEFT JOIN guilds g ON g.id = c.guild_id WHERE c.id = ANY($1::bigint[]) LIMIT 200`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
const rowView = (r, c, viewer) => ({
  rank: r.rank, value: r.value, text: r.text ?? null,
  slug: c?.slug ?? null, name: c?.name ?? '', surname: c?.surname ?? '', level: c?.level ?? null, race: c?.race ?? null,
  class: c?.class ?? null, faction: c?.faction ?? null, guild: c?.guild ?? null, mine: Boolean(viewer && c && viewer.has(c.id)),
});

export function createPublicRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const viewerOf = (req) => (req.session?.stage === 'full' ? req.session.accountId : null);
  const blizzardReady = () => isConfigured(db, getSource('blizzard').credential);

  // What Everstats covers right now. Every page's empty states read this. null = not measured, never zero.
  r.get('/coverage', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    res.json({
      region: config.region,
      lookups: (await blizzardReady()) ? 'on' : 'not_configured',
      rulesets: rulesets.length ? rulesets : null,
      trackedCharacters: (await db.one('SELECT count(*)::int AS n FROM characters WHERE stats_fetched_at IS NOT NULL AND NOT hidden')).n,
      minPopulation: await getSetting(db, 'grading.minPopulation'),
    });
  }));

  r.get('/beta', route(async (req, res) => {
    res.json({ ...(await betaState(db)), perks: await getSetting(db, 'beta.perks') });
  }));

  // The statistics catalog (for the pin picker and the leaderboard index): ids, names, categories.
  r.get('/statistics', route(async (req, res) => {
    const { statistics, categories } = await loadCatalog(db);
    res.json({
      categories: categories.map((c) => ({
        label: c.label, key: categoryKey(c.label), farmable: c.farmable, graded: c.graded,
        statistics: c.statisticIds.map((id) => ({ id, name: statistics.get(id).name, grading: statistics.get(id).grading })),
      })),
    });
  }));

  // ---- Character lookup
  r.get('/characters/:slug', route(async (req, res) => {
    const parsed = parseSlug(req.params.slug);
    if (!parsed) throw new HttpError(400, 'That isn’t a character name and surname.', 'invalid');
    const viewer = viewerOf(req);
    let row = await db.one('SELECT * FROM characters WHERE slug = $1', [parsed.slug]);
    const mine = () => Boolean(viewer && row && row.owner_account_id === viewer);
    if (row?.hidden && !mine()) return res.json({ status: 'hidden', slug: parsed.slug });

    let notice = null;
    const fresh = row?.profile_state === 'ok' && row.last_fetched_at && Date.now() - new Date(row.last_fetched_at).getTime() < LOOKUP_FRESH_MS;
    if (!fresh) {
      if (!(await blizzardReady())) {
        if (row?.profile_state !== 'ok') return res.json({ status: 'unavailable', reason: 'not_configured', slug: parsed.slug });
        notice = 'not_configured';
      } else if (!limits.lookups.take(networkOf(req))) {
        if (row?.profile_state !== 'ok') {
          const { retryAfterMs } = limits.lookups.check(networkOf(req));
          res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
          return res.status(429).json({ error: 'Too many look-ups from your network. Wait a little and try again.', code: 'rate_limited', retryAfterMs });
        }
        notice = 'rate_limited';
      } else {
        const item = await enqueue(db, { key: parsed.slug, priority: PRIORITY.lookup, mode: 'full', accountId: viewer });
        const done = await waitFor(db, item.id, { timeoutMs: LOOKUP_WAIT_MS });
        if (!done) notice = 'slow';
        else if (done.state === 'failed') notice = 'unavailable';
        row = await db.one('SELECT * FROM characters WHERE slug = $1', [parsed.slug]);
        if (row?.hidden && !mine()) return res.json({ status: 'hidden', slug: parsed.slug });
      }
    }
    if (!row || row.profile_state !== 'ok') {
      if (notice === 'slow' || notice === 'unavailable') return res.json({ status: 'unavailable', reason: notice, slug: parsed.slug });
      // Known from an account list or a roster, but Blizzard serves no profile: say what we know, honestly.
      const known = row ? { name: row.name, surname: row.surname, level: row.account_level ?? row.level } : null;
      return res.json({ status: 'not_found', slug: parsed.slug, known });
    }
    res.json({
      status: 'ok',
      notice,
      character: await characterView(db, row, { mine: mine() }),
      statistics: await characterStatistics(db, row),
    });
  }));

  // ---- Leaderboards index: every category's boards on one ruleset, each with its top three.
  r.get('/leaderboards', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    const asked = req.query.ruleset !== undefined ? Number(req.query.ruleset) : null;
    const ruleset = rulesets.find((x) => x.id === asked) ?? [...rulesets].sort((a, b) => b.tracked - a.tracked)[0] ?? null;
    const { statistics, categories } = await loadCatalog(db);
    if (!ruleset) return res.json({ rulesets, ruleset: null, categories: [], periods: await periodsInfo(db) });
    const counts = await boardCounts(db, ruleset.id);
    const ids = [...statistics.keys()];
    const tops = ids.length ? await db.query(
      `SELECT s.id AS statistic_id, t.character_id, t.value, t.text FROM unnest($1::bigint[]) AS s(id)
        CROSS JOIN LATERAL (SELECT character_id, value, text FROM character_statistics
                             WHERE statistic_id = s.id AND ruleset_id = $2 AND NOT hidden AND value > 0
                             ORDER BY value DESC, character_id LIMIT 3) t LIMIT 2000`,
      [ids, ruleset.id],
    ) : [];
    const chars = await charactersById(db, [...new Set(tops.map((t) => t.character_id))]);
    const byStat = new Map();
    for (const t of tops) {
      if (!byStat.has(t.statistic_id)) byStat.set(t.statistic_id, []);
      byStat.get(t.statistic_id).push(t);
    }
    res.json({
      rulesets,
      ruleset,
      population: counts.population,
      periods: await periodsInfo(db),
      categories: categories.map((c) => ({
        label: c.label, key: categoryKey(c.label), farmable: c.farmable, graded: c.graded,
        boards: c.statisticIds.map((id) => {
          const s = statistics.get(id);
          const list = byStat.get(id) ?? [];
          const bc = counts.byStat.get(id);
          const top = list.map((t) => ({ ...t, rank: list.findIndex((x) => x.value === t.value) + 1 }));
          return {
            id, name: s.name, named: s.named, grading: s.grading, nonzero: bc?.nonzero ?? 0,
            tied: everyoneTied(counts.population, bc),
            top: top.map((t) => rowView(t, chars.get(t.character_id), null)),
          };
        }),
      })),
    });
  }));

  // ---- One board: a statistic on a ruleset, in a period, a page at a time.
  r.get('/leaderboards/:ruleset/:statistic', route(async (req, res) => {
    const rulesetId = intParam(req.params.ruleset);
    const statisticId = intParam(req.params.statistic);
    const period = BOARD_PERIODS.includes(req.query.period) ? req.query.period : 'overall';
    const { statistics } = await loadCatalog(db);
    const stat = statistics.get(statisticId);
    const rulesets = await rulesetList(db);
    const ruleset = rulesets.find((x) => x.id === rulesetId);
    if (!stat || !ruleset) throw new HttpError(404, 'Everstats has no such board.', 'no_board');
    const periods = await periodsInfo(db);
    const head = {
      statistic: { id: stat.id, name: stat.name, category: stat.category, categoryKey: categoryKey(stat.category), grading: stat.grading, named: stat.named, valueType: stat.valueType, farmable: stat.farmable },
      ruleset, rulesets, period, periods,
    };
    if (period !== 'overall' && !periods[period].open) return res.json({ ...head, collecting: true, rows: [], next: null });

    const bc = await statCounts(db, { statisticId, rulesetId, period });
    const counts = { population: bc.population };
    const tied = everyoneTied(counts.population, bc);
    const page = tied ? { rows: [], next: null } : await boardPage(db, { statisticId, rulesetId, period, cursor: req.query.cursor, limit: req.query.limit });
    const viewer = viewerOf(req);
    const owned = viewer ? await db.query('SELECT id, slug, name, surname, hidden FROM characters WHERE owner_account_id = $1 AND ruleset_id = $2 AND stats_fetched_at IS NOT NULL LIMIT 50', [viewer, rulesetId]) : [];
    const ownedIds = new Set(owned.map((o) => o.id));
    const chars = await charactersById(db, page.rows.map((x) => x.characterId));
    const mine = [];
    for (const o of owned) {
      if (o.hidden) {
        mine.push({ slug: o.slug, name: o.name, surname: o.surname, hidden: true });
        continue;
      }
      const rk = await rankOn(db, { characterId: o.id, statisticId, rulesetId, period });
      mine.push({ slug: o.slug, name: o.name, surname: o.surname, hidden: false, rank: rk.rank, value: rk.value });
    }
    res.json({
      ...head,
      collecting: false,
      population: counts.population,
      nonzero: bc.nonzero,
      tied,
      tiedValue: tied ? (bc.nonzero ? bc.max : 0) : null,
      zeroRank: bc.nonzero + 1,
      // How fresh the board is: the oldest and newest statistics fetch among its characters.
      data: await db.one('SELECT min(stats_fetched_at) AS oldest, max(stats_fetched_at) AS newest FROM characters WHERE ruleset_id = $1 AND stats_fetched_at IS NOT NULL AND NOT hidden', [rulesetId]),
      rows: page.rows.map((x) => rowView(x, chars.get(x.characterId), ownedIds)),
      next: page.next,
      mine,
    });
  }));

  return r;
}

export { populationOf };
