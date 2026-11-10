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
 *
 * 0.10.0 GROUPS (owner's decision): a group is a category (the same labels: Combat, Adventure … Collections, PvP), and
 * per game version the owner chooses for each: 'counts' (its category tier and the overall tier), 'category' (its own
 * letter only, like Social), 'none' (leaderboard only, like Deaths & mishaps). The choice applies to every statistic in
 * the group, later ones included, EXCEPT:
 *   - a statistic with its own complete decisions (an approved category and "counts toward", an approved duplicate,
 *     an approved "no tier"): those win, shown as exceptions to the group's choice;
 *   - a statistic whose own suggestion the owner REJECTED (category or "counts toward"): it counts nothing;
 *   - a statistic marked 'group_exempt' (it follows its own decisions only; with none approved it counts nothing);
 *   - a name + number statistic: never counted through a group (its number means a different thing per character);
 *   - a possible duplicate pairing still undecided.
 * No choice for the group → undecided, as before. A new version starts with every group undecided: no tiers.
 */
export const FARMABLE = new Set(CATEGORY_RULES.filter((r) => r.farmable).map((r) => r.label));
// 'Deaths & mishaps': the one category that is never graded. (Found by label: it was CATEGORY_RULES[0] until 0.9.0
// put Collections first, after which the admin's issues named the wrong category; fixed 0.10.0.)
export const DEATHS = CATEGORY_RULES.find((r) => r.label === 'Deaths & mishaps').label;

export const ROLE_LABELS = Object.freeze({
  counted: 'Counts',
  bad: 'Bad: leaderboard only',
  named: 'Name + number: leaderboard only',
  duplicate: 'Duplicate: graded through the other',
  undecided: 'Undecided: doesn’t count yet',
});

export const GROUP_CHOICES = Object.freeze({
  counts: { label: 'Counts toward tiers', grading: 'overall' },
  category: { label: 'Own category letter only', grading: 'category' },
  none: { label: 'Doesn’t count', grading: 'none' },
});

/** → { role, reason, via: 'own' | 'group' | 'exempt' | 'none', duplicateOf?, grading? } */
function roleOf(s, group) {
  const d = s.decided ?? {};
  const own = ownRole(s, d);
  if (own) return { ...own, via: 'own' };
  if (d.categoryRejected || d.gradingRejected) {
    return { role: 'undecided', via: 'own', reason: d.categoryRejected ? 'You rejected its suggested category and no other is approved.' : 'You rejected what it counts toward, and nothing else is approved.' };
  }
  if (d.groupExempt) return { role: 'undecided', via: 'exempt', reason: 'Set to follow its own decisions, not its group’s choice, and none is approved.' };
  // 0.10.0: a board Everstats makes (a collection count, a feed value: statistics.derived) counts only with its OWN
  // approval, as collection counts always have; a group choice covers Blizzard's statistics. (Otherwise the new feed
  // boards would start counting under Forever's migrated choices and change Forever's tiers.)
  if (s.derived) return { ...legacyUndecided(d), via: 'none', reason: 'A board Everstats makes: it counts only once you approve it on its own.' };
  if (!group) return { ...legacyUndecided(d), via: 'none' };
  if (d.duplicatePendingOf !== null && d.duplicatePendingOf !== undefined) return { role: 'undecided', via: 'group', reason: `A possible duplicate of id ${d.duplicatePendingOf} that you haven’t approved or rejected yet.`, duplicateOf: d.duplicatePendingOf };
  if (group.choice === 'none') {
    return s.valueType === 'name-and-number'
      ? { role: 'named', via: 'group', reason: `Its group (${s.category}) doesn’t count.` }
      : { role: 'bad', via: 'group', reason: `Its group (${s.category}) doesn’t count: leaderboard only.` };
  }
  if (s.valueType === 'name-and-number' || s.named) return { role: 'named', via: 'group', reason: 'A name + number statistic: never counted through its group.' };
  const grading = GROUP_CHOICES[group.choice]?.grading ?? null;
  if (!grading) return { ...legacyUndecided(d), via: 'none' };
  return { role: 'counted', via: 'group', grading, reason: grading === 'overall' ? `Its group (${s.category}) counts toward the tiers.` : `Its group (${s.category}) counts toward its own category letter only.` };
}

function legacyUndecided(d) {
  if (!d.category) return { role: 'undecided', reason: 'Its category isn’t approved yet, and its group has no choice.' };
  return { role: 'undecided', reason: 'What it counts toward isn’t approved yet, and its group has no choice.' };
}

/** The statistic's own decisions, when they settle it (pre-0.10.0 rules exactly), else null. */
function ownRole(s, d) {
  if (d.duplicateOf !== null && d.duplicateOf !== undefined) return { role: 'duplicate', reason: `You approved it as a duplicate of id ${d.duplicateOf}.`, duplicateOf: d.duplicateOf };
  if (d.grading === 'none') {
    return s.valueType === 'name-and-number'
      ? { role: 'named', reason: 'You approved “no tier” for this name + number statistic.' }
      : { role: 'bad', reason: 'You approved “no tier: leaderboard only”.' };
  }
  if (!d.category || !d.grading) return null;
  if (d.duplicatePendingOf !== null && d.duplicatePendingOf !== undefined) return { role: 'undecided', reason: `A possible duplicate of id ${d.duplicatePendingOf} that you haven’t approved or rejected yet.`, duplicateOf: d.duplicatePendingOf };
  return { role: 'counted', grading: d.grading, reason: d.grading === 'overall' ? 'Approved: counts toward its category and the overall tier.' : 'Approved: counts toward its category tier only.' };
}

/**
 * → { statistics: Map(id → { id, name, category, categoryKey, role, reason, grading, overall, duplicateOf }),
 *     categories: [{ label, key, farmable, inOverall, counted: [id], overall: [id], bad: [id], named: [id],
 *                    duplicate: [id], undecided: [id] }],   in the catalog's order
 *     issues: [{ statisticId, name, problem }] }
 */
export function whatCounts(catalog) {
  const groups = catalog.groups ?? new Map();
  const statistics = new Map();
  const categories = [];
  const issues = [];
  for (const c of catalog.categories) {
    const farmable = FARMABLE.has(c.label);
    const cat = { label: c.label, key: categoryKey(c.label), farmable, inOverall: false, counted: [], overall: [], bad: [], named: [], duplicate: [], undecided: [] };
    for (const id of c.statisticIds) {
      const s = catalog.statistics.get(id);
      const group = groups.get(c.label) ?? null;
      const r = roleOf({ ...s, category: c.label }, group);
      const grading = r.role === 'counted' ? r.grading : null;
      const overall = r.role === 'counted' && grading === 'overall' && !farmable;
      // An exception: decided on its own (or exempt) in a group that has a choice, with a different result.
      const groupRole = group ? (group.choice === 'none' ? 'none' : GROUP_CHOICES[group.choice]?.grading) : null;
      const exception = Boolean(group) && r.via !== 'group' && (r.role === 'counted' ? grading : r.role === 'bad' || r.role === 'named' ? 'none' : 'undecided') !== groupRole;
      statistics.set(id, { id, name: s.name, category: c.label, categoryKey: cat.key, role: r.role, reason: r.reason, grading, overall, duplicateOf: r.duplicateOf ?? null, via: r.via, exception });
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
