import { loadCatalog } from '../stats/catalog.js';
import { currentGuildMaster } from '../guilds/manage.js';
import { LETTER_POINTS, STRONG_ROSTER_MIN } from './catalog.js';
import { evaluationInputs, guildFacts } from './rules.js';
import {
  arrange, featuredExpired, guildAwards, guildHolderCounts, isUnlisted, partnerMarks, progressOf, publicGuildBadge, ribbonOn,
} from './store.js';

/**
 * What pages receive about a guild's badges (0.7.1). Progress is computed live from stored values (guildFacts), never
 * stored, and a value Everstats hasn't measured yet (totals still being added up) is null, never 0.
 */
const LETTERS = Object.entries(LETTER_POINTS).sort((a, b) => b[1] - a[1]);
const letterNear = (avg) => (avg === null ? null : LETTERS.find(([, p]) => avg >= p - 0.5)?.[0] ?? 'D');

/** Board ids → words: "Quests completed · total · Normal". */
async function boardNames(db, awards) {
  const { statistics } = await loadCatalog(db);
  const rs = new Map((await db.query('SELECT id, name FROM rulesets LIMIT 100')).map((r) => [r.id, r.name]));
  return (boards) => (boards ?? []).map((b) => ({
    statisticId: b.statisticId, rulesetId: b.rulesetId, mode: b.mode, period: b.period,
    statistic: statistics.get(b.statisticId)?.name ?? null, ruleset: rs.get(b.rulesetId) ?? null,
  }));
}

/** One award as a pill/popover: the badge at its level, dates, boards, progress, holders, ribbon. */
function awardView(a, { counts, marks, guildId, values, names, now }) {
  const value = values?.get(a.id);
  return {
    ...publicGuildBadge(a, { level: a.level, mark: a.template === 'partner-guild' ? marks.get(Number(guildId)) ?? null : null }),
    state: a.state,
    firstAt: a.first_at,
    levelAt: a.level_at,
    heldSince: a.kept_while_held ? a.held_since : null,
    lostAt: a.lost_at,
    source: a.source,
    boards: a.detail?.boards ? names(a.detail.boards) : null,
    event: a.id === 'featured-guild' ? { label: a.detail?.label ?? null, until: a.detail?.until ?? null } : null,
    reached: a.levelled ? a.thresholds[(a.level || 1) - 1] : null,
    progress: a.levelled ? progressOf(a, a.level, value ?? null) : null,
    measured: a.levelled ? value !== null && value !== undefined : null,
    heldBy: (a.levelled ? counts.byLevel.get(`${a.id}:${a.level}`) : counts.total.get(a.id)) ?? 0,
    ribbon: ribbonOn(a, now) ? a.ribbon_at : null,
  };
}

/**
 * The guild page's badge area: { row, more, automatic, verified, nextUnlocks, measuredAt }. A guild with no badges has
 * an empty row (the page draws no row at all) and still gets Next unlocks.
 */
export async function guildBadgesView(db, g, { inputs = null, now = Date.now() } = {}) {
  const inp = inputs ?? await evaluationInputs(db);
  const facts = await guildFacts(db, g, inp);
  const awards = await guildAwards(db, g.id);
  const gm = await currentGuildMaster(db, g.id);
  const counts = await guildHolderCounts(db);
  const marks = await partnerMarks(db, [Number(g.id)]);
  const names = await boardNames(db);
  const ctx = { counts, marks, guildId: g.id, values: facts.values, names, now };
  const { row, more, automatic } = arrange(awards, { managed: Boolean(gm?.accountId) });
  const verified = awards.find((a) => a.status_mark && a.state === 'held');
  // Next unlocks: the three levelled badges closest to their next level, by percentage; never one already at V. A
  // badge whose value isn't measured yet isn't a candidate (it would show an invented 0).
  const levels = new Map(awards.map((a) => [a.id, a.level ?? 0]));
  const next = inp.defs
    .filter((d) => d.levelled && d.award === 'automatic' && (levels.get(d.id) ?? 0) < 5 && facts.values.get(d.id) !== null && facts.values.get(d.id) !== undefined)
    .map((d) => ({ def: d, p: progressOf(d, levels.get(d.id) ?? 0, facts.values.get(d.id)) }))
    .sort((a, b) => b.p.pct - a.p.pct || a.def.sort - b.def.sort)
    .slice(0, 3)
    .map(({ def, p }) => ({ ...publicGuildBadge(def, { level: p.level }), progress: p, current: levels.get(def.id) ?? 0 }));
  return {
    row: row.map((a) => awardView(a, ctx)),
    more: more.map((a) => awardView(a, ctx)),
    automatic,
    verified: verified ? { since: verified.held_since } : null,
    nextUnlocks: next,
    measuring: !facts.built,
  };
}

/**
 * Manage guild → Badges: every badge in three groups (manage-picker.md). shown (in order, the effective pin marked),
 * hidden (unlocked but not shown, and LOST standing badges with their date), notYet (standing not held now, with the
 * reason; heritage this guild can't get any more). Never the Verified mark (it isn't a slot).
 */
export async function manageBadgesView(db, g, { now = Date.now() } = {}) {
  const inp = await evaluationInputs(db);
  const facts = await guildFacts(db, g, inp);
  const all = await guildAwards(db, g.id, { states: ['held', 'lost'] });
  const counts = await guildHolderCounts(db);
  const marks = await partnerMarks(db, [Number(g.id)]);
  const names = await boardNames(db);
  const ctx = { counts, marks, guildId: g.id, values: facts.values, names, now };
  const { row, more, pinned } = arrange(all, { managed: true, now });
  const shownIds = new Set([...row, ...more].map((a) => a.id));
  const shown = [...row, ...more].map((a) => ({ ...awardView(a, ctx), pinned: a === pinned }));
  const hidden = all
    .filter((a) => !a.status_mark && !shownIds.has(a.id))
    .map((a) => ({ ...awardView(a, ctx), expired: featuredExpired(a, now) }));
  const have = new Set(all.filter((a) => a.state === 'held').map((a) => a.id));
  const lostIds = new Set(all.filter((a) => a.state === 'lost').map((a) => a.id));
  const notYet = [];
  for (const d of inp.defs) {
    if (have.has(d.id) || lostIds.has(d.id) || d.status_mark || d.award !== 'automatic' || isUnlisted(d, inp.ctx)) continue;
    if (d.levelled) continue; // levelled badges in progress live in Next unlocks / the detail page
    notYet.push({ ...publicGuildBadge(d), reason: notYetReason(d, facts, inp.ctx) });
  }
  return { shown, hidden, notYet, max: 6 };
}

/** Why a badge isn't held, in words (states/locked, states/no-longer-available). */
export function notYetReason(d, f, ctx) {
  switch (d.rule?.type) {
    case 'every-class': return f.classes.all.length
      ? `Not yet · missing ${f.classes.missing.length} class${f.classes.missing.length === 1 ? '' : 'es'}: ${f.classes.missing.join(', ')}`
      : 'Not yet · no classes known';
    case 'board-champion': return `Not held · not #1 on a board with ${ctx.minBoardGuilds}+ ranked guilds`;
    case 'top-ten': return 'Not held · not top 10 on a board with more than 10 ranked guilds';
    case 'weekly-champion': return ctx.weekOpen ? 'Not held this week · resets Tuesday' : 'Not yet · the weekly boards open after a full week of daily snapshots';
    case 'strong-roster':
      if (f.tierLettered < ctx.minMembers) return `Not held · needs ${ctx.minMembers} members with an overall tier (${f.tierLettered} so far)`;
      return `Not held · average tier is ${letterNear(f.tierAverage)} (needs A)`;
    case 'founding': return ctx.beta.open ? 'Not available · this guild was first tracked before the open beta began' : 'No longer available · the open beta has closed';
    case 'early-guild':
      if (ctx.early.upcoming) return `Opens ${ctx.early.start} (UTC)`;
      return f.early ? 'Not yet' : `No longer available · tracked outside the early window (${ctx.early.start} – ${ctx.early.end} UTC)`;
    default: return 'Not yet';
  }
}

export { STRONG_ROSTER_MIN };
