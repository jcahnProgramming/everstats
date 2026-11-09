import { CATEGORY_RULES } from '../discovery/suggest.js';
import { categoryKey } from '../stats/catalog.js';

/**
 * What counts toward the tiers (0.6.0), read from the owner's Discovery DECISIONS, never from a suggestion. Computed
 * from the live catalog (stats/catalog.js loadCatalog, whose `decided` carries the decisions), so approving,
 * rejecting or re-categorising a statistic changes what counts at the next grading. Nothing here names a statistic.
 *
 * A statistic's role, decided in this order:
 *   duplicate  the owner approved it as a duplicate of another: graded once, through the one it duplicates
 *   bad        the owner approved "no tier: leaderboard only" (deaths and mishaps, duels lost, Quests abandoned…)
 *   named      the same decision on a name + number statistic (its number counts a different thing for each character)
 *   undecided  anything else the owner hasn't approved: no approved category, no approved "counts toward", or a
 *              possible duplicate pairing still waiting for a decision. Counts as nothing, never as a guess.
 *   counted    an approved category AND an approved "counts toward" of 'overall' or 'category'
 *
 * A counted statistic feeds its category's tier. It also feeds the overall tier only when its decision is 'overall'
 * AND its category isn't farmable (Social; Camping & Hearth: their own tier only, owner's decision 2026-11-09).
 * A category counts toward the overall tier when it isn't farmable and has at least one such statistic.
 *
 * `issues` lists decisions that look inconsistent with each other, for the admin's "What counts" view.
 */
export const FARMABLE = new Set(CATEGORY_RULES.filter((r) => r.farmable).map((r) => r.label));
const DEATHS = CATEGORY_RULES[0].label; // 'Deaths & mishaps': the first rule, and the one category that is never graded

export const ROLE_LABELS = Object.freeze({
  counted: 'Counts',
  bad: 'Bad: leaderboard only',
  named: 'Name + number: leaderboard only',
  duplicate: 'Duplicate: graded through the other',
  undecided: 'Undecided: doesn’t count yet',
});

function roleOf(s) {
  const d = s.decided ?? {};
  if (d.duplicateOf !== null && d.duplicateOf !== undefined) return { role: 'duplicate', reason: `You approved it as a duplicate of id ${d.duplicateOf}.`, duplicateOf: d.duplicateOf };
  if (d.grading === 'none') {
    return s.valueType === 'name-and-number'
      ? { role: 'named', reason: 'You approved “no tier” for this name + number statistic.' }
      : { role: 'bad', reason: 'You approved “no tier: leaderboard only”.' };
  }
  if (!d.category) return { role: 'undecided', reason: d.categoryRejected ? 'You rejected its suggested category and no other is approved.' : 'Its category isn’t approved yet.' };
  if (!d.grading) return { role: 'undecided', reason: d.gradingRejected ? 'You rejected what it counts toward, and nothing else is approved.' : 'What it counts toward isn’t approved yet.' };
  if (d.duplicatePendingOf !== null && d.duplicatePendingOf !== undefined) return { role: 'undecided', reason: `A possible duplicate of id ${d.duplicatePendingOf} that you haven’t approved or rejected yet.`, duplicateOf: d.duplicatePendingOf };
  return { role: 'counted', reason: d.grading === 'overall' ? 'Approved: counts toward its category and the overall tier.' : 'Approved: counts toward its category tier only.' };
}

/**
 * → { statistics: Map(id → { id, name, category, categoryKey, role, reason, grading, overall, duplicateOf }),
 *     categories: [{ label, key, farmable, inOverall, counted: [id], overall: [id], bad: [id], named: [id],
 *                    duplicate: [id], undecided: [id] }],   in the catalog's order
 *     issues: [{ statisticId, name, problem }] }
 */
export function whatCounts(catalog) {
  const statistics = new Map();
  const categories = [];
  const issues = [];
  for (const c of catalog.categories) {
    const farmable = FARMABLE.has(c.label);
    const cat = { label: c.label, key: categoryKey(c.label), farmable, inOverall: false, counted: [], overall: [], bad: [], named: [], duplicate: [], undecided: [] };
    for (const id of c.statisticIds) {
      const s = catalog.statistics.get(id);
      const r = roleOf(s);
      const grading = r.role === 'counted' ? s.decided.grading : null;
      const overall = r.role === 'counted' && grading === 'overall' && !farmable;
      statistics.set(id, { id, name: s.name, category: c.label, categoryKey: cat.key, role: r.role, reason: r.reason, grading, overall, duplicateOf: r.duplicateOf ?? null });
      cat[r.role].push(id);
      if (overall) cat.overall.push(id);
      const issue = (problem) => issues.push({ statisticId: id, name: s.name, category: c.label, problem });
      if (r.role === 'counted') {
        if (grading === 'overall' && farmable) issue(`Approved to count toward the overall tier, but its category (${c.label}) is farmable, so it counts toward the ${c.label} tier only.`);
        if (grading === 'category' && !farmable) issue(`Approved to count toward its category tier only, in a category that isn’t farmable: it feeds the ${c.label} tier but never the overall tier.`);
        if (s.valueType === 'name-and-number') issue('A name + number statistic approved to count: its number counts a different thing for each character.');
        if (c.label === DEATHS) issue(`Approved to count, but it is filed under ${DEATHS}, which never affects a tier by the settled rules.`);
      }
      if (r.role === 'bad' && farmable) issue(`Marked bad (leaderboard only) in a farmable category (${c.label}).`);
    }
    cat.inOverall = !farmable && cat.overall.length > 0;
    categories.push(cat);
  }
  // A duplicate is graded through the one it duplicates: say so when that one doesn't count either.
  for (const s of statistics.values()) {
    if (s.role !== 'duplicate') continue;
    const kept = statistics.get(s.duplicateOf);
    if (!kept) issues.push({ statisticId: s.id, name: s.name, category: s.category, problem: `Approved as a duplicate of id ${s.duplicateOf}, which isn’t in the catalog any more, so neither counts.` });
    else if (kept.role !== 'counted') issues.push({ statisticId: s.id, name: s.name, category: s.category, problem: `Approved as a duplicate of “${kept.name}”, which doesn’t count either (${ROLE_LABELS[kept.role].toLowerCase()}), so this pair counts nowhere.` });
  }
  return { statistics, categories, issues };
}

/** The counted statistics, grouped the way the grading needs them. */
export function gradingPlan(counts) {
  const cats = counts.categories.filter((c) => c.counted.length > 0);
  return {
    statisticIds: cats.flatMap((c) => c.counted),
    categories: cats.map((c) => ({ key: c.key, label: c.label, farmable: c.farmable, inOverall: c.inOverall, statisticIds: c.counted, overallIds: c.overall })),
    ungraded: counts.categories.filter((c) => c.counted.length === 0).map((c) => ({ key: c.key, label: c.label, farmable: c.farmable })),
  };
}
