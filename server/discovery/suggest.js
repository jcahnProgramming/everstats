/**
 * Suggestions for each catalog statistic: SUGGEST, never assert. Three kinds, each { kind, value, reasoning,
 * evidence }; `value: null` means the samples can't settle it ("unknown from N samples") and there's nothing to
 * approve yet. The admin approves or rejects each on the Discovery page (discovery_decisions); a rejected suggestion
 * is not offered again. Nothing here creates a leaderboard or a tier category.
 *
 *   category     which Everstats category (CATEGORY_RULES, from Blizzard's own grouping and the name)
 *   grading      what the statistic counts toward:
 *                  'overall'   its category's tier AND the overall S–D tier
 *                  'category'  its category's tier only (shown on the character page), never the overall tier
 *                  'none'      no tier at all: a leaderboard only
 *   leaderboard  always true: every statistic gets a leaderboard; the reasoning says what the ranking looks like
 *
 * The owner's decisions these rules encode (2026-11-09, after discovery run 1):
 *   - Every statistic gets a leaderboard, ties, rare ones and name + number ones (ranked by their number) included.
 *   - "Bad" statistics (deaths and mishaps, duels lost) and Quests abandoned: leaderboard only, no tier.
 *   - Farmable categories (Social emotes; Times camped and hearthing) get their own category tier, shown on the
 *     character page, but are EXCLUDED from the overall tier.
 *   - Exact duplicates keep both leaderboards; only one of each group is graded.
 * Rules match names and Blizzard categories, never statistic ids (a new statistic in a patch is still sorted).
 */
export const MIN_SAMPLES = 10; // below this many sampled characters, "everyone has the same value" proves little
export const DUPLICATE_MIN_PRESENT = 5; // two statistics count as duplicates only if this many characters have them

const top = (s) => s.categoryPath[0]?.name ?? null;
const sub = (s) => s.categoryPath[1]?.name ?? null;
const categoryLabel = (path) => path.map((c) => c.name).join(' › ');

/** Everstats categories, first match wins. `farmable`: its tier never counts toward the overall tier. */
export const CATEGORY_RULES = [
  { label: 'Deaths & mishaps', test: (s) => top(s) === 'Deaths' || BAD_RULES.some((r) => r.re.test(s.name)), why: (s) => (top(s) === 'Deaths' ? 'Blizzard files it under "Deaths"' : 'it counts deaths or losses') },
  { label: 'Social', farmable: true, test: (s) => top(s) === 'Social', why: () => 'Blizzard files it under "Social" (emotes)' },
  { label: 'Camping & Hearth', farmable: true, test: (s) => /\bcamped\b|\bhearth(?:ed|stone)?\b/i.test(s.name), why: () => 'it counts camps or hearthstone uses' },
  { label: 'PvP', test: (s) => top(s) === 'Player vs. Player' || sub(s) === 'Honorable Kills', why: (s) => `Blizzard files it under "${categoryLabel(s.categoryPath)}"` },
  { label: 'Combat', test: (s) => top(s) === 'Kills', why: (s) => `Blizzard files it under "${categoryLabel(s.categoryPath)}"` },
  { label: 'Adventure', test: (s) => top(s) === 'Quests' || top(s) === 'Travel', why: (s) => `Blizzard files it under "${top(s)}"` },
  { label: 'Professions', test: (s) => top(s) === 'Skills', why: (s) => `Blizzard files it under "${categoryLabel(s.categoryPath)}"` },
  { label: 'Dungeons & Raids', test: (s) => top(s) === 'Dungeons & Raids', why: (s) => `Blizzard files it under "${categoryLabel(s.categoryPath)}"` },
  { label: 'Character', test: (s) => top(s) === 'Character', why: (s) => `Blizzard files it under "${categoryLabel(s.categoryPath)}"` },
];

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
  { re: /\b(?:duels?|battles?|matches|arenas?|battlegrounds?) lost\b/i, why: 'losses' },
];

export function categoryFor(s) {
  for (const rule of CATEGORY_RULES) if (rule.test(s)) return { rule, why: rule.why(s) };
  return null;
}

/**
 * Exact duplicates: statistics whose per-character values are identical for every character that has either, with
 * at least DUPLICATE_MIN_PRESENT characters. Map(statisticId → { graded: id, graded name, group: [ids] }). The graded
 * one is the lowest id that isn't a name + number statistic. Needs `valuesBySubject` (analyze.js catalog rows).
 */
export function findDuplicates(catalog) {
  const groups = new Map();
  for (const s of catalog) {
    if (!s.valuesBySubject || s.valuesBySubject.size < DUPLICATE_MIN_PRESENT || s.charactersPresent !== s.valuesBySubject.size) continue;
    const sig = JSON.stringify([...s.valuesBySubject].sort(([a], [b]) => (a < b ? -1 : 1)));
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(s);
  }
  const out = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => (a.valueType === 'name-and-number') - (b.valueType === 'name-and-number') || a.statisticId - b.statisticId);
    const graded = ranked[0];
    for (const m of members) out.set(m.statisticId, { gradedId: graded.statisticId, gradedName: graded.name, group: members.map((x) => x.statisticId), present: m.charactersPresent });
  }
  return out;
}

function suggestCategory(s) {
  const c = categoryFor(s);
  if (!c) {
    if (!s.categoryPath.length) return { kind: 'category', value: null, reasoning: `Unknown from ${s.charactersPresent} samples: Blizzard gives it no category and no rule matches its name.`, evidence: { categoryPath: [] } };
    return { kind: 'category', value: top(s), reasoning: `No Everstats rule matches, so it starts in a category named after Blizzard's "${top(s)}".`, evidence: { categoryPath: s.categoryPath } };
  }
  const farm = c.rule.farmable ? ' A farmable category: its tier shows on the character page but never counts toward the overall tier.' : '';
  return { kind: 'category', value: c.rule.label, reasoning: `"${c.rule.label}", because ${c.why}.${farm}`, evidence: { categoryPath: s.categoryPath, farmable: Boolean(c.rule.farmable) } };
}

function suggestGrading(s, ctx) {
  const evidence = { categoryPath: s.categoryPath };
  const haystack = `${s.name} ${categoryLabel(s.categoryPath)}`;
  for (const r of BAD_RULES) {
    const m = r.re.exec(haystack);
    if (m) return { kind: 'grading', value: 'none', reasoning: `A "bad" statistic: it mentions "${m[0]}", so it counts ${r.why}, which nobody should be graded up for. Leaderboard only, no tier.`, evidence: { ...evidence, matched: m[0] } };
  }
  if (/\babandon(?:ed|s)?\b/i.test(s.name)) {
    return { kind: 'grading', value: 'none', reasoning: 'Abandoning quests isn\'t progress, so it gets a leaderboard but no tier.', evidence };
  }
  if (s.valueType === 'name-and-number') {
    return { kind: 'grading', value: 'none', reasoning: `A name + number statistic: its number counts a different thing for each character (one counts "${s.namedExample ?? 'one thing'}", another something else), so it can't be graded fairly. Its leaderboard ranks by the number.`, evidence: { ...evidence, namedExample: s.namedExample ?? null } };
  }
  const dup = ctx.duplicates?.get(s.statisticId);
  if (dup && dup.gradedId !== s.statisticId) {
    return { kind: 'grading', value: 'none', reasoning: `An exact duplicate of "${dup.gradedName}" (id ${dup.gradedId}): identical for all ${dup.present} characters that have either. Both keep their leaderboards; only "${dup.gradedName}" is graded. Unknown from ${dup.present} samples whether they ever differ.`, evidence: { ...evidence, duplicateOf: dup.gradedId, group: dup.group } };
  }
  const c = categoryFor(s);
  if (c?.rule.farmable) {
    return { kind: 'grading', value: 'category', reasoning: `Counts toward its own "${c.rule.label}" tier on the character page, but not the overall tier: anyone can raise it at will.`, evidence: { ...evidence, category: c.rule.label } };
  }
  const also = dup ? ` (It has exact duplicates, ids ${dup.group.filter((id) => id !== s.statisticId).join(', ')}; this one is the graded one.)` : '';
  return { kind: 'grading', value: 'overall', reasoning: `Counts toward its category's tier and the overall tier.${also}`, evidence };
}

function suggestLeaderboard(s) {
  const n = s.charactersSampled;
  const evidence = { sampled: n, present: s.charactersPresent, nonzero: s.charactersNonzero, numeric: s.numericSamples, min: s.minValue, max: s.maxValue };
  const every = 'Every statistic gets a leaderboard.';
  if (s.numericSamples === 0) return { kind: 'leaderboard', value: true, reasoning: `${every} No sampled character has a number for it yet (${s.charactersPresent} of ${n} carry text only), so it can't be ranked until one does.`, evidence };
  if (s.valueType === 'name-and-number') return { kind: 'leaderboard', value: true, reasoning: `${every} Ranked by its number (e.g. ${s.maxValue} at the top of the samples); the name is shown beside it.`, evidence };
  if (s.minValue === s.maxValue && s.charactersPresent === n) return { kind: 'leaderboard', value: true, reasoning: `${every} For now all ${n} sampled characters have the same value (${s.minValue}), so it's one long tie until wider samples spread it.`, evidence };
  if (s.charactersNonzero <= Math.max(1, Math.floor(n / 10))) return { kind: 'leaderboard', value: true, reasoning: `${every} Rare so far: non-zero for ${s.charactersNonzero} of ${n} sampled characters.`, evidence };
  return { kind: 'leaderboard', value: true, reasoning: `${every} It varies: non-zero for ${s.charactersNonzero} of ${n} sampled characters (from ${s.minValue} to ${s.maxValue}).`, evidence };
}

export const SUGGESTERS = [suggestCategory, suggestGrading, suggestLeaderboard];

/** Suggestions for one statistic. `ctx.duplicates` comes from findDuplicates over the whole run's catalog. */
export const suggestionsFor = (stat, ctx = {}) => SUGGESTERS.map((f) => f(stat, ctx));

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
