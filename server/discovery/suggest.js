/**
 * Suggestions for each catalog statistic: SUGGEST, never assert. Three kinds, each { kind, value, reasoning,
 * evidence }; `value: null` means the samples can't settle it ("unknown from N samples") and there's nothing to
 * approve yet. The admin approves or rejects each on the Discovery page (discovery_decisions); a rejected suggestion
 * is not offered again. Nothing here creates a leaderboard or a tier category.
 *
 *   category     which Everstats tier category: Blizzard's own top-level grouping, which is the evidence we have
 *   bad          true for deaths and the like: a leaderboard, never part of a tier
 *   leaderboard  whether ranking characters on it means anything
 *
 * The rules are a list, so adding one is a declaration here.
 */
export const MIN_SAMPLES = 10; // below this many sampled characters, "everyone is zero" proves nothing

const BAD_RULES = [
  { re: /\bdeaths?\b/i, why: 'deaths' },
  { re: /\bdied\b/i, why: 'dying' },
  { re: /\bkilled by\b/i, why: 'being killed' },
  { re: /\bwipes?\b/i, why: 'wipes' },
  { re: /\bspirit healer\b/i, why: 'spirit-healer resurrections, which follow deaths' },
  { re: /\bdrown(?:ed|ing)?\b/i, why: 'drowning' },
  { re: /\bfatigue\b/i, why: 'fatigue' },
  { re: /\bfall(?:ing)? damage\b/i, why: 'falling damage' },
  { re: /\bresurrected\b/i, why: 'being resurrected, which follows deaths' },
];

const categoryLabel = (path) => path.map((c) => c.name).join(' › ');

function suggestCategory(s) {
  if (!s.categoryPath.length) {
    return { kind: 'category', value: null, reasoning: `Unknown from ${s.charactersPresent} samples: Blizzard gives it no category.`, evidence: { categoryPath: [] } };
  }
  const top = s.categoryPath[0];
  const more = s.categoryPath.length > 1 ? ` (in full: ${categoryLabel(s.categoryPath)})` : '';
  return {
    kind: 'category',
    value: top.name,
    reasoning: `Blizzard files it under "${top.name}"${more}, so it starts in the Everstats category of that name. Merge or rename categories by rejecting and deciding later.`,
    evidence: { categoryPath: s.categoryPath },
  };
}

function suggestBad(s) {
  const haystack = `${s.name} ${categoryLabel(s.categoryPath)}`;
  for (const r of BAD_RULES) {
    const m = r.re.exec(haystack);
    if (m) {
      return { kind: 'bad', value: true, reasoning: `Its name or category mentions "${m[0]}": it counts ${r.why}, which nobody should be graded up for. Leaderboard only, never a tier.`, evidence: { matched: m[0] } };
    }
  }
  return { kind: 'bad', value: false, reasoning: 'Nothing in its name or category suggests deaths or similar mishaps, so it can count toward a tier.', evidence: { matched: null } };
}

function suggestLeaderboard(s) {
  const n = s.charactersSampled;
  const evidence = { sampled: n, present: s.charactersPresent, nonzero: s.charactersNonzero, numeric: s.numericSamples, min: s.minValue, max: s.maxValue };
  if (s.numericSamples === 0) {
    return { kind: 'leaderboard', value: false, reasoning: `No sampled character has a number for it (${s.charactersPresent} of ${n} carry text only), so there's nothing to rank.`, evidence };
  }
  if (s.charactersNonzero === 0) {
    if (n < MIN_SAMPLES) return { kind: 'leaderboard', value: null, reasoning: `Zero for all ${s.numericSamples} sampled characters: unknown from ${n} samples whether anyone ever has it.`, evidence };
    return { kind: 'leaderboard', value: false, reasoning: `Zero for every one of the ${s.numericSamples} sampled characters that list it (of ${n}): near-zero for everyone.`, evidence };
  }
  if (s.minValue === s.maxValue && s.charactersPresent === n) {
    if (n < MIN_SAMPLES) return { kind: 'leaderboard', value: null, reasoning: `Every sampled character has the same value; unknown from ${n} samples whether it varies.`, evidence };
    return { kind: 'leaderboard', value: false, reasoning: `All ${n} sampled characters have the same value, so a ranking would be one long tie.`, evidence };
  }
  if (s.charactersNonzero === 1 && n >= MIN_SAMPLES) {
    return { kind: 'leaderboard', value: true, reasoning: `Only 1 of ${n} sampled characters has it, so it's rare; still a number that can be ranked. Worth a look before approving.`, evidence };
  }
  return { kind: 'leaderboard', value: true, reasoning: `A number that varies: non-zero for ${s.charactersNonzero} of ${n} sampled characters (from ${s.minValue} to ${s.maxValue}).`, evidence };
}

export const SUGGESTERS = [suggestCategory, suggestBad, suggestLeaderboard];

export const suggestionsFor = (stat) => SUGGESTERS.map((f) => f(stat));

/**
 * Applies the admin's current decisions to a statistic's suggestions: each gets `decision` (approved / rejected /
 * null) when the decision was made on the same value. A rejected value is `hidden` (not suggested again); a new
 * value (more samples changed the suggestion) is a fresh suggestion.
 */
export function withDecisions(suggestions, decisions) {
  return suggestions.map((s) => {
    const d = decisions.get(s.kind);
    const same = d && JSON.stringify(d.value) === JSON.stringify(s.value);
    if (!same || d.decision === 'cleared') return { ...s, decision: null, hidden: false };
    return { ...s, decision: d.decision, decidedAt: d.decidedAt, hidden: d.decision === 'rejected' };
  });
}
