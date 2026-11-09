import express from 'express';
import { getSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { PRIORITY, enqueue, waitFor } from '../crawler/queue.js';
import { getSource } from '../sources/registry.js';
import { BOARD_PERIODS } from '../stats/boards.js';
import { categoryKey, loadCatalog } from '../stats/catalog.js';
import {
  GUILD_MODES, guildBoardCounts, guildBoardPage, guildPeriodStart, guildPlacements, guildStatCounts, guildTops, guildsNotYetRanked, guildsTied,
} from '../stats/guildBoards.js';
import { OVERALL_START, TRACKED_MEMBER } from '../stats/guildTotals.js';
import { periodStart, ROLLING_START } from '../stats/periods.js';
import { defaultPinIds } from '../stats/pins.js';
import { parseGuildSlug } from '../stats/slug.js';
import { periodsInfo, rulesetList } from '../characters/routes.js';
import { lettersFor } from '../tiers/store.js';
import { guildTierDistribution } from '../tiers/view.js';
import { inlineBadges } from '../badges/store.js';
import { guildLinksView, guildRole } from './manage.js';
import { guildInlineBadges } from '../guildBadges/store.js';
import { guildBadgesView } from '../guildBadges/view.js';
import { countActivity, looksAutomated } from '../activity/count.js';

/**
 * Guild pages, guild boards, the guild index and search (0.5.0). Everything here reads what the crawler already
 * stored: the only Blizzard request a visitor can cause is the look-up of a guild Everstats has never fetched (queued at
 * priority 1, counted against the per-network look-up limit, exactly like a character look-up).
 *
 * Hidden characters appear nowhere here and count toward nothing (TRACKED_MEMBER excludes them; guild_totals is built
 * without them). Untracked roster members are counted, never named.
 */
export const GUILD_WAIT_MS = 20_000;
export const TOP_PER_STAT = 5;
const MAX_ROSTER = 1000;

const intParam = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n < 0 || String(n) !== String(v)) throw new HttpError(404, 'Not found');
  return n;
};
const periodOf = (raw) => (BOARD_PERIODS.includes(raw) ? raw : 'overall');
const modeOf = (raw) => (GUILD_MODES.includes(raw) ? raw : 'total');

/** Guild rank: Blizzard sends only a number. 0 is the guild master; nothing else has a name we could show. */
export const rankName = (rank) => (rank === null || rank === undefined ? null : rank === 0 ? 'Guild Master' : `Rank ${rank}`);

async function guildsById(db, ids) {
  if (!ids.length) return new Map();
  const rows = await db.query('SELECT id, slug, name, faction FROM guilds WHERE id = ANY($1::bigint[]) LIMIT 500', [ids]);
  // 0.7.1: each guild's pinned guild badge and its Verified mark, beside its name on boards and lists.
  const inline = await guildInlineBadges(db, rows.map((r) => r.id));
  return new Map(rows.map((r) => [r.id, {
    slug: r.slug, name: r.name, faction: r.faction, badge: inline.get(Number(r.id))?.badge ?? null, verified: inline.get(Number(r.id))?.verified ?? false,
  }]));
}

/** A guild by its current slug (the most recently seen holder of it). */
const guildBySlug = (db, slug) => db.one('SELECT * FROM guilds WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1', [slug]);

/** An address a guild used to have → its current slug, or null. */
async function movedTo(db, slug) {
  const row = await db.one(
    `SELECT g.slug FROM guild_slugs s JOIN guilds g ON g.id = s.guild_id WHERE s.slug = $1 AND g.slug <> $1 ORDER BY s.seen_at DESC LIMIT 1`,
    [slug],
  );
  return row?.slug ?? null;
}

export function createGuildRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const blizzardReady = () => isConfigured(db, getSource('blizzard').credential);
  const minMembersOf = () => getSetting(db, 'guilds.minMembers');

  // ---- Search: guilds and tracked characters by name, from what Everstats already has (no Blizzard request).
  r.get('/search', route(async (req, res) => {
    const q = String(req.query.q ?? '').normalize('NFC').trim().toLowerCase().slice(0, 60);
    if (q.length < 2) return res.json({ q, guilds: [], characters: [] });
    // 0.7.1 Activity: only the search PAGE counts (count=1), never the suggestions fetched while typing.
    if (req.query.count === '1' && !looksAutomated(limits, networkOf(req))) countActivity(db, 'search.page');
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const prefix = `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const guilds = await db.query(
      `SELECT g.slug, g.name, g.faction, rs.name AS ruleset,
              (SELECT members FROM guild_populations p WHERE p.guild_id = g.id AND p.period = 'overall' AND p.period_start = $3) AS tracked
         FROM guilds g LEFT JOIN rulesets rs ON rs.id = g.ruleset_id
        WHERE lower(g.name) LIKE $1
        ORDER BY (lower(g.name) LIKE $2) DESC, tracked DESC NULLS LAST, g.name LIMIT 8`,
      [like, prefix, OVERALL_START],
    );
    const characters = await db.query(
      `SELECT c.id, c.slug, c.name, c.surname, c.level, c.class, rs.name AS ruleset FROM characters c LEFT JOIN rulesets rs ON rs.id = c.ruleset_id
        WHERE c.slug IS NOT NULL AND NOT c.hidden AND c.profile_state = 'ok' AND c.missing_since IS NULL
          AND lower(c.name || ' ' || c.surname) LIKE $1
        ORDER BY (lower(c.name) LIKE $2) DESC, c.level DESC NULLS LAST, c.id LIMIT 8`,
      [like, prefix],
    );
    const letters = await lettersFor(db, characters.map((c) => c.id));
    res.json({
      q,
      guilds: guilds.map((g) => ({ slug: g.slug, name: g.name, faction: g.faction, ruleset: g.ruleset, tracked: g.tracked ?? 0 })),
      characters: characters.map((c) => ({ slug: c.slug, name: c.name, surname: c.surname, level: c.level, class: c.class, ruleset: c.ruleset, tier: letters.get(Number(c.id)) ?? null })),
    });
  }));

  // ---- /guilds: the largest guilds by tracked members on a ruleset.
  r.get('/guilds', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    const asked = req.query.ruleset !== undefined ? Number(req.query.ruleset) : null;
    const ruleset = rulesets.find((x) => x.id === asked) ?? [...rulesets].sort((a, b) => b.tracked - a.tracked)[0] ?? null;
    const minMembers = await minMembersOf();
    if (!ruleset) return res.json({ rulesets, ruleset: null, guilds: [], known: 0, minMembers });
    const rows = await db.query(
      `SELECT g.id, g.slug, g.name, g.faction, g.roster_members, p.members, p.computed_at
         FROM guild_populations p JOIN guilds g ON g.id = p.guild_id
        WHERE p.period = 'overall' AND p.period_start = $2 AND p.ruleset_id = $1
        ORDER BY p.members DESC, g.name LIMIT 50`,
      [ruleset.id, OVERALL_START],
    );
    const known = (await db.one('SELECT count(*)::int AS n FROM guilds WHERE ruleset_id = $1', [ruleset.id])).n;
    const inline = await guildInlineBadges(db, rows.map((g) => g.id));
    res.json({
      rulesets, ruleset, minMembers, known,
      guilds: rows.map((g) => ({
        slug: g.slug, name: g.name, faction: g.faction, tracked: g.members, rosterMembers: g.roster_members, ranked: g.members >= minMembers,
        badge: inline.get(Number(g.id))?.badge ?? null, verified: inline.get(Number(g.id))?.verified ?? false,
      })),
      computedAt: rows.reduce((m, g) => (!m || g.computed_at < m ? g.computed_at : m), null),
    });
  }));

  // ---- A guild page. Unknown slug: an old address redirects; otherwise one look-up at Blizzard (rate-limited).
  r.get('/guilds/:slug', route(async (req, res) => {
    const slug = parseGuildSlug(req.params.slug);
    if (!slug) throw new HttpError(400, 'That isn’t a guild address.', 'invalid');
    let g = await guildBySlug(db, slug);
    if (!g) {
      const moved = await movedTo(db, slug);
      if (moved) return res.json({ status: 'moved', slug: moved });
    }
    let notice = null;
    // 0.7.1 Activity: a view, and whether it came from a guild search; not counted from a network the look-up limiter
    // is already refusing (treated as automated).
    const net = networkOf(req);
    if (!looksAutomated(limits, net)) {
      countActivity(db, 'guild.view');
      if (req.query.via === 'search') countActivity(db, 'guild.search');
    }
    // Never fetched from Blizzard (unknown, or only seen on a member's profile): ask now, a person is waiting.
    if (!g?.profile_fetched_at && g?.profile_state !== 'not_found') {
      if (!(await blizzardReady())) notice = 'not_configured';
      else if (!limits.lookups.take(net)) notice = 'rate_limited';
      else {
        countActivity(db, 'guild.lookup');
        const item = await enqueue(db, { kind: 'guild', key: slug, priority: PRIORITY.lookup });
        const done = await waitFor(db, item.id, { timeoutMs: GUILD_WAIT_MS });
        notice = !done ? 'slow' : done.state === 'failed' ? 'unavailable' : null;
        g = await guildBySlug(db, slug);
        if (!g) {
          const moved = await movedTo(db, slug);
          if (moved) return res.json({ status: 'moved', slug: moved });
        }
      }
    }
    if (!g) {
      if (notice === 'rate_limited') {
        const { retryAfterMs } = limits.lookups.check(networkOf(req));
        res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
        return res.status(429).json({ error: 'Too many look-ups from your network. Wait a little and try again.', code: 'rate_limited', retryAfterMs });
      }
      if (notice) return res.json({ status: 'unavailable', reason: notice, slug });
      return res.json({ status: 'not_found', slug });
    }
    if (g.profile_state === 'not_found' && !g.profile_fetched_at) {
      return res.json({ status: 'not_found', slug, known: { name: g.name } });
    }
    // 0.7.1: the viewer's role here (Guild Master, officer or none), so the page offers Manage badges only to them.
    const viewer = req.session?.stage === 'full' ? req.session.accountId : null;
    res.json({ status: 'ok', notice, viewerRole: viewer ? await guildRole(db, g.id, viewer) : null, ...(await guildView(db, g)) });
  }));

  // ---- The guild's top members per statistic, in a period (top TOP_PER_STAT each).
  r.get('/guilds/:slug/top', route(async (req, res) => {
    const g = await existingGuild(db, req.params.slug);
    const period = periodOf(req.query.period);
    const periods = await periodsInfo(db);
    const { statistics, categories } = await loadCatalog(db);
    if (period !== 'overall' && !periods[period].open) return res.json({ period, periods, collecting: true, categories: [] });
    const rows = g.ruleset_id === null ? [] : await memberValues(db, g, period, { topN: TOP_PER_STAT });
    const byStat = new Map();
    for (const row of rows) {
      if (!byStat.has(row.statistic_id)) byStat.set(row.statistic_id, []);
      byStat.get(row.statistic_id).push(row);
    }
    const members = await trackedCount(db, g, period);
    res.json({
      period, periods, collecting: false, members,
      categories: categories.map((c) => ({
        label: c.label, key: categoryKey(c.label), farmable: c.farmable, graded: c.graded,
        statistics: c.statisticIds.map((id) => {
          const s = statistics.get(id);
          const list = byStat.get(id) ?? [];
          return { id, name: s.name, named: s.named, withAny: list[0]?.with_any ?? 0, top: list.map(memberRow) };
        }),
      })),
    });
  }));

  // ---- A guild-only board: every ranked member of the guild on one statistic, in a period.
  r.get('/guilds/:slug/boards/:statistic', route(async (req, res) => {
    const g = await existingGuild(db, req.params.slug);
    const statisticId = intParam(req.params.statistic);
    const period = periodOf(req.query.period);
    const { statistics } = await loadCatalog(db);
    const s = statistics.get(statisticId);
    if (!s) throw new HttpError(404, 'Everstats has no such statistic.', 'no_board');
    const periods = await periodsInfo(db);
    const head = {
      guild: await headOf(db, g),
      statistic: { id: s.id, name: s.name, category: s.category, categoryKey: categoryKey(s.category), named: s.named, grading: s.grading },
      period, periods,
    };
    if (period !== 'overall' && !periods[period].open) return res.json({ ...head, collecting: true, rows: [], members: null });
    const rows = g.ruleset_id === null ? [] : await memberValues(db, g, period, { statisticId });
    const members = await trackedCount(db, g, period);
    res.json({ ...head, collecting: false, members, rows: rows.map(memberRow), atZero: Math.max(0, members - rows.length) });
  }));

  // ---- Guild boards index: every board of a ruleset with its top three guilds by total.
  r.get('/guild-boards', route(async (req, res) => {
    const rulesets = await rulesetList(db);
    const asked = req.query.ruleset !== undefined ? Number(req.query.ruleset) : null;
    const ruleset = rulesets.find((x) => x.id === asked) ?? [...rulesets].sort((a, b) => b.tracked - a.tracked)[0] ?? null;
    const minMembers = await minMembersOf();
    const periods = await periodsInfo(db);
    if (!ruleset) return res.json({ rulesets, ruleset: null, categories: [], periods, minMembers });
    const { statistics, categories } = await loadCatalog(db);
    const counts = await guildBoardCounts(db, { rulesetId: ruleset.id, minMembers });
    const tops = await guildTops(db, { statisticIds: [...statistics.keys()], rulesetId: ruleset.id, minMembers });
    const guilds = await guildsById(db, [...new Set(tops.map((t) => t.guild_id))]);
    const pop = await db.one(
      `SELECT count(*) FILTER (WHERE members >= $3)::int AS ranked, count(*)::int AS any, max(computed_at) AS newest, min(computed_at) AS oldest
         FROM guild_populations WHERE period = 'overall' AND period_start = $2 AND ruleset_id = $1`,
      [ruleset.id, OVERALL_START, minMembers],
    );
    const byStat = new Map();
    for (const t of tops) {
      if (!byStat.has(t.statistic_id)) byStat.set(t.statistic_id, []);
      byStat.get(t.statistic_id).push(t);
    }
    res.json({
      rulesets, ruleset, periods, minMembers,
      rankedGuilds: pop.ranked, guildsWithMembers: pop.any, computed: { newest: pop.newest, oldest: pop.oldest },
      categories: categories.map((c) => ({
        label: c.label, key: categoryKey(c.label), farmable: c.farmable, graded: c.graded,
        boards: c.statisticIds.map((id) => {
          const list = byStat.get(id) ?? [];
          const bc = counts.get(id);
          return {
            id, name: statistics.get(id).name, named: statistics.get(id).named, ranked: bc?.ranked ?? 0, notYet: bc?.notYet ?? 0, tied: guildsTied(bc),
            top: list.map((t) => ({ rank: list.findIndex((x) => x.total === t.total) + 1, value: t.total, members: t.members, ...guilds.get(t.guild_id) })),
          };
        }),
      })),
    });
  }));

  // ---- One guild board: a statistic on a ruleset, by total or average, in a period.
  r.get('/guild-boards/:ruleset/:statistic', route(async (req, res) => {
    const rulesetId = intParam(req.params.ruleset);
    const statisticId = intParam(req.params.statistic);
    const period = periodOf(req.query.period);
    const mode = modeOf(req.query.mode);
    const { statistics } = await loadCatalog(db);
    const stat = statistics.get(statisticId);
    const rulesets = await rulesetList(db);
    const ruleset = rulesets.find((x) => x.id === rulesetId);
    if (!stat || !ruleset) throw new HttpError(404, 'Everstats has no such board.', 'no_board');
    const minMembers = await minMembersOf();
    const periods = await periodsInfo(db);
    const head = {
      statistic: { id: stat.id, name: stat.name, category: stat.category, categoryKey: categoryKey(stat.category), grading: stat.grading, named: stat.named, farmable: stat.farmable },
      ruleset, rulesets, period, mode, periods, minMembers,
    };
    if (period !== 'overall' && !periods[period].open) return res.json({ ...head, collecting: true, rows: [], next: null, notYet: [] });
    const counts = await guildStatCounts(db, { statisticId, rulesetId, period, mode, minMembers });
    const tied = guildsTied(counts);
    const page = tied ? { rows: [], next: null } : await guildBoardPage(db, { statisticId, rulesetId, period, mode, minMembers, cursor: req.query.cursor, limit: req.query.limit });
    const notYet = req.query.cursor ? [] : await guildsNotYetRanked(db, { statisticId, rulesetId, period, minMembers });
    const guilds = await guildsById(db, [...page.rows.map((x) => x.guildId), ...notYet.map((x) => x.guild_id)]);
    const fresh = await db.one(
      'SELECT min(computed_at) AS oldest, max(computed_at) AS newest FROM guild_populations WHERE period = $1 AND period_start = $2 AND ruleset_id = $3',
      [period, guildPeriodStart(period), rulesetId],
    );
    res.json({
      ...head,
      collecting: false,
      ranked: counts.ranked,
      population: counts.population,
      tied,
      tiedValue: tied ? counts.max : null,
      // Ranked guilds with nothing in this statistic (total 0): not ranked, and not rows.
      atZero: Math.max(0, counts.population - counts.ranked),
      rows: page.rows.map((x) => ({ rank: x.rank, value: x.value, total: x.total, average: x.average, members: x.members, ...guilds.get(x.guildId) })),
      next: page.next,
      notYet: notYet.map((x) => ({ members: x.members, total: x.total, average: x.average, ...guilds.get(x.guild_id) })),
      notYetCount: counts.notYet,
      computed: fresh,
    });
  }));

  return r;
}

/** A known guild for the sub-pages (no Blizzard request: the page itself does the look-up). */
async function existingGuild(db, raw) {
  const slug = parseGuildSlug(raw);
  if (!slug) throw new HttpError(404, 'Not found');
  const g = await guildBySlug(db, slug);
  if (!g) throw new HttpError(404, 'Everstats doesn’t know this guild yet.', 'no_guild');
  return g;
}

async function headOf(db, g) {
  const rs = g.ruleset_id !== null ? await db.one('SELECT id, name FROM rulesets WHERE id = $1', [g.ruleset_id]) : null;
  return { id: g.id, slug: g.slug, name: g.name, faction: g.faction, ruleset: rs };
}

/** Tracked current members, for a period's member count: all of them (overall) or those with a baseline in it. */
async function trackedCount(db, g, period) {
  if (g.ruleset_id === null) return 0;
  if (period === 'overall') return (await db.one(`SELECT count(*)::int AS n FROM characters c WHERE ${TRACKED_MEMBER}`, [g.id, g.ruleset_id])).n;
  const start = period === 'week' ? periodStart('week') : ROLLING_START;
  return (await db.one(
    `SELECT count(*)::int AS n FROM characters c JOIN period_baselines b ON b.character_id = c.id AND b.period = $3 AND b.period_start = $4 WHERE ${TRACKED_MEMBER}`,
    [g.id, g.ruleset_id, period, start],
  )).n;
}

/**
 * Members' values (overall) or gains (week, rolling) above zero, ranked within the guild (ties share: 1 + members
 * strictly above). One statistic (`statisticId`), or every statistic cut to its top `topN`.
 */
async function memberValues(db, g, period, { statisticId = null, topN = null }) {
  const src = period === 'overall'
    ? { from: 'character_statistics v', col: 'v.value', text: 'v.text', extra: '' }
    : { from: 'stat_gains v', col: 'v.gain', text: 'NULL::text', extra: 'AND v.period = $5 AND v.period_start = $6' };
  const args = [g.id, g.ruleset_id, statisticId, topN ?? MAX_ROSTER];
  if (period !== 'overall') args.push(period, period === 'week' ? periodStart('week') : ROLLING_START);
  return db.query(
    `SELECT * FROM (
       SELECT v.statistic_id, c.id AS character_id, c.slug, c.name, c.surname, c.level, c.class, c.race, ${src.col} AS value, ${src.text} AS text,
              rank() OVER (PARTITION BY v.statistic_id ORDER BY ${src.col} DESC) AS rank,
              row_number() OVER (PARTITION BY v.statistic_id ORDER BY ${src.col} DESC, c.id) AS rn,
              count(*) OVER (PARTITION BY v.statistic_id)::int AS with_any
         FROM characters c JOIN ${src.from} ON v.character_id = c.id
        WHERE ${TRACKED_MEMBER} AND v.ruleset_id = $2 AND NOT v.hidden AND ${src.col} > 0 ${src.extra}
          AND ($3::bigint IS NULL OR v.statistic_id = $3)
     ) t WHERE rn <= $4 ORDER BY statistic_id, rn LIMIT 50000`,
    args,
  );
}

const memberRow = (r) => ({
  rank: Number(r.rank), value: r.value, text: r.text ?? null, slug: r.slug, name: r.name, surname: r.surname, level: r.level, class: r.class, race: r.race,
});

/** Everything the guild page shows, from stored data only. */
export async function guildView(db, g) {
  const minMembers = await getSetting(db, 'guilds.minMembers');
  const head = await headOf(db, g);
  const members = g.ruleset_id === null ? [] : await db.query(
    `SELECT c.id, c.slug, c.name, c.surname, c.level, c.class, c.race, c.last_login_at, c.stats_fetched_at, gr.rank,
            CASE WHEN a.username_claimed AND NOT everstats_banned(a.id) THEN a.username END AS claimed_by,
            CASE WHEN a.username_claimed AND NOT everstats_banned(a.id) THEN a.id END AS claimed_account
       FROM characters c LEFT JOIN guild_roster gr ON gr.guild_id = c.guild_id AND gr.character_id = c.id
       LEFT JOIN accounts a ON a.id = c.owner_account_id
      WHERE ${TRACKED_MEMBER} ORDER BY gr.rank NULLS LAST, c.level DESC NULLS LAST, c.name LIMIT $3`,
    [g.id, g.ruleset_id, MAX_ROSTER],
  );
  const trackedIds = members.map((m) => m.id);
  const letters = await lettersFor(db, trackedIds);
  // 0.7.0: "Claimed by @username" + that player's one inline badge, as on character pages (hidden characters are
  // never members here, so a claim is never shown for one).
  const inline = await inlineBadges(db, members.map((m) => m.claimed_account).filter(Boolean));
  const roster = await db.one(
    `SELECT count(*)::int AS listed, count(*) FILTER (WHERE level < 10)::int AS under_ten,
            count(*) FILTER (WHERE (level IS NULL OR level >= 10) AND NOT (character_id = ANY($2::bigint[])))::int AS others,
            max(fetched_at) AS fetched_at
       FROM guild_roster WHERE guild_id = $1`,
    [g.id, trackedIds],
  );
  const hasRoster = roster.listed > 0;

  // Totals of the default pin statistics (matched by name against the live catalog, like the dashboard's pins).
  const { statistics } = await loadCatalog(db);
  const pinIds = await defaultPinIds(db);
  const totals = pinIds.length ? await db.query(
    `SELECT statistic_id, total, average FROM guild_totals WHERE guild_id = $1 AND period = 'overall' AND period_start = $2 AND statistic_id = ANY($3::bigint[])`,
    [g.id, OVERALL_START, pinIds],
  ) : [];
  const totalBy = new Map(totals.map((t) => [t.statistic_id, t]));
  const built = Boolean(g.totals_built_at);

  // Placements: the guild's best ranks on the guild boards (overall), the better mode per statistic. 0.6.0: only boards
  // with at least guilds.minBoardGuilds ranked guilds ("#1 of 1" says nothing); placementsHeld says how many were left out.
  const minBoardGuilds = await getSetting(db, 'guilds.minBoardGuilds');
  let placements = null;
  let placementsHeld = 0;
  // 0.8.0: the best placement in each category (same boards, same rule), for the collapsed "Top members" headers.
  let bestByCategory = null;
  if (members.length >= minMembers && built && g.ruleset_id !== null) {
    const all = await guildPlacements(db, { guildId: g.id, rulesetId: g.ruleset_id, minMembers });
    const rows = all.filter((p) => p.ranked >= minBoardGuilds);
    placementsHeld = all.length - rows.length;
    const sorted = rows
      .map((p) => {
        const byAvg = p.rank_average < p.rank_total;
        return { statisticId: p.statistic_id, name: statistics.get(p.statistic_id)?.name ?? null, mode: byAvg ? 'average' : 'total', rank: byAvg ? p.rank_average : p.rank_total, of: p.ranked, value: byAvg ? p.average : p.total };
      })
      .filter((p) => p.name !== null)
      .sort((a, b) => a.rank - b.rank || b.of - a.of || a.name.localeCompare(b.name));
    placements = sorted.slice(0, 8);
    bestByCategory = {};
    for (const p of sorted) {
      const key = categoryKey(statistics.get(p.statisticId)?.category ?? '');
      if (key && !bestByCategory[key]) bestByCategory[key] = p;
    }
  }
  return {
    guild: {
      ...head,
      createdAt: g.created_at_blizzard,
      memberCount: g.member_count,
      profileFetchedAt: g.profile_fetched_at,
      rosterFetchedAt: roster.fetched_at ?? null,
      rosterCheckedAt: g.roster_checked_at,
      firstSeenAt: g.first_seen_at,
    },
    counts: {
      // Blizzard's roster size (null until a roster has been fetched); tracked = the members listed below.
      roster: hasRoster ? roster.listed : null,
      tracked: members.length,
      underTen: hasRoster ? roster.under_ten : null,
      notTracked: hasRoster ? roster.others : null,
    },
    minMembers,
    ranked: members.length >= minMembers,
    totals: {
      built,
      computedAt: g.totals_built_at,
      cards: pinIds.map((id) => ({ id, name: statistics.get(id)?.name ?? null, total: totalBy.get(id)?.total ?? 0, average: totalBy.get(id)?.average ?? 0 })).filter((c) => c.name !== null),
    },
    placements,
    placementsHeld,
    bestByCategory,
    minBoardGuilds,
    // 0.6.0: the tracked members by overall letter (Unranked included), and each member's letter on the roster.
    tiers: await guildTierDistribution(db, g),
    roster: members.map((m) => ({
      tier: letters.get(Number(m.id)) ?? null,
      slug: m.slug, name: m.name, surname: m.surname, level: m.level, class: m.class, race: m.race, lastLoginAt: m.last_login_at,
      rank: m.rank ?? null, rankName: rankName(m.rank), fetchedAt: m.stats_fetched_at,
      claimedBy: m.claimed_by ? { username: m.claimed_by, badge: inline.get(Number(m.claimed_account)) ?? null } : null,
    })),
    // 0.7.0: the guild's own Links area (description, Discord invite, links), written by its Guild Master or officers.
    // null when nothing is set, so the page shows no empty box.
    links: await guildLinksView(db, g.id),
    // 0.7.1: guild badges (the row, the Verified mark, Next unlocks with live progress); `automatic` when nobody on
    // Everstats manages this guild (its badges are shown by the defaults, and the page says how to claim it).
    badges: await guildBadgesView(db, g),
  };
}
