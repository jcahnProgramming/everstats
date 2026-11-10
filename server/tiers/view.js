import { PRIMARY_VERSION, categoryLabel, publicVersions } from '../core/gameVersions.js';
import { pageLimit } from '../core/db.js';
import { TRACKED_MEMBER } from '../stats/guildTotals.js';
import { TIER_LETTERS, bandRanges, letterForScore } from '../stats/tiers.js';
import { ROLE_LABELS } from './counting.js';
import { categoryWeights } from './engine.js';
import { countingNow, eligibleCount, tierSettings } from './store.js';

/**
 * What the pages show about tiers (0.6.0). Every Unranked state carries its reason in player terms, with the numbers
 * that decide it, and every letter comes with what fed it (the "Why this tier" breakdown), never a bare letter.
 */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const REASONS = {
  ruleset_small: ({ min, ruleset, n }) => `Tiers open once ${min.toLocaleString('en-US')} characters are tracked on ${ruleset} (${n.toLocaleString('en-US')} so far).`,
  pending: () => 'Not graded yet. Everstats grades a character right after each fetch, and everyone again every few hours.',
  few_categories: ({ needed, total, lettered }) => `Needs a letter in at least ${needed} of the ${total} categories that count toward the overall tier (has ${lettered}).`,
  no_categories: () => 'No category counts toward the overall tier yet: nothing is approved for grading.',
  few_nonzero: ({ needed, counted, nonzero }) => `Needs a value above zero in at least ${needed} of this category’s ${plural(counted, 'graded statistic')} (has ${nonzero}).`,
  no_stats: () => 'No graded stats yet.',
};

/**
 * A PROVISIONAL letter (0.9.0) for a character below a category or overall minimum in a GRADED ruleset: the letter its
 * score would earn against the ruleset's stored cutoffs (the lowest score that earned each letter at the last full
 * grading), or null when there is no score or nobody was given a letter in that scope. Computed when a page is drawn,
 * never stored: tier boards, guild tier bars, S-Tier and Strong Roster read the stored letters only, so a provisional
 * letter can never reach them. A ruleset below the population minimum gets none ("Tiers open once…").
 */
export function provisionalLetter(score, cutoffs) {
  if (!Number.isFinite(score) || !cutoffs || !TIER_LETTERS.some((l) => Number.isFinite(cutoffs[l]))) return null;
  return letterForScore(score, cutoffs);
}

async function rankIn(db, table, { rulesetId, key = null, score }) {
  const keyCond = key === null ? '' : 'AND t.category_key = $3';
  const args = key === null ? [rulesetId, score] : [rulesetId, score, key];
  const row = await db.one(
    `SELECT count(*) FILTER (WHERE t.score > $2)::int + 1 AS rank, count(*)::int AS of
       FROM ${table} t JOIN characters c ON c.id = t.character_id
      WHERE t.ruleset_id = $1 AND t.letter IS NOT NULL AND NOT c.hidden ${keyCond}`,
    args,
  );
  return row;
}

/** The tier block of a character page: overall, every category, and per counted statistic the value and percentile. */
export async function characterTierView(db, row) {
  if (row.ruleset_id === null || row.hidden) return null;
  const ruleset = await db.one('SELECT id, name FROM rulesets WHERE id = $1', [row.ruleset_id]);
  const settings = await tierSettings(db);
  const population = await eligibleCount(db, row.ruleset_id);
  const tr = await db.one('SELECT * FROM tier_rulesets WHERE ruleset_id = $1', [row.ruleset_id]);
  const base = { ruleset, population, minPopulation: settings.minPopulation, gradedAt: tr?.computed_at ?? null };
  const rsName = ruleset?.name ?? 'this ruleset';
  if (population < settings.minPopulation) {
    return { ...base, status: 'unranked', reason: { code: 'ruleset_small', text: REASONS.ruleset_small({ min: settings.minPopulation, ruleset: rsName, n: population }) }, overall: null, categories: [] };
  }
  const t = await db.one('SELECT * FROM character_tiers WHERE character_id = $1', [row.id]);
  if (!tr?.graded || !t) return { ...base, status: 'pending', reason: { code: 'pending', text: REASONS.pending() }, overall: null, categories: [] };

  const plan = tr.plan;
  const used = tr.settings;
  const { catalog } = await countingNow(db);
  const pctBy = new Map(t.stat_ids.map((id, i) => [Number(id), t.stat_pcts[i]]));
  const values = new Map((await db.query(
    'SELECT statistic_id, value, text FROM character_statistics WHERE character_id = $1 AND statistic_id = ANY($2::bigint[]) LIMIT 5000',
    [row.id, plan.statisticIds],
  )).map((r) => [Number(r.statistic_id), r]));
  const cats = new Map((await db.query('SELECT * FROM character_category_tiers WHERE character_id = $1 LIMIT 200', [row.id])).map((r) => [r.category_key, r]));

  // The weights this character was graded with: the stored grading's own plan and settings, never today's.
  const weightOf = new Map(categoryWeights(plan, used).map((w) => [w.key, w]));
  const categories = [];
  for (const pc of plan.categories) {
    const c = cats.get(pc.key);
    const overallIds = new Set(pc.overallIds);
    const rank = c?.letter ? await rankIn(db, 'character_category_tiers', { rulesetId: row.ruleset_id, key: pc.key, score: c.score }) : null;
    categories.push({
      key: pc.key,
      label: pc.label,
      farmable: pc.farmable,
      inOverall: pc.inOverall,
      letter: c?.letter ?? null,
      // Only with something to go on: a category where nothing is above zero gets no provisional letter.
      provisional: c && !c.letter && c.nonzero > 0 ? provisionalLetter(c.score, tr.scopes?.[pc.key]?.cutoffs) : null,
      score: c?.score ?? null,
      overallPart: c?.overall_part ?? null,
      nonzero: c?.nonzero ?? 0,
      needed: c?.needed ?? null,
      counted: pc.statisticIds.length,
      weight: weightOf.get(pc.key)?.weight ?? null,
      weightPinned: weightOf.get(pc.key)?.pinned ?? null,
      rank: rank?.rank ?? null,
      of: rank?.of ?? null,
      reason: c && !c.letter ? { code: 'few_nonzero', text: REASONS.few_nonzero({ needed: c.needed, counted: c.counted, nonzero: c.nonzero }) } : null,
      statistics: pc.statisticIds.map((id) => ({
        id,
        name: catalog.statistics.get(id)?.name ?? null,
        value: values.get(id)?.value ?? 0,
        text: values.get(id)?.text ?? null,
        percentile: pctBy.get(id) ?? null,
        overall: overallIds.has(id),
      })).sort((a, b) => (b.percentile ?? -1) - (a.percentile ?? -1)),
    });
  }
  const rank = t.letter ? await rankIn(db, 'character_tiers', { rulesetId: row.ruleset_id, score: t.score }) : null;
  return {
    ...base,
    status: 'graded',
    gradedBy: t.graded_by,
    computedAt: t.computed_at,
    settings: { shares: used.shares, categoryHalf: used.categoryHalf, overallHalf: used.overallHalf, minPopulation: used.minPopulation, weighting: used.weighting ?? 'equal' },
    overall: {
      letter: t.letter,
      provisional: t.letter ? null : provisionalLetter(t.score, tr.scopes?.overall?.cutoffs),
      score: t.score,
      rank: rank?.rank ?? null,
      of: rank?.of ?? null,
      lettered: t.lettered,
      needed: t.needed,
      total: t.total,
      reason: t.letter ? null : { code: t.reason, text: REASONS[t.reason]({ needed: t.needed, total: t.total, lettered: t.lettered }) },
    },
    categories,
    ungraded: plan.ungraded.map((u) => ({ ...u, reason: { code: 'no_stats', text: REASONS.no_stats() } })),
  };
}

const encodeCursor = (v, id) => Buffer.from(JSON.stringify([v, id])).toString('base64url');
function decodeCursor(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  try {
    const [v, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Number.isFinite(v) && Number.isSafeInteger(id) ? { v, id } : null;
  } catch {
    return null;
  }
}

/**
 * A tier board: a ruleset's characters by overall score (scope 'overall') or by one category's score, with letters.
 * Same rules as the other boards: ties share a rank (1 + how many are strictly above), hidden characters are on no
 * board, Unranked characters aren't rows (they're counted), nothing is cached, and the page says how fresh it is.
 */
export async function tierBoard(db, { rulesetId, scope = 'overall', cursor = null, limit: rawLimit }) {
  const tr = await db.one('SELECT population, graded, plan, computed_at FROM tier_rulesets WHERE ruleset_id = $1', [rulesetId]);
  const settings = await tierSettings(db);
  const population = await eligibleCount(db, rulesetId);
  const categories = (tr?.plan?.categories ?? []).map((c) => ({ key: c.key, label: c.label, farmable: c.farmable, inOverall: c.inOverall }));
  const head = { scope, categories, population, minPopulation: settings.minPopulation, gradedAt: tr?.computed_at ?? null };
  if (scope !== 'overall' && !categories.some((c) => c.key === scope)) return { ...head, missingScope: true, rows: [], next: null };
  if (population < settings.minPopulation || !tr?.graded) return { ...head, graded: false, rows: [], next: null, placed: 0 };
  const cat = scope !== 'overall';
  const table = cat ? 'character_category_tiers' : 'character_tiers';
  const keyCond = cat ? 'AND t.category_key = $5' : '';
  const limit = pageLimit(rawLimit, { fallback: 50, max: 100 });
  const c = decodeCursor(cursor);
  const args = [rulesetId, c?.v ?? null, c?.id ?? null, limit + 1, ...(cat ? [scope] : [])];
  const rows = await db.query(
    `SELECT t.character_id, t.score, t.letter, t.computed_at FROM ${table} t JOIN characters c ON c.id = t.character_id
      WHERE t.ruleset_id = $1 AND t.letter IS NOT NULL AND NOT c.hidden ${keyCond}
        AND ($2::float8 IS NULL OR t.score < $2 OR (t.score = $2 AND t.character_id > $3))
      ORDER BY t.score DESC, t.character_id LIMIT $4`,
    args,
  );
  const page = rows.slice(0, limit);
  const ranks = new Map();
  for (const score of new Set(page.map((r) => r.score))) {
    const rk = await db.one(
      `SELECT count(*)::int + 1 AS rank FROM ${table} t JOIN characters c ON c.id = t.character_id
        WHERE t.ruleset_id = $1 AND t.letter IS NOT NULL AND NOT c.hidden AND t.score > $2 ${cat ? 'AND t.category_key = $3' : ''}`,
      cat ? [rulesetId, score, scope] : [rulesetId, score],
    );
    ranks.set(score, rk.rank);
  }
  const counts = await db.one(
    `SELECT count(*)::int AS placed, min(t.computed_at) AS oldest, max(t.computed_at) AS newest FROM ${table} t JOIN characters c ON c.id = t.character_id
      WHERE t.ruleset_id = $1 AND t.letter IS NOT NULL AND NOT c.hidden ${cat ? 'AND t.category_key = $2' : ''}`,
    cat ? [rulesetId, scope] : [rulesetId],
  );
  return {
    ...head,
    graded: true,
    placed: counts.placed,
    unranked: Math.max(0, population - counts.placed),
    data: { oldest: counts.oldest, newest: counts.newest },
    rows: page.map((r) => ({ rank: ranks.get(r.score), characterId: Number(r.character_id), score: r.score, letter: r.letter })),
    next: rows.length > limit ? encodeCursor(page.at(-1).score, Number(page.at(-1).character_id)) : null,
  };
}

/** A guild's tracked members by overall letter: { S: n, …, unranked: n, graded } (graded: its ruleset has tiers). */
export async function guildTierDistribution(db, g) {
  if (g.ruleset_id === null) return null;
  const rows = await db.query(
    `SELECT ct.letter, count(*)::int AS n FROM characters c LEFT JOIN character_tiers ct ON ct.character_id = c.id
      WHERE ${TRACKED_MEMBER} GROUP BY ct.letter LIMIT 10`,
    [g.id, g.ruleset_id],
  );
  const out = Object.fromEntries([...TIER_LETTERS, 'unranked'].map((l) => [l, 0]));
  for (const r of rows) out[r.letter ?? 'unranked'] += r.n;
  const tr = await db.one('SELECT graded, computed_at FROM tier_rulesets WHERE ruleset_id = $1', [g.ruleset_id]);
  return { letters: out, graded: Boolean(tr?.graded), gradedAt: tr?.computed_at ?? null };
}

/** Each category's statistics by role, with names (public "How tiers work", and the admin's "What counts"). */
export function countsView(counts, catalog, { admin = false } = {}) {
  const nameOf = (id) => catalog.statistics.get(id)?.name ?? null;
  const list = (ids) => ids.map((id) => ({ id, name: nameOf(id) })).filter((s) => s.name !== null).sort((a, b) => a.name.localeCompare(b.name));
  return counts.categories.map((c) => ({
    key: c.key,
    label: c.label,
    farmable: c.farmable,
    inOverall: c.inOverall,
    counted: list(c.counted).map((s) => ({ ...s, overall: c.overall.includes(s.id) })),
    bad: list(c.bad),
    named: list(c.named),
    duplicate: list(c.duplicate).map((s) => ({ ...s, of: counts.statistics.get(s.id).duplicateOf, ofName: nameOf(counts.statistics.get(s.id).duplicateOf) })),
    undecided: admin ? list(c.undecided).map((s) => ({ ...s, reason: counts.statistics.get(s.id).reason })) : c.undecided.length,
  }));
}

/** The public "How tiers work" page: the live settings and what counts, from the owner's live decisions. */
export async function howTiersWork(db) {
  const settings = await tierSettings(db);
  const { catalog, counts, plan } = await countingNow(db);
  const rulesets = await db.query(
    `SELECT r.id, r.name, t.graded, t.computed_at FROM rulesets r LEFT JOIN tier_rulesets t ON t.ruleset_id = r.id WHERE r.listed ORDER BY r.id LIMIT 50`,
  );
  const withCounts = [];
  for (const r of rulesets) withCounts.push({ id: r.id, name: r.name, population: await eligibleCount(db, r.id), gradedAt: r.computed_at ?? null });
  return {
    settings: { ...settings, bands: bandRanges(settings.shares) },
    rulesets: withCounts,
    categories: countsView(counts, catalog),
    weights: categoryWeights(plan, settings),
    lastGrading: (await db.one("SELECT finished_at FROM tier_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1"))?.finished_at ?? null,
  };
}

/** The admin's "What counts": every statistic's role and why, the inconsistencies, and the grading runs. */
export async function adminTierState(db, { version = PRIMARY_VERSION.id } = {}) {
  // 0.10.0: one game version's settings, what counts there, and its realm categories (the admin picks the version).
  const settings = await tierSettings(db, version);
  const { catalog, counts, plan } = await countingNow(db, { fresh: true, version });
  const summary = counts.categories.map((c) => ({
    key: c.key, label: c.label, farmable: c.farmable, inOverall: c.inOverall,
    counted: c.counted.length, overall: c.overall.length, bad: c.bad.length, named: c.named.length, duplicate: c.duplicate.length, undecided: c.undecided.length,
  }));
  const runs = await db.query('SELECT id, status, reasons, requested_at, started_at, finished_at, ms, summary, problem FROM tier_runs ORDER BY id DESC LIMIT 10');
  const rulesets = await db.query(
    'SELECT r.id, r.name, t.population, t.graded, t.computed_at FROM rulesets r LEFT JOIN tier_rulesets t ON t.ruleset_id = r.id WHERE r.game_version = $1 ORDER BY r.id LIMIT 50',
    [version],
  );
  const live = [];
  for (const r of rulesets) live.push({ id: r.id, name: r.name, eligible: await eligibleCount(db, r.id), graded: Boolean(r.graded), gradedAt: r.computed_at ?? null, gradedPopulation: r.population ?? null });
  return {
    version,
    versions: publicVersions(),
    categoryWord: categoryLabel(version),
    settings,
    weights: categoryWeights(plan, settings),
    roles: ROLE_LABELS,
    summary,
    categories: countsView(counts, catalog, { admin: true }),
    issues: counts.issues,
    runs,
    rulesets: live,
  };
}

/** A character's overall letter and, when Unranked, why: { letter, status, reason } (dashboards, profiles). */
export async function tierBrief(db, row) {
  if (row.ruleset_id === null || row.hidden) return null;
  const settings = await tierSettings(db);
  const population = await eligibleCount(db, row.ruleset_id);
  if (population < settings.minPopulation) {
    const rs = await db.one('SELECT name FROM rulesets WHERE id = $1', [row.ruleset_id]);
    return { letter: null, status: 'unranked', reason: REASONS.ruleset_small({ min: settings.minPopulation, ruleset: rs?.name ?? 'this ruleset', n: population }) };
  }
  const t = await db.one('SELECT letter, reason, lettered, needed, total, score FROM character_tiers WHERE character_id = $1', [row.id]);
  if (!t) return { letter: null, status: 'pending', reason: REASONS.pending() };
  if (t.letter) return { letter: t.letter, status: 'graded', reason: null };
  const tr = await db.one('SELECT graded, scopes FROM tier_rulesets WHERE ruleset_id = $1', [row.ruleset_id]);
  return {
    letter: null,
    provisional: tr?.graded ? provisionalLetter(t.score, tr.scopes?.overall?.cutoffs) : null,
    status: 'unranked',
    reason: REASONS[t.reason]({ needed: t.needed, total: t.total, lettered: t.lettered }),
  };
}
