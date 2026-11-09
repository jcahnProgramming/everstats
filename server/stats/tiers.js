/**
 * The letter tiers (settled spec, CLAUDE.md "Tiers"). Shared with the client (client/src/components/Tier.jsx imports
 * this file), so the letters and the banding are written once. Pure functions only: no database, no settings store.
 *
 * Letters come from where a SCORE places among everyone's scores on the same ruleset: S the top 5 %, then A 15 %,
 * B 30 %, C 30 %, D the bottom 20 % by default. The shares are an admin setting (tiers.shares, 0.6.0) and must add up
 * to 100; DEFAULT_SHARES is its default. The same shares apply to category tiers and the overall tier.
 *
 * Scores and percentiles are 0–100, higher is better (server/tiers/engine.js computes them).
 */
export const TIER_LETTERS = Object.freeze(['S', 'A', 'B', 'C', 'D']);
export const DEFAULT_SHARES = Object.freeze({ S: 5, A: 15, B: 30, C: 30, D: 20 });

/** [{ letter, share }] in letter order, from a shares object. */
export const bandsOf = (shares = DEFAULT_SHARES) => TIER_LETTERS.map((letter) => ({ letter, share: shares[letter] }));

/** The default bands, for anything that only describes the rule. */
export const TIER_BANDS = Object.freeze(bandsOf(DEFAULT_SHARES).map((b) => Object.freeze(b)));

/** A problem with a shares object, in plain words, or null when it is valid (whole percents, adding up to 100). */
export function sharesProblem(shares) {
  if (!shares || typeof shares !== 'object') return 'Give a share for each letter.';
  for (const l of TIER_LETTERS) {
    if (!Number.isInteger(shares[l]) || shares[l] < 0 || shares[l] > 100) return `The ${l} share must be a whole percent from 0 to 100.`;
  }
  const sum = TIER_LETTERS.reduce((n, l) => n + shares[l], 0);
  if (sum !== 100) return `The five shares must add up to 100 (they add up to ${sum}).`;
  return null;
}

/**
 * The letter for a rank. rank is 1-based (1 = best; tied characters share a rank: 1 + how many are strictly above)
 * among `population` characters with a score. Returns null when there is nothing to grade against.
 */
export function tierForRank(rank, population, shares = DEFAULT_SHARES) {
  if (!Number.isInteger(rank) || !Number.isInteger(population) || population < 1 || rank < 1 || rank > population) return null;
  // The share of the ruleset strictly above this character, in percent: rank 1 is 0 %, so it gets the first letter
  // whose share isn't zero.
  const above = ((rank - 1) / population) * 100;
  let edge = 0;
  for (const band of bandsOf(shares)) {
    edge += band.share;
    if (above < edge) return band.letter;
  }
  return TIER_LETTERS.at(-1);
}

/**
 * The letter for a score placed against a ruleset's cutoffs (the lowest score that earned each letter at the last full
 * grading: { S: 91.2, A: 74.0, … }, a letter nobody earned is null). The best letter whose cutoff the score reaches;
 * below every cutoff is the last letter. Used for a single character graded between full gradings.
 */
export function letterForScore(score, cutoffs) {
  if (!Number.isFinite(score) || !cutoffs) return null;
  for (const l of TIER_LETTERS) {
    if (Number.isFinite(cutoffs[l]) && score >= cutoffs[l]) return l;
  }
  return TIER_LETTERS.filter((l) => Number.isFinite(cutoffs[l])).at(-1) ?? null;
}

/** "Top 5%", "Next 15% (5–20%)", "Bottom 20%": what a letter means, in words. */
export function bandRanges(shares = DEFAULT_SHARES) {
  let from = 0;
  return bandsOf(shares).map((b) => {
    const range = from === 0 ? `Top ${b.share}%` : from + b.share === 100 ? `Bottom ${b.share}%` : `Next ${b.share}% (${from}–${from + b.share}%)`;
    from += b.share;
    return { ...b, range };
  });
}

/** How many of `total` things "at least `percent` %" means: rounded up, and at least 1 when there is anything. */
export const atLeastShare = (total, percent) => (total > 0 ? Math.max(1, Math.ceil((total * percent) / 100 - 1e-9)) : 0);

/**
 * A ruleset is graded only once it has `minPopulation` tier-eligible characters (admin setting grading.minPopulation,
 * default 50 since 0.6.0). Below that every character there is Unranked, with the count so far.
 */
export const isGraded = (population, minPopulation) => Number.isInteger(population) && population >= minPopulation;

/**
 * A tier distribution bar's segments (0.9.0: guild "Members by tier", the guild share card). RANKED members only, as
 * S/A/B/C/D proportions: Unranked is never a segment (it filled most of the bar as one block) and never folds into D;
 * callers say it on its own line. Every non-zero letter gets at least `minPct` % of the bar so its letter and count
 * read ("S 1"); the rest share what's left in proportion. letters: { S, A, B, C, D } counts.
 *   → { ranked, parts: [{ letter, n, pct }] }  (pct sums to 100 when ranked > 0)
 */
export function tierBarParts(letters, { minPct = 9 } = {}) {
  const list = TIER_LETTERS.map((letter) => ({ letter, n: Math.max(0, Number(letters?.[letter]) || 0) })).filter((p) => p.n > 0);
  const ranked = list.reduce((s, p) => s + p.n, 0);
  if (!ranked) return { ranked: 0, parts: [] };
  const floor = Math.min(minPct, 100 / list.length);
  // Letters whose share is under the floor get the floor; the others share the rest by their counts (repeat until
  // stable, since lifting one can push another under).
  const fixed = new Set();
  for (let i = 0; i < list.length; i++) {
    const free = list.filter((p) => !fixed.has(p.letter));
    const room = 100 - fixed.size * floor;
    const n = free.reduce((s, p) => s + p.n, 0);
    const under = free.filter((p) => (p.n / n) * room < floor);
    if (!under.length) break;
    for (const p of under) fixed.add(p.letter);
  }
  const free = list.filter((p) => !fixed.has(p.letter));
  const room = 100 - fixed.size * floor;
  const n = free.reduce((s, p) => s + p.n, 0);
  const parts = list.map((p) => ({ letter: p.letter, n: p.n, pct: Math.round((fixed.has(p.letter) ? floor : (p.n / n) * room) * 10) / 10 }));
  return { ranked, parts };
}
