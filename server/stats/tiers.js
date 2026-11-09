/**
 * The letter tiers (settled spec, CLAUDE.md "Tiers"). Percentile WITHIN the character's own ruleset, where 0 is the
 * very top: S is the top 5 %, then A 15 %, B 30 %, C 30 %, D the bottom 20 %. Shared with the client
 * (client/src/stats/tiers.js imports this file), so the bands are written once.
 *
 * The bands are spec, not data, so they live in code. What feeds them (statistics, categories) comes from the
 * registry (stats/registry.js). Ungraded ("bad") statistics never reach this function.
 */
export const TIER_BANDS = Object.freeze([
  Object.freeze({ letter: 'S', share: 5 }),
  Object.freeze({ letter: 'A', share: 15 }),
  Object.freeze({ letter: 'B', share: 30 }),
  Object.freeze({ letter: 'C', share: 30 }),
  Object.freeze({ letter: 'D', share: 20 }),
]);

export const TIER_LETTERS = Object.freeze(TIER_BANDS.map((b) => b.letter));

/**
 * The letter for a rank. rank is 1-based (1 = best) among `population` graded characters of one ruleset.
 * Returns null when there is nothing to grade against.
 */
export function tierForRank(rank, population) {
  if (!Number.isInteger(rank) || !Number.isInteger(population) || population < 1 || rank < 1 || rank > population) return null;
  // The share of the ruleset strictly above this character, in percent: rank 1 is 0 %, so it is always S.
  const above = ((rank - 1) / population) * 100;
  let edge = 0;
  for (const band of TIER_BANDS) {
    edge += band.share;
    if (above < edge) return band.letter;
  }
  return TIER_BANDS.at(-1).letter;
}

/**
 * A ruleset is graded only once it has `minPopulation` tracked characters (admin setting grading.minPopulation,
 * default 500). Below that every character there shows "Unranked — grading opens at N tracked characters".
 */
export const isGraded = (population, minPopulation) => Number.isInteger(population) && population >= minPopulation;
