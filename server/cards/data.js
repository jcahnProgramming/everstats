import { config } from '../core/config.js';
import { characterKey, findCharacter, findGuild, guildKey } from '../characters/find.js';
import { getSetting } from '../admin/settings.js';
import { pathSlug, scopePrefix } from '../core/scope.js';
import { BOARD_SOURCES, boardPage, rankOn, characterRanks, boardCounts, ranksFor } from '../stats/boards.js';
import { guildBoardPage, guildRanksFor, guildPeriodStart } from '../stats/guildBoards.js';
import { loadCatalog } from '../stats/catalog.js';
import { pinsOf } from '../stats/pins.js';
import { periodsInfo } from '../characters/routes.js';
import { characterView } from '../characters/view.js';
import { characterTierView, guildTierDistribution } from '../tiers/view.js';
import { guildView } from '../guilds/routes.js';
import { guildLinksView } from '../guilds/manage.js';
import { guildBadgesView } from '../guildBadges/view.js';
import { TIER_LETTERS, tierBarParts } from '../stats/tiers.js';
import { periodStart } from '../stats/periods.js';
import { BOARD_PERIODS, statsShown } from './catalog.js';
import { guildBadgeSvg, playerBadgeSvg } from './badgeSvg.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Share-card data (0.8.0): CARD_DATA for each card type, from the SAME sources as the pages (characterView,
 * characterTierView, guildView, the boards), never the template's examples. Honesty rules:
 *   - every number is real and dated ("as of" = when Blizzard's data behind it was fetched);
 *   - a statistic with no real value (zero, or a name that aged out) can't go on a card ("Not enough data yet");
 *   - labels come from live data: the board period ("Last 29 days" from the retention keep-days), the categories
 *     (as many as are graded today), units (none: Blizzard sends none, so none is invented);
 *   - hidden characters produce no card; a render its owner hid is never sent (the crest version instead);
 *   - the guild's Discord invite only if its Guild Master or officers set one.
 *
 * Each builder returns { status: 'ok', data, template subject, dataAt, characterIds, guildIds, title, description,
 * page } or { status: 'not_found' | 'hidden' | 'unavailable', reason }. Images in `data` are still Blizzard URLs here;
 * the caller turns them into data: URIs (images.js) only when it really renders.
 */
const host = () => new URL(config.publicOrigin).host;
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const asOf = (at) => (at ? dateFmt.format(new Date(at)) : 'unknown');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '–');
const oldest = (...dates) => {
  const t = dates.filter(Boolean).map((d) => new Date(d).getTime()).filter(Number.isFinite);
  return t.length ? new Date(Math.min(...t)) : new Date();
};
const lower = (l) => (l ? String(l).toLowerCase() : 'u');
const CREST = (() => {
  try {
    return readFileSync(resolve(import.meta.dirname, 'kit/v1/assets/illustrations/guild-crest-placeholder.svg'), 'utf8')
      .replace(/<\?xml[^>]*\?>/g, '').trim();
  } catch {
    return '';
  }
})();

/** Top N% from a rank among `of` (rounded up: never flatters). */
export const topPercent = (rank, of) => (rank && of ? Math.max(1, Math.ceil((rank / of) * 100)) : null);

async function characterBySlug(db, slug) {
  const parsed = characterKey(slug);
  if (!parsed) return { status: 'not_found' };
  const row = await findCharacter(db, parsed);
  if (!row) return { status: 'not_found' };
  if (row.hidden) return { status: 'hidden' };
  if (row.missing_since || row.profile_state !== 'ok') return { status: 'not_found' };
  if (!row.stats_fetched_at || row.ruleset_id === null) return { status: 'unavailable', reason: 'Everstats hasn’t fetched this character’s statistics yet.' };
  return { status: 'ok', row };
}

async function guildBySlug(db, slug) {
  const parsed = guildKey(slug);
  if (!parsed) return { status: 'not_found' };
  const g = await findGuild(db, parsed);
  return g ? { status: 'ok', g } : { status: 'not_found' };
}

const logoOfPlayerBadge = async (db, id) => (await db.one("SELECT png_256 FROM badge_logos WHERE badge_id = $1 AND stage = 'saved'", [id]))?.png_256 ?? null;
const markOfGuild = async (db, guildId) => (await db.one('SELECT mark FROM guild_partner_marks WHERE guild_id = $1 AND mark_sha IS NOT NULL', [guildId]))?.mark ?? null;

/** The slots in the order the character sheet shows them; shirt and tabard are left off the strip (no stats, cosmetic). */
const GEAR_ORDER = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED'];

/**
 * A character's statistics a card could show, best-ranked first: [{ id, name, value, text, rank, withAny, available }].
 * available: a real value above zero with a live name (else "Not enough data yet" in the maker).
 */
export async function characterStatChoices(db, row) {
  const { statistics } = await loadCatalog(db);
  const ranks = await characterRanks(db, row.id, row.ruleset_id);
  const counts = await boardCounts(db, row.ruleset_id);
  const out = [];
  for (const [id, r] of ranks) {
    const s = statistics.get(Number(id));
    if (!s?.name) continue;
    out.push({ id: Number(id), name: s.name, category: s.category, value: r.value, text: r.text, rank: r.rank, withAny: counts.byStat.get(Number(id))?.nonzero ?? null, available: r.value > 0 });
  }
  out.sort((a, b) => (a.rank ?? 1e12) / (a.withAny || 1) - (b.rank ?? 1e12) / (b.withAny || 1) || (a.rank ?? 1e12) - (b.rank ?? 1e12) || a.name.localeCompare(b.name));
  return out;
}

/** Default stats: the owner's pins that have a real value, else the best-placed ones (rank ÷ how many have any). */
export async function defaultStatIds(db, row, choices) {
  const byId = new Map(choices.map((c) => [c.id, c]));
  if (row.owner_account_id !== null) {
    const { ids } = await pinsOf(db, row.owner_account_id);
    const pinned = ids.map(Number).filter((id) => byId.get(id)?.available).slice(0, 6);
    if (pinned.length) return pinned;
  }
  return choices.filter((c) => c.available).slice(0, 6).map((c) => c.id);
}

async function overallTier(db, row) {
  const t = await db.one('SELECT letter, score FROM character_tiers WHERE character_id = $1', [row.id]);
  if (!t?.letter) return { letter: null };
  const r = await db.one(
    `SELECT count(*) FILTER (WHERE t.score > $2)::int + 1 AS rank, count(*)::int AS of FROM character_tiers t JOIN characters c ON c.id = t.character_id
      WHERE t.ruleset_id = $1 AND t.letter IS NOT NULL AND NOT c.hidden`,
    [row.ruleset_id, t.score],
  );
  return { letter: t.letter, rank: r.rank, of: r.of };
}

// ------------------------------------------------------------------------------------------------ character

export async function characterCard(db, { slug, options }) {
  const found = await characterBySlug(db, slug);
  if (found.status !== 'ok') return found;
  const row = found.row;
  const c = await characterView(db, row);
  const choices = await characterStatChoices(db, row);
  const byId = new Map(choices.map((x) => [x.id, x]));
  const wanted = (options.stats ?? await defaultStatIds(db, row, choices)).filter((id) => byId.get(id)?.available);
  const stats = wanted.slice(0, statsShown(options.format, options.layout)).map((id) => {
    const s = byId.get(id);
    return { label: s.text ? `${s.name} · ${s.text}` : s.name, value: num(s.value), rank: s.rank ? `#${num(s.rank)} · ${c.ruleset?.name ?? ''}` : 'Not ranked' };
  });
  if (!stats.length) return { status: 'unavailable', reason: 'This character has no statistic with a value above zero yet, and only real values go on a card.' };
  const tier = await overallTier(db, row);
  const badge = c.claimedBy?.badge ?? null;
  const badgeSvg = badge ? playerBadgeSvg(badge, { logo: badge.logo ? await logoOfPlayerBadge(db, badge.id) : null }) : null;
  const bySlot = new Map((c.equipment ?? []).map((i) => [i.slot, i]));
  const gear = GEAR_ORDER.map((s) => bySlot.get(s)).filter(Boolean).map((i) => {
    const look = options.gear === 'transmog' && i.transmog ? i.transmog : null;
    // Blizzard sends no quality for a transmog item: its frame stays neutral (no class), never a guessed colour.
    return { q: look ? 'q-tmog' : `q-${i.quality}`, icon: (look ? look.icon : i.icon) ?? null };
  });
  const renderAllowed = options.show.render && c.media.state === 'ok' && !c.renderHidden;
  const data = {
    theme: options.theme,
    accent: options.accent,
    url: `${host()}${scopePrefix()}/c/${pathSlug(row)}`,
    asof: asOf(row.stats_fetched_at),
    first: row.name,
    last: row.surname,
    initials: `${(row.name ?? '').slice(0, 1)}${(row.surname ?? '').slice(0, 1)}`.toUpperCase(),
    meta: [row.level !== null ? `Level ${row.level}` : null, row.race, row.class].filter(Boolean).join(' · '),
    faction: row.faction ?? '',
    ruleset: c.ruleset?.name ?? '',
    guild: c.guild?.name ?? '',
    render: renderAllowed ? c.media.render : null,
    tier: tier.letter ? { letter: tier.letter, cls: lower(tier.letter), pct: `Top ${topPercent(tier.rank, tier.of)}%` } : { letter: '–', cls: 'u', pct: 'Unranked' },
    badge: badgeSvg ? { svg: badgeSvg, name: badge.name } : { svg: '', name: '' },
    stats,
    gear,
    show: { tier: options.show.tier, badge: options.show.badge && Boolean(badgeSvg), guild: options.show.guild && Boolean(c.guild), gear: options.show.gear && gear.length > 0 },
  };
  return {
    status: 'ok',
    data,
    dataAt: oldest(row.stats_fetched_at, row.last_fetched_at, renderAllowed ? row.media_fetched_at : null),
    characterIds: [Number(row.id)],
    guildIds: [],
    title: `${row.name} ${row.surname}${data.meta ? ` · ${data.meta}` : ''}`,
    description: `${tier.letter ? `Tier ${tier.letter} (top ${topPercent(tier.rank, tier.of)}%)` : 'Unranked'} on ${data.ruleset}. Statistics, ranks and gear on Everstats, from Blizzard’s data as of ${data.asof}.`,
    page: `${scopePrefix()}/c/${pathSlug(row)}`,
    ownerAccountId: row.owner_account_id === null ? null : Number(row.owner_account_id),
    subjectKey: `c:${row.id}`,
  };
}

// ------------------------------------------------------------------------------------------------ tier

export async function tierCard(db, { slug, options }) {
  const found = await characterBySlug(db, slug);
  if (found.status !== 'ok') return found;
  const row = found.row;
  const t = await characterTierView(db, row);
  if (!t) return { status: 'hidden' };
  const rs = t.ruleset?.name ?? '';
  const graded = t.status === 'graded' && t.overall?.letter;
  let next = { show: false, text: '', sub: '', w: 0 };
  if (graded && t.overall.letter !== 'S') {
    const tr = await db.one('SELECT scopes, settings FROM tier_rulesets WHERE ruleset_id = $1', [row.ruleset_id]);
    const cut = tr?.scopes?.overall?.cutoffs ?? {};
    const i = TIER_LETTERS.indexOf(t.overall.letter);
    const up = TIER_LETTERS.slice(0, i).reverse().find((l) => Number.isFinite(cut[l]));
    if (up && Number.isFinite(cut[t.overall.letter])) {
      const gap = Math.max(0, cut[up] - t.overall.score);
      const band = cut[up] - cut[t.overall.letter];
      const shares = tr.settings?.shares ?? {};
      const topShare = TIER_LETTERS.slice(0, TIER_LETTERS.indexOf(up) + 1).reduce((n, l) => n + (shares[l] ?? 0), 0);
      next = {
        show: true,
        text: `${gap.toFixed(1)} score points to ${up}`,
        sub: `${up} = top ${topShare}% of ${rs} · score out of 100`,
        w: band > 0 ? Math.max(2, Math.min(100, Math.round(((t.overall.score - cut[t.overall.letter]) / band) * 100))) : 100,
      };
    }
  }
  const data = {
    theme: options.theme,
    accent: options.accent,
    url: `${host()}${scopePrefix()}/c/${pathSlug(row)}/tier`,
    asof: asOf(t.computedAt ?? t.gradedAt ?? row.stats_fetched_at),
    first: row.name,
    last: row.surname,
    meta: [row.level !== null ? `Level ${row.level}` : null, row.race, row.class].filter(Boolean).join(' · '),
    faction: row.faction ?? '',
    ruleset: rs,
    tier: graded ? { letter: t.overall.letter, cls: lower(t.overall.letter) } : { letter: '–', cls: 'u' },
    pct: graded ? `Top ${topPercent(t.overall.rank, t.overall.of)}% on ${rs}` : `Unranked on ${rs}`,
    next: { ...next, show: options.show.next && next.show },
    // The live categories (as many as are graded today), never the mockup's ten.
    cats: (t.categories ?? []).map((c) => ({ name: c.label, L: c.letter ?? '–', cls: lower(c.letter) })),
    show: { cats: options.show.cats && (t.categories ?? []).length > 0 },
  };
  return {
    status: 'ok',
    data,
    dataAt: oldest(row.stats_fetched_at, t.computedAt),
    characterIds: [Number(row.id)],
    guildIds: [],
    title: `${row.name} ${row.surname}: ${graded ? `tier ${t.overall.letter}` : 'Unranked'} on ${rs}`,
    description: graded
      ? `Overall tier ${t.overall.letter}, top ${topPercent(t.overall.rank, t.overall.of)}% of ${rs} on Everstats, with a letter for every category.`
      : `Not graded yet on ${rs}. ${t.reason?.text ?? t.overall?.reason?.text ?? ''}`.trim(),
    page: `${scopePrefix()}/c/${pathSlug(row)}`,
    ownerAccountId: row.owner_account_id === null ? null : Number(row.owner_account_id),
    subjectKey: `t:${row.id}`,
  };
}

// ------------------------------------------------------------------------------------------------ guild

export async function guildCard(db, { slug, options }) {
  const found = await guildBySlug(db, slug);
  if (found.status !== 'ok') return found;
  const g = found.g;
  const view = await guildView(db, g);
  const badges = await guildBadgesView(db, g);
  const shownBadges = [...(badges?.row ?? []), ...(badges?.more ?? [])];
  const chosen = options.badges ? options.badges.map((id) => shownBadges.find((b) => b.id === id)).filter(Boolean) : shownBadges;
  const mark = shownBadges.some((b) => b.template === 'partner-guild') ? await markOfGuild(db, g.id) : null;
  const badgeData = chosen.slice(0, 4).map((b, i) => ({
    svg: guildBadgeSvg(b, { mark: b.template === 'partner-guild' ? mark : null }) ?? '', name: b.name, lv: b.numeral ?? '', cls: i === 0 ? 'pinned' : '',
  })).filter((b) => b.svg);
  const { statistics } = await loadCatalog(db);
  const totalsBy = new Map((view.totals?.cards ?? []).map((t) => [t.id, t]));
  let totals = view.totals?.cards ?? [];
  if (options.totals) {
    const rows = await db.query(
      "SELECT statistic_id, total FROM guild_totals WHERE guild_id = $1 AND period = 'overall' AND period_start = $2 AND statistic_id = ANY($3::bigint[]) LIMIT 10",
      [g.id, guildPeriodStart('overall'), options.totals],
    );
    const by = new Map(rows.map((r) => [Number(r.statistic_id), r]));
    totals = options.totals.map((id) => ({ id, name: statistics.get(id)?.name ?? null, total: by.get(id)?.total ?? totalsBy.get(id)?.total ?? 0 })).filter((x) => x.name);
  }
  totals = totals.filter((t) => t.total > 0).slice(0, 4);
  const best = view.placements?.[0] ?? null;
  const dist = options.show.tierbar ? await guildTierDistribution(db, g) : null;
  // 0.9.0: ranked members only, each non-zero letter wide enough for "S 1"; Unranked is its own line under the bar
  // (cards-layout.js), never a segment and never folded into D.
  const bar = dist?.graded ? tierBarParts(dist.letters) : { ranked: 0, parts: [] };
  const tiers = bar.parts.map((p) => ({ k: p.letter.toLowerCase(), w: p.pct, t: `${p.letter} ${num(p.n)}` }));
  const unrankedN = dist?.graded ? dist.letters.unranked ?? 0 : 0;
  const tiersUnranked = tiers.length && unrankedN > 0 ? `${num(unrankedN)} unranked: below a tier minimum` : '';
  const links = await guildLinksView(db, g.id);
  const discord = links?.discord?.code ? `discord.gg/${links.discord.code}` : '';
  const rs = view.guild?.ruleset?.name ?? '';
  const data = {
    theme: options.theme,
    accent: options.accent,
    url: `${host()}${scopePrefix()}/g/${pathSlug(g)}`,
    asof: asOf(g.totals_built_at ?? g.profile_fetched_at ?? g.updated_at),
    name: g.name,
    faction: g.faction ?? '',
    ruleset: rs,
    members: `${num(view.counts?.tracked ?? 0)} tracked member${view.counts?.tracked === 1 ? '' : 's'}`,
    pinned_svg: badgeData[0]?.svg || CREST,
    badges: badgeData,
    totals: totals.map((t) => ({ label: t.name, value: num(t.total) })),
    place: best ? { rank: `#${num(best.rank)}`, stat: best.name, scope: `Guild board · ${best.mode} · ${rs} · Overall` } : null,
    tiers,
    tiers_unranked: tiersUnranked,
    discord,
    show: { recruiting: options.show.recruiting && Boolean(discord) },
  };
  return {
    status: 'ok',
    data,
    dataAt: oldest(g.totals_built_at, g.profile_fetched_at, g.updated_at),
    characterIds: [],
    guildIds: [Number(g.id)],
    title: `<${g.name}> on ${rs}`,
    description: `${data.members} on Everstats${best ? `, #${best.rank} on the ${best.name} guild board` : ''}. Roster, totals and guild boards from Blizzard’s data.`,
    page: `${scopePrefix()}/g/${pathSlug(g)}`,
    guildId: Number(g.id),
    subjectKey: `g:${g.id}`,
  };
}

// ------------------------------------------------------------------------------------------------ board

/** The period label from the live window ("Last 29 days" today), never the mockup's "Last 30 days". */
export async function periodLabel(db, period) {
  if (period === 'week') return 'This week';
  if (period === 'rolling') return `Last ${(await periodsInfo(db)).rolling.days} days`;
  return 'Overall';
}

/** Up to `n` rows strictly above and below a value on a character board (same predicates as the boards). */
async function characterNeighbours(db, { statisticId, rulesetId, period, value, characterId, n = 2 }) {
  const s = BOARD_SOURCES[period];
  const extra = period === 'overall' ? [] : [periodStart(period, Date.now())];
  const where = period === 'overall' ? '' : s.where.replace('$3', '$5');
  const above = await db.query(
    `SELECT character_id, ${s.col} AS value FROM ${s.table} WHERE statistic_id = $1 AND ruleset_id = $2 AND NOT hidden AND ${s.col} > 0 ${where}
       AND (${s.col} > $3 OR (${s.col} = $3 AND character_id < $4)) ORDER BY ${s.col} ASC, character_id DESC LIMIT ${n}`,
    [statisticId, rulesetId, value, characterId, ...extra],
  );
  const below = await db.query(
    `SELECT character_id, ${s.col} AS value FROM ${s.table} WHERE statistic_id = $1 AND ruleset_id = $2 AND NOT hidden AND ${s.col} > 0 ${where}
       AND (${s.col} < $3 OR (${s.col} = $3 AND character_id > $4)) ORDER BY ${s.col} DESC, character_id LIMIT ${n}`,
    [statisticId, rulesetId, value, characterId, ...extra],
  );
  return [...above.reverse(), { character_id: characterId, value }, ...below];
}

export async function boardCard(db, { rulesetId, statisticId, period, c: cSlug = null, g: gSlug = null, mode = 'total', options }) {
  if (!BOARD_PERIODS.includes(period)) return { status: 'not_found' };
  const rs = await db.one('SELECT id, name FROM rulesets WHERE id = $1', [rulesetId]);
  const { statistics } = await loadCatalog(db);
  const stat = statistics.get(statisticId);
  if (!rs || !stat?.name) return { status: 'not_found' };
  const label = await periodLabel(db, period);
  const scopeText = `${rs.name} · ${label}`;
  const fmt = (r) => `#${num(r)}`;
  const rankCls = (r) => (r <= 3 ? `r${r}` : 'rn');
  if (period !== 'overall' && !(await periodsInfo(db))[period]?.open) return { status: 'unavailable', reason: `The ${label.toLowerCase()} board is still collecting data.` };

  if (cSlug) {
    const found = await characterBySlug(db, cSlug);
    if (found.status !== 'ok') return found;
    const row = found.row;
    if (Number(row.ruleset_id) !== rulesetId) return { status: 'not_found' };
    const mine = await rankOn(db, { characterId: row.id, statisticId, rulesetId, period });
    if (!mine.rank) return { status: 'unavailable', reason: 'This character isn’t on that board: a value of 0 isn’t ranked.' };
    const top = (await boardPage(db, { statisticId, rulesetId, period, limit: 3 })).rows;
    const near = await characterNeighbours(db, { statisticId, rulesetId, period, value: mine.value, characterId: Number(row.id) });
    const ids = [...new Set([...top.map((r) => Number(r.characterId)), ...near.map((r) => Number(r.character_id))])];
    const names = new Map((await db.query('SELECT id, name, surname FROM characters WHERE id = ANY($1::bigint[]) LIMIT 20', [ids])).map((x) => [Number(x.id), `${x.name} ${x.surname}`]));
    const nearRanks = await ranksFor(db, { statisticId, rulesetId, period, values: [...new Set(near.map((r) => r.value))] });
    const c = await characterView(db, row);
    const renderAllowed = c.media.state === 'ok' && !c.renderHidden;
    const data = {
      theme: options.theme,
      accent: options.accent,
      url: `${host()}${scopePrefix()}/leaderboards/${rulesetId}/${statisticId}`,
      asof: asOf(row.stats_fetched_at),
      rank: fmt(mine.rank),
      rank_cls: rankCls(mine.rank),
      stat: stat.name,
      scope: scopeText,
      value: num(mine.value),
      unit: '',
      subject: `${row.name} ${row.surname}`,
      sub: [[row.race, row.class].filter(Boolean).join(' '), c.guild?.name].filter(Boolean).join(' · '),
      render: renderAllowed ? c.media.render : null,
      subject_svg: '',
      top3: top.map((r) => ({ rank: fmt(r.rank), name: names.get(Number(r.characterId)) ?? '', value: num(r.value), cls: Number(r.characterId) === Number(row.id) ? 'me' : '' })),
      neighbours: near.map((r) => ({ rank: fmt(nearRanks.get(r.value)), name: names.get(Number(r.character_id)) ?? '', value: num(r.value), cls: Number(r.character_id) === Number(row.id) ? 'me' : '' })),
    };
    const fetched = await db.one('SELECT min(fetched_at) AS t FROM character_statistics WHERE statistic_id = $1 AND character_id = ANY($2::bigint[])', [statisticId, ids]);
    return {
      status: 'ok', data, subject: 'character',
      dataAt: oldest(fetched?.t, row.stats_fetched_at, renderAllowed ? row.media_fetched_at : null),
      characterIds: ids, guildIds: [],
      title: `${row.name} ${row.surname}: #${mine.rank} in ${stat.name}`,
      description: `#${mine.rank} of ${mine.withAny} on ${rs.name} (${label.toLowerCase()}), from Blizzard’s data as of ${data.asof}.`,
      page: `/leaderboards/${rulesetId}/${statisticId}${period === 'overall' ? '' : `?period=${period}`}`,
      subjectKey: `b:${rulesetId}:${statisticId}:${period}:c${row.id}`,
    };
  }

  if (gSlug) {
    const found = await guildBySlug(db, gSlug);
    if (found.status !== 'ok') return found;
    const g = found.g;
    if (Number(g.ruleset_id) !== rulesetId) return { status: 'not_found' };
    const minMembers = await getSetting(db, 'guilds.minMembers');
    const col = mode === 'average' ? 'average' : 'total';
    const own = await db.one(
      `SELECT ${col} AS value, members, computed_at FROM guild_totals WHERE guild_id = $1 AND period = $2 AND period_start = $3 AND statistic_id = $4 AND ruleset_id = $5 AND total > 0 AND members >= $6`,
      [g.id, period, guildPeriodStart(period), statisticId, rulesetId, minMembers],
    );
    if (!own) return { status: 'unavailable', reason: 'This guild isn’t ranked on that board.' };
    const rank = (await guildRanksFor(db, { statisticId, rulesetId, period, mode, minMembers, values: [own.value] })).get(own.value);
    const top = (await guildBoardPage(db, { statisticId, rulesetId, period, mode, minMembers, limit: 3 })).rows;
    const above = await db.query(
      `SELECT guild_id, ${col} AS value FROM guild_totals WHERE period = $1 AND period_start = $2 AND statistic_id = $3 AND ruleset_id = $4 AND total > 0 AND members >= $5
         AND (${col} > $6 OR (${col} = $6 AND guild_id < $7)) ORDER BY ${col} ASC, guild_id DESC LIMIT 2`,
      [period, guildPeriodStart(period), statisticId, rulesetId, minMembers, own.value, g.id],
    );
    const below = await db.query(
      `SELECT guild_id, ${col} AS value FROM guild_totals WHERE period = $1 AND period_start = $2 AND statistic_id = $3 AND ruleset_id = $4 AND total > 0 AND members >= $5
         AND (${col} < $6 OR (${col} = $6 AND guild_id > $7)) ORDER BY ${col} DESC, guild_id LIMIT 2`,
      [period, guildPeriodStart(period), statisticId, rulesetId, minMembers, own.value, g.id],
    );
    const near = [...above.reverse(), { guild_id: g.id, value: own.value }, ...below];
    const gids = [...new Set([...top.map((r) => Number(r.guildId)), ...near.map((r) => Number(r.guild_id))])];
    const names = new Map((await db.query('SELECT id, name FROM guilds WHERE id = ANY($1::bigint[]) LIMIT 20', [gids])).map((x) => [Number(x.id), x.name]));
    const nearRanks = await guildRanksFor(db, { statisticId, rulesetId, period, mode, minMembers, values: [...new Set(near.map((r) => r.value))] });
    const badges = await guildBadgesView(db, g);
    const pinned = badges?.row?.[0] ?? null;
    const mark = pinned?.template === 'partner-guild' ? await markOfGuild(db, g.id) : null;
    const data = {
      theme: options.theme,
      accent: options.accent,
      url: `${host()}${scopePrefix()}/leaderboards/guilds/${rulesetId}/${statisticId}`,
      asof: asOf(own.computed_at),
      rank: fmt(rank),
      rank_cls: rankCls(rank),
      stat: stat.name,
      scope: `Guild board · ${mode} · ${scopeText}`,
      value: num(own.value),
      unit: '',
      subject: g.name,
      sub: `Guild · ${num(own.members)} tracked member${own.members === 1 ? '' : 's'}`,
      render: null,
      subject_svg: (pinned ? guildBadgeSvg(pinned, { mark }) : null) || CREST,
      top3: top.map((r) => ({ rank: fmt(r.rank), name: names.get(Number(r.guildId)) ?? '', value: num(r.value), cls: Number(r.guildId) === Number(g.id) ? 'me' : '' })),
      neighbours: near.map((r) => ({ rank: fmt(nearRanks.get(r.value)), name: names.get(Number(r.guild_id)) ?? '', value: num(r.value), cls: Number(r.guild_id) === Number(g.id) ? 'me' : '' })),
    };
    return {
      status: 'ok', data, subject: 'guild',
      dataAt: oldest(own.computed_at),
      characterIds: [], guildIds: gids,
      title: `<${g.name}>: #${rank} in ${stat.name}`,
      description: `#${rank} on the ${rs.name} guild board (${mode}, ${label.toLowerCase()}), from Blizzard’s data as of ${data.asof}.`,
      page: `/leaderboards/guilds/${rulesetId}/${statisticId}${period === 'overall' ? '' : `?period=${period}`}`,
      subjectKey: `b:${rulesetId}:${statisticId}:${period}:g${g.id}:${mode}`,
    };
  }
  return { status: 'not_found' };
}

/** Dispatch by type. `params` are the subject's (slug, or board coordinates). */
// ------------------------------------------------------------------------------------------------ collections

/**
 * 0.9.0 Collections card (design/v4-collections/cards): transmog completion (% with Blizzard's appearance catalog, the
 * plain count without), up to 6 counts (only real values above zero; the account glyph only where "shared" is known),
 * and up to 6 mount and pet icons from Blizzard's catalogs (no icon: the frame stays empty, never a stand-in).
 */
export async function collectionsCard(db, { slug, options }) {
  const found = await characterBySlug(db, slug);
  if (found.status !== 'ok') return found;
  const row = found.row;
  if (!row.collections_fetched_at) return { status: 'unavailable', reason: 'Everstats hasn’t fetched this character’s collections yet.' };
  const { collectionsOverview, collectionSection } = await import('../collections/view.js');
  const o = await collectionsOverview(db, row);
  const c = await characterView(db, row);
  const counts = o.counts.filter((k) => k.value > 0 && k.key !== 'appearances').sort((a, b) => b.value - a.value).slice(0, 6)
    // "Shared across this account" only for a whole count known to be shared (achievements are only partly account-wide).
    .map((k) => ({ label: k.short ?? k.name, value: num(k.value), cls: k.shared && !k.shared.partial ? 'acct' : '' }));
  const app = o.counts.find((k) => k.key === 'appearances');
  if (!counts.length && !(app?.value > 0)) return { status: 'unavailable', reason: 'This character has no collection count above zero yet, and only real values go on a card.' };
  const showcase = [];
  for (const kind of ['mounts', 'pets']) {
    const s = await collectionSection(db, row, kind);
    for (const x of s?.collected ?? []) if (showcase.length < 6) showcase.push({ name: x.name ?? '', q: x.quality ? 'q-' + x.quality : '', icon: x.icon ?? null, glyph: '' });
  }
  const pct = app?.total ? Math.floor((app.value / app.total) * 100) : null;
  const data = {
    theme: options.theme,
    accent: options.accent,
    url: host() + scopePrefix() + '/c/' + pathSlug(row) + '/collections',
    asof: asOf(row.collections_fetched_at),
    first: row.name,
    last: row.surname,
    meta: [row.level !== null ? 'Level ' + row.level : null, row.race, row.class].filter(Boolean).join(' · '),
    faction: row.faction ?? '',
    ruleset: c.ruleset?.name ?? '',
    guild: c.guild?.name ?? '',
    transmog: app?.value > 0
      ? (pct !== null ? { big: pct + '%', sub: num(app.value) + ' / ' + num(app.total) + ' appearances', w: pct } : { big: num(app.value), sub: 'appearances collected', w: null })
      : { big: '–', sub: 'appearances', w: null },
    counts,
    showcase: options.show.showcase && showcase.length ? showcase : null,
    show: { transmog: options.show.transmog && app?.value > 0, guild: options.show.guild && Boolean(c.guild), acct: counts.some((k) => k.cls === 'acct') },
  };
  return {
    status: 'ok',
    data,
    dataAt: oldest(row.collections_fetched_at),
    characterIds: [Number(row.id)],
    guildIds: [],
    title: row.name + ' ' + row.surname + ' · Collections',
    description: counts.slice(0, 3).map((k) => k.value + ' ' + k.label.toLowerCase()).join(', ') + ' on Everstats, from Blizzard’s data as of ' + data.asof + '.',
    page: scopePrefix() + '/c/' + pathSlug(row) + '/collections',
    ownerAccountId: row.owner_account_id === null ? null : Number(row.owner_account_id),
    subjectKey: 'k:' + row.id,
  };
}

export function buildCard(db, type, params, options) {
  if (type === 'collections') return collectionsCard(db, { slug: params.c, options });
  if (type === 'character') return characterCard(db, { slug: params.c, options });
  if (type === 'tier') return tierCard(db, { slug: params.c, options });
  if (type === 'guild') return guildCard(db, { slug: params.g, options });
  if (type === 'board') return boardCard(db, { ...params, options });
  return { status: 'not_found' };
}
