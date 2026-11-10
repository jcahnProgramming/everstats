import express from 'express';
import { getSetting } from '../admin/settings.js';
import { betaState } from '../beta.js';
import { PRIMARY_SCOPE, config, scopeSql } from '../core/config.js';
import { HttpError, route } from '../core/errors.js';
import { isConfigured } from '../credentials/store.js';
import { PRIORITY, enqueue, waitFor } from '../crawler/queue.js';
import { getSource } from '../sources/registry.js';
import { BOARD_PERIODS, boardCounts, boardPage, everyoneTied, populationOf, rankOn, statCounts } from '../stats/boards.js';
import { categoryKey, loadCatalog } from '../stats/catalog.js';
import { nextPeriodStart, periodOpen, periodStart, rollingOpen } from '../stats/periods.js';
import { retentionPolicy } from '../retention/policy.js';
import { parseSlug } from '../stats/slug.js';
import { characterStatistics, characterView, hiddenRenders } from './view.js';
import { resolveProfileName } from '../accounts/usernames.js';
import { PLATFORMS, getPlatform, linkFor } from '../accounts/socials.js';
import { pinCards, pinsOf } from '../stats/pins.js';
import { lettersFor } from '../tiers/store.js';
import { characterTierView, tierBrief } from '../tiers/view.js';
import { badgeContext, publicBadgesOf } from '../badges/store.js';
import { CREATOR_BADGE, creatorLines, verifiedHandles } from '../badges/creators.js';
import { renderSwitch } from './renders.js';
import { boardSharing } from '../collections/view.js';
import { COLLECTIONS_CATEGORY } from '../collections/registry.js';
import { countActivity, looksAutomated } from '../activity/count.js';
import { whySignIn } from '../signin/benefits.js';
import { PROVIDERS } from '../auth/providers.js';

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

export async function rulesetList(db) {
  const rows = await db.query(
    `SELECT r.id, r.name, r.listed, (SELECT count(*)::int FROM characters c WHERE c.ruleset_id = r.id AND c.stats_fetched_at IS NOT NULL AND NOT c.hidden) AS tracked
       FROM rulesets r ORDER BY r.listed DESC, r.id LIMIT 50`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, listed: r.listed, tracked: r.tracked }));
}

export async function periodsInfo(db, now = Date.now) {
  const fact = await db.one("SELECT at FROM pipeline_facts WHERE key = 'first_snapshot_at'");
  const out = {};
  const w = periodOpen('week', fact?.at ?? null, now());
  out.week = { open: w.open, opensAt: w.opensAt, start: periodStart('week', now()).toISOString(), endsAt: nextPeriodStart('week', now()).toISOString() };
  // The rolling window: "Last N days", N from the retention policy (29 for Blizzard's 30-day rule since 0.5.0), never hardcoded.
  const { keepDays, windowDays } = await retentionPolicy(db, now());
  const r = rollingOpen(fact?.at ?? null, keepDays, now());
  out.rolling = { open: r.open, opensAt: r.opensAt, days: keepDays, windowDays };
  return { firstSnapshotAt: fact?.at ?? null, ...out };
}

async function charactersById(db, ids) {
  if (!ids.length) return new Map();
  const rows = await db.query(
    `SELECT c.id, c.slug, c.name, c.surname, c.level, c.race, c.class, c.faction, g.name AS guild, g.slug AS guild_slug
       FROM characters c LEFT JOIN guilds g ON g.id = c.guild_id WHERE c.id = ANY($1::bigint[]) LIMIT $2`,
    // 0.9.2: bounded by the ids asked for. A fixed LIMIT 200 cut the leaderboards index's top-3 lookups (hundreds of
    // boards × 3) at an arbitrary 200 characters, and everyone past it showed as a blank row.
    [ids, ids.length],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
const rowView = (r, c, viewer) => ({
  rank: r.rank, value: r.value, text: r.text ?? null,
  slug: c?.slug ?? null, name: c?.name ?? '', surname: c?.surname ?? '', level: c?.level ?? null, race: c?.race ?? null,
  class: c?.class ?? null, faction: c?.faction ?? null, guild: c?.guild ?? null, guildSlug: c?.guild_slug ?? null, mine: Boolean(viewer && c && viewer.has(c.id)),
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
      tierShares: await getSetting(db, 'tiers.shares'),
      // 0.8.1: how many days of Blizzard data Everstats keeps (the retention window minus a day): the home page's
      // "Daily snapshots" pillar says it, from here, never typed in.
      keepDays: (await retentionPolicy(db)).keepDays,
    });
  }));

  // 0.8.0: the home page's "Why sign in?" for signed-out visitors: the live benefits (signin/benefits.js, the one place
  // their wording lives) and the real tracked counts.
  r.get('/why-sign-in', route(async (req, res) => {
    const bnet = PROVIDERS.find((p) => p.id === 'battlenet');
    const battlenet = bnet ? await isConfigured(db, bnet.credential) : false;
    res.json(await whySignIn(db, { battlenet }));
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
        statistics: c.statisticIds.map((id) => ({ id, name: statistics.get(id).name, grading: statistics.get(id).grading, tierRole: statistics.get(id).tierRole ?? 'undecided' })),
      })),
    });
  }));

  // Icons that landed after the page loaded (the page asks again while any is pending). Up to 60 item ids: worn
  // items and their transmogs (0.8.0).
  r.get('/items/media', route(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map(Number).filter(Number.isSafeInteger).slice(0, 60);
    const rows = ids.length ? await db.query('SELECT item_id, state, icon_url FROM item_media WHERE game_version = $2 AND region = $3 AND item_id = ANY($1::bigint[])', [ids, PRIMARY_SCOPE.version, PRIMARY_SCOPE.region]) : [];
    res.json({ items: rows.map((r) => ({ itemId: r.item_id, iconState: r.state, icon: r.state === 'ok' ? r.icon_url : null })) });
  }));

  // ---- Public profiles: /u/{username}. Anyone can view one; a placeholder name has none, hidden characters never
  // appear. The page is a list of SECTIONS, so later ones (badges, pinned stats) are added without restructuring.
  r.get('/users/:username', route(async (req, res) => {
    const who = await resolveProfileName(db, req.params.username);
    if (who?.redirect) return res.json({ status: 'moved', username: who.redirect });
    if (!who?.account) {
      return res.status(404).json({ error: 'No such player.', code: who?.placeholder ? 'placeholder' : 'no_user' });
    }
    // 0.8.2: a banned account has no public profile while the ban lasts. The same neutral answer for everyone; it never
    // says why. (Its characters stay on their own pages and the boards, as Blizzard data.)
    if ((await db.one('SELECT everstats_banned($1) AS b', [who.account])).b) {
      return res.status(404).json({ error: 'This profile isn’t available.', code: 'unavailable' });
    }
    const a = await db.one(
      'SELECT id, created_at, username, display_name, beta_member, beta_since, featured_character_id, profile_bio, profile_show_pins FROM accounts WHERE id = $1',
      [who.account],
    );
    const chars = await db.query(
      `SELECT c.id, c.slug, c.name, c.surname, c.level, c.race, c.class, c.faction, c.media, c.media_state, c.last_fetched_at, c.hidden,
              r.id AS ruleset_id, r.name AS ruleset_name, g.name AS guild_name, g.slug AS guild_slug
         FROM characters c LEFT JOIN rulesets r ON r.id = c.ruleset_id LEFT JOIN guilds g ON g.id = c.guild_id
        WHERE c.owner_account_id = $1 AND NOT c.hidden AND c.profile_state = 'ok' AND c.stats_fetched_at IS NOT NULL AND c.missing_since IS NULL
        ORDER BY c.level DESC NULLS LAST, c.id LIMIT 50`,
      [a.id],
    );
    const letters = await lettersFor(db, chars.map((c) => c.id));
    const noRender = await hiddenRenders(db, chars.map((c) => Number(c.id)));
    const switched = await renderSwitch(db);
    const view = (c) => ({
      slug: c.slug, name: c.name, surname: c.surname, level: c.level, race: c.race, class: c.class, faction: c.faction,
      tier: letters.get(Number(c.id)) ?? null,
      ruleset: c.ruleset_id !== null ? { id: c.ruleset_id, name: c.ruleset_name } : null,
      // 0.7.1: a render its owner hid is never sent.
      render: !switched.paused && c.media_state === 'ok' && !noRender.has(Number(c.id)) ? c.media?.['main-raw'] ?? null : null,
      renderHidden: noRender.has(Number(c.id)), fetchedAt: c.last_fetched_at,
      // 0.8.1: the admin switched Blizzard renders off (characters/renders.js): no URL, the admin's note instead
      renderPaused: !noRender.has(Number(c.id)) && switched.paused ? switched.note : null,
    });
    const featured = chars.find((c) => c.id === a.featured_character_id) ?? chars[0] ?? null;
    const links = await db.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 ORDER BY platform LIMIT 20', [a.id]);
    // 0.8.1: handles Everstats verified (Verified Content Creator), still exactly on the profile, badge held.
    const verifiedNow = (await verifiedHandles(db, [a.id])).get(Number(a.id)) ?? new Map();
    // Guilds of the characters shown here (hidden characters are already left out, so their guilds never appear).
    const guilds = new Map();
    for (const c of chars) {
      if (!c.guild_slug) continue;
      if (!guilds.has(c.guild_slug)) guilds.set(c.guild_slug, { name: c.guild_name, slug: c.guild_slug, ruleset: c.ruleset_name, characters: [] });
      guilds.get(c.guild_slug).characters.push(`${c.name} ${c.surname}`);
    }
    const order = PLATFORMS.map((x) => x.id);
    // Sections, each drawn by its own view (client/src/pages/ProfilePage.jsx). An empty one is left out entirely.
    const sections = [];
    const about = {
      id: 'about',
      bio: a.profile_bio,
      links: links.filter((l) => getPlatform(l.platform)).sort((x, y) => order.indexOf(x.platform) - order.indexOf(y.platform))
        .map((l) => ({ platform: l.platform, label: getPlatform(l.platform).label, handle: l.handle, url: linkFor(l.platform, l.handle), verified: verifiedNow.get(l.platform) === l.handle })),
    };
    if (about.bio || about.links.length) sections.push(about);
    if (featured && a.profile_show_pins) {
      const { ids } = await pinsOf(db, a.id);
      const cards = await pinCards(db, ids, featured);
      if (cards.length) sections.push({ id: 'pins', character: { name: featured.name, surname: featured.surname, slug: featured.slug, ruleset: featured.ruleset_name, rulesetId: featured.ruleset_id }, cards, fetchedAt: featured.last_fetched_at });
    }
    if (featured) sections.push({ id: 'featured', character: { ...view(featured), tierBrief: await tierBrief(db, featured) } });
    const others = chars.filter((c) => c.id !== featured?.id).map(view);
    if (others.length) sections.push({ id: 'characters', characters: others });
    if (guilds.size) sections.push({ id: 'guilds', guilds: [...guilds.values()] });
    // 0.7.0: the badge row under the name. Only badges the player made public; none at all → no row (no empty box).
    const ctx = await badgeContext(db);
    const badges = await publicBadgesOf(db, a.id, ctx);
    const own = viewerOf(req) === a.id;
    const unseen = own ? new Set((await db.query("SELECT badge_id FROM badge_awards WHERE account_id = $1 AND state = 'held' AND seen_at IS NULL LIMIT 500", [a.id])).map((x) => x.badge_id)) : new Set();
    const lines = badges.featured.concat(badges.more).some((b) => b.id === CREATOR_BADGE) ? await creatorLines(db, a.id) : [];
    const mark = (b) => ({ ...b, isNew: unseen.has(b.id), ...(b.id === CREATOR_BADGE ? { creator: lines } : {}) });
    res.json({
      badges: badges.featured.length || badges.more.length ? { featured: badges.featured.map(mark), more: badges.more.map(mark), own } : null,
      status: 'ok',
      profile: {
        username: a.username,
        displayName: a.display_name ?? a.username,
        beta: a.beta_member ? { since: a.beta_since } : null,
        joinedAt: a.created_at,
        // From the featured character: Blizzard data, so it follows the retention rules with it.
        main: featured ? { ruleset: featured.ruleset_name, faction: featured.faction } : null,
      },
      sections,
    });
  }));

  // ---- Character lookup
  r.get('/characters/:slug', route(async (req, res) => {
    const parsed = parseSlug(req.params.slug);
    if (!parsed) throw new HttpError(400, 'That isn’t a character name and surname.', 'invalid');
    const viewer = viewerOf(req);
    let row = await db.one(`SELECT * FROM characters WHERE slug = $1 AND ${scopeSql()}`, [parsed.slug]);
    const mine = () => Boolean(viewer && row && row.owner_account_id === viewer);
    if (row?.hidden && !mine()) return res.json({ status: 'hidden', slug: parsed.slug });

    let notice = null;
    const fresh = row?.profile_state === 'ok' && row.last_fetched_at && Date.now() - new Date(row.last_fetched_at).getTime() < LOOKUP_FRESH_MS;
    // 0.7.1 Activity: a search (the search box or the home form says via=search) counts every time; a page opened any
    // other way counts only when it asks Blizzard (below). Not counted from a network the limiter is refusing.
    const fromSearch = req.query.via === 'search';
    if (fromSearch && !looksAutomated(limits, networkOf(req))) countActivity(db, 'character.search');
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
        if (!fromSearch) countActivity(db, 'character.lookup');
        const item = await enqueue(db, { key: parsed.slug, priority: PRIORITY.lookup, mode: 'full', accountId: viewer });
        const done = await waitFor(db, item.id, { timeoutMs: LOOKUP_WAIT_MS });
        if (!done) notice = 'slow';
        else if (done.state === 'failed') notice = 'unavailable';
        row = await db.one(`SELECT * FROM characters WHERE slug = $1 AND ${scopeSql()}`, [parsed.slug]);
        if (row?.hidden && !mine()) return res.json({ status: 'hidden', slug: parsed.slug });
      }
    }
    // Blizzard stopped returning it: say so, with the date, and show none of its old values as current.
    if (row?.profile_state === 'ok' && row.missing_since) {
      return res.json({ status: 'missing', slug: parsed.slug, name: row.name, surname: row.surname, since: row.data_fetched_at, mine: mine() });
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
      // 0.6.0: the overall tier, every category's, and what fed each letter (null for a hidden character).
      tiers: await characterTierView(db, row),
      // 0.9.2: how many days of daily snapshots Everstats keeps (the Progress section says it; retention/policy.js).
      keepDays: (await retentionPolicy(db)).keepDays,
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
        label: c.label, key: categoryKey(c.label), farmable: c.farmable, graded: c.graded, tierCounted: c.tierCounted ?? 0, inOverall: Boolean(c.inOverall),
        // 0.9.1: the Collections group also holds the gold boards (opt-in only; their own API).
        extra: c.label === COLLECTIONS_CATEGORY ? 'gold' : null,
        boards: c.statisticIds.map((id) => {
          const s = statistics.get(id);
          const list = byStat.get(id) ?? [];
          const bc = counts.byStat.get(id);
          const top = list.map((t) => ({ ...t, rank: list.findIndex((x) => x.value === t.value) + 1 }));
          return {
            id, name: s.name, named: s.named, grading: s.grading, nonzero: bc?.nonzero ?? 0,
            tied: everyoneTied(bc),
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
    // 'month' was the 0.4.0–0.4.1 name of the rolling window: old links still land on it.
    const asked = req.query.period === 'month' ? 'rolling' : req.query.period;
    const period = BOARD_PERIODS.includes(asked) ? asked : 'overall';
    const { statistics } = await loadCatalog(db);
    const stat = statistics.get(statisticId);
    const rulesets = await rulesetList(db);
    const ruleset = rulesets.find((x) => x.id === rulesetId);
    if (!stat || !ruleset) throw new HttpError(404, 'Everstats has no such board.', 'no_board');
    const periods = await periodsInfo(db);
    const head = {
      statistic: { id: stat.id, name: stat.name, category: stat.category, categoryKey: categoryKey(stat.category), grading: stat.grading, named: stat.named, valueType: stat.valueType, farmable: stat.farmable, tierRole: stat.tierRole ?? 'undecided', countsOverall: Boolean(stat.countsOverall) },
      ruleset, rulesets, period, periods,
      // 0.9.0: a count Everstats makes from collections: where it comes from and what's known about it being shared.
      collection: stat.derived ? await boardSharing(db, stat.id) : null,
    };
    if (period !== 'overall' && !periods[period].open) return res.json({ ...head, collecting: true, rows: [], next: null });

    const bc = await statCounts(db, { statisticId, rulesetId, period });
    const counts = { population: bc.population };
    const tied = everyoneTied(bc);
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
      mine.push({ slug: o.slug, name: o.name, surname: o.surname, hidden: false, rank: rk.rank, value: rk.value, withAny: rk.withAny });
    }
    res.json({
      ...head,
      collecting: false,
      population: counts.population,
      nonzero: bc.nonzero,
      tied,
      tiedValue: tied ? bc.max : null,
      // Tracked characters at zero: not ranked, and not rows.
      atZero: Math.max(0, counts.population - bc.nonzero),
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
