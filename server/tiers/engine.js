import { TIER_LETTERS, atLeastShare, isGraded, tierForRank } from '../stats/tiers.js';

/**
 * The tier grading itself (0.6.0), pure: numbers in, scores and letters out. No database, no settings store, so the
 * full grading (tiers/store.js), the admin preview and scripts/measure-tiers.js all run exactly this.
 *
 *   PERCENTILE  per counted statistic, among every tier-eligible character on the ruleset (a missing value is 0):
 *               (characters strictly below + half of those with the same value, itself included) ÷ population × 100.
 *               Ties share a percentile (mid-rank). Higher is better, 0–100.
 *   CATEGORY    the average of the character's percentiles over the category's counted statistics. A letter needs a
 *               value above 0 in at least `categoryHalf` % of them (rounded up), so one lucky statistic can't earn S.
 *   OVERALL     the WEIGHTED average, over EVERY category that counts toward the overall tier, of the character's
 *               percentiles in that category's overall-counting statistics (0.8.0; until then each category weighed
 *               the same). A category's weight follows the square root of how many of its statistics count toward the
 *               overall tier, unless the owner pinned a percent for it (categoryWeights below). A category without a
 *               letter still contributes its score (otherwise skipping a category would raise the average); the
 *               letter rule only decides whether an overall letter is given: it needs a letter in at least
 *               `overallHalf` % of those categories (rounded up). That rule counts categories, not weight.
 *   LETTERS     from where a score places among everyone's scores of the same kind on the ruleset: rank = 1 + how
 *               many are strictly above (ties share), then the shares (tiers.shares, default S 5 · A 15 · B 30 · C 30 ·
 *               D 20). Only characters who meet that scope's rule are placed; the rest are Unranked, with the reason.
 *   RULESET     below `minPopulation` tier-eligible characters, nobody on it is graded.
 *
 * Scores are rounded to 6 decimals before ranking, so equal inputs tie exactly despite floating-point noise.
 */
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Mid-rank percentiles of one statistic's values (length n, zeros included) → Float64Array(n).
 * Only the non-zero values are sorted: every zero shares the bottom percentile.
 */
export function percentiles(values) {
  const n = values.length;
  const out = new Float64Array(n);
  if (!n) return out;
  const nz = [];
  for (let i = 0; i < n; i++) if (values[i] > 0) nz.push(i);
  const zeros = n - nz.length;
  const zeroPct = ((zeros / 2) / n) * 100;
  for (let i = 0; i < n; i++) if (!(values[i] > 0)) out[i] = zeroPct;
  nz.sort((a, b) => values[a] - values[b]);
  let below = zeros;
  for (let g = 0; g < nz.length;) {
    let e = g;
    while (e < nz.length && values[nz[e]] === values[nz[g]]) e++;
    const eq = e - g;
    const p = ((below + eq / 2) / n) * 100;
    for (let k = g; k < e; k++) out[nz[k]] = p;
    below += eq;
    g = e;
  }
  return out;
}

/** The percentile a value would have against a known distribution: { below, equal, population } (itself included). */
export const percentileOf = ({ below, equal, population }) => (population > 0 ? ((below + equal / 2) / population) * 100 : null);

/**
 * Each overall category's weight (0.8.0). `settings.weighting`:
 *   'sqrt'   (every grading from 0.8.0) the default weight of a category is proportional to the square root of how many
 *            of its statistics count toward the overall tier, so a category with 4 counts less than one with 27, but
 *            not 7 times less. `settings.weights` pins a percent for some categories ({ key: percent }); the rest
 *            share what is left in proportion to the same square roots. Pins for categories not in the overall tier
 *            are ignored. Every category pinned: the pins are scaled to add up to exactly 100.
 *   absent   a grading stored before 0.8.0: every category weighs the same, as it was graded then.
 * → [{ key, label, statistics, formula, pinned, weight }] in the plan's order, for overall categories only. formula
 *   and weight are fractions adding up to 1; pinned is the pinned percent or null.
 */
export function categoryWeights(plan, settings = {}) {
  const cats = plan.categories.filter((c) => c.inOverall);
  if (!cats.length) return [];
  const sq = cats.map((c) => Math.sqrt(c.overallIds.length));
  const sqSum = sq.reduce((a, b) => a + b, 0);
  const formula = sq.map((x) => (sqSum > 0 ? x / sqSum : 1 / cats.length));
  if (settings.weighting !== 'sqrt') {
    return cats.map((c, i) => ({ key: c.key, label: c.label, statistics: c.overallIds.length, formula: formula[i], pinned: null, weight: 1 / cats.length }));
  }
  const pins = settings.weights ?? {};
  const pinned = cats.map((c) => (Number.isFinite(pins[c.key]) ? pins[c.key] : null));
  const pinnedSum = pinned.reduce((a, p) => a + (p ?? 0), 0);
  const free = cats.map((_, i) => pinned[i] === null);
  let weight;
  if (!free.some(Boolean)) {
    weight = pinned.map((p) => (pinnedSum > 0 ? p / pinnedSum : 1 / cats.length));
  } else {
    const left = Math.max(0, 100 - pinnedSum) / 100;
    const freeSq = sq.reduce((a, x, i) => a + (free[i] ? x : 0), 0);
    const freeCount = free.filter(Boolean).length;
    weight = cats.map((_, i) => (free[i] ? left * (freeSq > 0 ? sq[i] / freeSq : 1 / freeCount) : pinned[i] / 100));
  }
  return cats.map((c, i) => ({ key: c.key, label: c.label, statistics: c.overallIds.length, formula: formula[i], pinned: pinned[i], weight: weight[i] }));
}

/**
 * Why a set of pins can't be used with this plan, in words, or null. Pins for categories that aren't in the overall
 * tier are allowed (kept, ignored) so a category that drops out and comes back keeps its pin.
 */
export function weightsProblem(plan, pins) {
  const cats = plan.categories.filter((c) => c.inOverall);
  const used = cats.filter((c) => Number.isFinite(pins?.[c.key]));
  const sum = used.reduce((a, c) => a + pins[c.key], 0);
  if (used.length && used.length === cats.length && Math.abs(sum - 100) > 0.05) return `Every category is pinned, so the pins must add up to 100% (they add up to ${Math.round(sum * 10) / 10}%).`;
  if (used.length < cats.length && sum >= 100) return `The pinned categories add up to ${Math.round(sum * 10) / 10}%, which leaves nothing for the ${cats.length - used.length} you didn’t pin. Keep the pins under 100%.`;
  return null;
}

/**
 * One character's category scores and overall score from its percentiles. `pctOf(statId)` and `nonzeroOf(statId)`
 * answer for each counted statistic. → { categories: [{ key, score, overallPart, nonzero, needed, counted,
 * eligible }], overallScore, overallCategories, overallNeeded, lettersNeededFrom }
 */
export function scoreCharacter(plan, settings, pctOf, nonzeroOf) {
  const categories = plan.categories.map((c) => {
    let sum = 0;
    let nonzero = 0;
    for (const id of c.statisticIds) {
      sum += pctOf(id);
      if (nonzeroOf(id)) nonzero += 1;
    }
    let osum = 0;
    for (const id of c.overallIds) osum += pctOf(id);
    const needed = atLeastShare(c.statisticIds.length, settings.categoryHalf);
    return {
      key: c.key,
      score: round6(sum / c.statisticIds.length),
      overallPart: c.overallIds.length ? round6(osum / c.overallIds.length) : null,
      nonzero,
      needed,
      counted: c.statisticIds.length,
      eligible: nonzero >= needed,
    };
  });
  const inOverall = plan.categories.map((c, i) => (c.inOverall ? categories[i] : null)).filter(Boolean);
  const weights = categoryWeights(plan, settings);
  const overallScore = inOverall.length ? round6(inOverall.reduce((n, c, i) => n + c.overallPart * weights[i].weight, 0)) : null;
  return { categories, overallScore, overallCategories: inOverall.length, overallNeeded: atLeastShare(inOverall.length, settings.overallHalf) };
}

/** Letters for a list of scores (null = not placed) → { letters: [], ranks: [], placed, cutoffs: { S: min score… } }. */
export function placeScores(scores, shares) {
  const placed = [];
  for (let i = 0; i < scores.length; i++) if (scores[i] !== null) placed.push(i);
  placed.sort((a, b) => scores[b] - scores[a]);
  const letters = new Array(scores.length).fill(null);
  const ranks = new Array(scores.length).fill(null);
  const cutoffs = Object.fromEntries(TIER_LETTERS.map((l) => [l, null]));
  const counts = Object.fromEntries(TIER_LETTERS.map((l) => [l, 0]));
  for (let k = 0; k < placed.length;) {
    let e = k;
    while (e < placed.length && scores[placed[e]] === scores[placed[k]]) e++;
    const rank = k + 1;
    const letter = tierForRank(rank, placed.length, shares);
    for (let j = k; j < e; j++) {
      letters[placed[j]] = letter;
      ranks[placed[j]] = rank;
    }
    counts[letter] += e - k;
    cutoffs[letter] = scores[placed[k]]; // descending: the last group seen in a letter is its lowest score
    k = e;
  }
  return { letters, ranks, placed: placed.length, cutoffs, counts };
}

/**
 * Grades one ruleset.
 *   characterIds  the tier-eligible characters (length n)
 *   valueOf(statId) → Float64Array(n) of their values (missing = 0), or null for all zeros
 *   plan          tiers/counting.js gradingPlan
 *   settings      { shares, minPopulation, categoryHalf, overallHalf }
 * → { population, graded, plan, characters: [...], scopes: { overall: { cutoffs, counts, placed }, [key]: … } }
 */
export function gradeRuleset({ characterIds, valueOf, plan, settings }) {
  const n = characterIds.length;
  if (!isGraded(n, settings.minPopulation)) return { population: n, graded: false, characters: [], scopes: {} };
  const statIds = plan.statisticIds;
  const index = new Map(statIds.map((id, j) => [id, j]));
  const pct = statIds.map((id) => {
    const v = valueOf(id);
    return v ? percentiles(v) : percentiles(new Float64Array(n));
  });
  const nonzero = statIds.map((id) => {
    const v = valueOf(id);
    const f = new Uint8Array(n);
    if (v) for (let i = 0; i < n; i++) f[i] = v[i] > 0 ? 1 : 0;
    return f;
  });
  const scored = characterIds.map((_, i) => scoreCharacter(plan, settings, (id) => pct[index.get(id)][i], (id) => nonzero[index.get(id)][i] === 1));

  const scopes = {};
  const catPlaced = plan.categories.map((c, ci) => {
    const placedScores = scored.map((s) => (s.categories[ci].eligible ? s.categories[ci].score : null));
    const r = placeScores(placedScores, settings.shares);
    scopes[c.key] = { cutoffs: r.cutoffs, counts: r.counts, placed: r.placed };
    return r;
  });
  const overallScores = scored.map((s, i) => {
    if (s.overallScore === null) return null;
    const lettered = plan.categories.reduce((k, c, ci) => k + (c.inOverall && catPlaced[ci].letters[i] ? 1 : 0), 0);
    return lettered >= s.overallNeeded ? s.overallScore : null;
  });
  const overall = placeScores(overallScores, settings.shares);
  scopes.overall = { cutoffs: overall.cutoffs, counts: overall.counts, placed: overall.placed };

  const characters = characterIds.map((id, i) => {
    const s = scored[i];
    const lettered = plan.categories.reduce((k, c, ci) => k + (c.inOverall && catPlaced[ci].letters[i] ? 1 : 0), 0);
    return {
      id,
      score: s.overallScore,
      letter: overall.letters[i],
      reason: overall.letters[i] ? null : s.overallScore === null ? 'no_categories' : 'few_categories',
      lettered,
      needed: s.overallNeeded,
      total: s.overallCategories,
      categories: s.categories.map((c, ci) => ({ ...c, letter: catPlaced[ci].letters[i] })),
      statIds,
      statPcts: statIds.map((_, j) => Math.round(pct[j][i] * 100) / 100),
    };
  });
  return { population: n, graded: true, characters, scopes };
}

/** Letters per scope for a graded ruleset: { overall: { S: n, …, unranked: n }, [key]: … } (the admin preview). */
export function distributionOf(result, plan) {
  const out = {};
  const tally = (letters) => {
    const t = Object.fromEntries([...TIER_LETTERS, 'unranked'].map((l) => [l, 0]));
    for (const l of letters) t[l ?? 'unranked'] += 1;
    return t;
  };
  out.overall = tally(result.characters.map((c) => c.letter));
  plan.categories.forEach((c, ci) => {
    out[c.key] = tally(result.characters.map((x) => x.categories[ci].letter));
  });
  return out;
}
