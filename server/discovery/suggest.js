import { VALUE_TYPES } from './analyze.js';

/**
 * Suggestions for each catalog statistic: SUGGEST, never assert. Each is { kind, value, reasoning, evidence };
 * `value: null` means the samples can't settle it ("unknown from N samples") and there's nothing to approve yet. The
 * admin approves or rejects each on the Discovery page (discovery_decisions); a rejected suggestion is not offered
 * again. Nothing here creates a leaderboard or a tier category.
 *
 *   category     which Everstats category (CATEGORY_RULES, from Blizzard's own grouping and the name)
 *   grading      what the statistic counts toward:
 *                  'overall'   its category's tier AND the overall S–D tier
 *                  'category'  its category's tier only (shown on the character page), never the overall tier
 *                  'none'      no tier at all: a leaderboard only
 *   leaderboard  always true: every statistic gets a leaderboard; the reasoning says what the ranking looks like
 *   duplicate    { of: id }, only when the samples show it equal to another statistic: a POSSIBLE duplicate (or a
 *                likely one, when the names say the same thing too). Nothing is ungraded as a duplicate until the
 *                admin approves the pairing; then its grading suggestion becomes 'none'.
 *
 * Suggestions are computed when the catalog is read (present()), from the analysed row and the admin's current
 * decisions, so an approval takes effect at once and a value-type correction feeds the rules.
 *
 * The owner's decisions these rules encode (2026-11-09, after discovery runs 1 and 2):
 *   - Every statistic gets a leaderboard, ties, rare ones and name + number ones (ranked by their number) included.
 *   - "Bad" statistics (deaths and mishaps, duels lost) and Quests abandoned: leaderboard only, no tier.
 *   - Farmable categories (Social emotes; Times camped and hearthing) get their own category tier, shown on the
 *     character page, but are EXCLUDED from the overall tier.
 *   - Duplicates keep both leaderboards; one of a pair stops counting toward tiers only once the admin approves the
 *     pairing (0.3.2: equal values in low-level samples aren't proof, e.g. Professions learned / at maximum skill).
 * Rules match names and Blizzard categories, never statistic ids (a new statistic in a patch is still sorted).
 */
export const MIN_SAMPLES = 10; // below this many sampled characters, "everyone has the same value" proves little
export const DUPLICATE_MIN_PRESENT = 5; // equal values are only worth a suggestion if this many characters have both

const top = (s) => s.categoryPath[0]?.name ?? null;
const sub = (s) => s.categoryPath[1]?.name ?? null;
const categoryLabel = (path) => path.map((c) => c.name).join(' › ');

/** Everstats categories, first match wins. `farmable`: its tier never counts toward the overall tier. */
const derivedIs = (re) => (s) => typeof s.derived === 'string' && re.test(s.derived);
export const CATEGORY_RULES = [
  // 0.11.1 (owner's decision 3): every board EVERSTATS makes (statistics.derived: a collection count, a feed's number,
  // a season board) is filed in a group of its own, never among Blizzard's statistics, so one group choice covers the
  // whole kind and Blizzard's "Character" statistics don't share a group with 45 gear numbers. `derivedGroup` groups
  // start at "Doesn't count" (tiers/counting.js) on every version until the owner chooses otherwise in Discovery.
  { label: 'Season ratings', derivedGroup: true, test: derivedIs(/^season:|^feed:mythic-keystone-profile:/), why: () => 'Everstats makes it from Blizzard’s Mythic+ and PvP season answers; it starts over each season' },
  { label: 'Character stats (gear)', derivedGroup: true, test: derivedIs(/^feed:(?:profile|statistics|equipment):/), why: () => 'a number from the character’s profile or character-stats feed (level, item level, attributes): it follows gear' },
  { label: 'Reputations', derivedGroup: true, test: derivedIs(/^feed:reputations:/), why: () => 'one faction’s standing, from Blizzard’s reputations feed' },
  { label: 'Profession skills', derivedGroup: true, test: derivedIs(/^feed:professions:/), why: () => 'a profession’s skill, from Blizzard’s professions feed' },
  { label: 'Battleground maps', derivedGroup: true, test: derivedIs(/^feed:pvp-summary:/), why: () => 'one battleground map’s matches, from Blizzard’s PvP summary' },
  // 0.9.0: counts Everstats makes from Blizzard's collections (statistics.derived), never one of Blizzard's own; and
  // any other board Everstats makes (achievement totals, pet slots, decor).
  { label: 'Collections', derivedGroup: true, test: (s) => Boolean(s.derived), why: () => 'Everstats counts it from Blizzard’s collections (mounts, pets, toys, appearances …)' },
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

/** The groups made of boards Everstats makes (labels): their group choice starts at "Doesn't count". */
export const DERIVED_GROUPS = Object.freeze(CATEGORY_RULES.filter((r) => r.derivedGroup).map((r) => r.label));

export function categoryFor(s) {
  for (const rule of CATEGORY_RULES) if (rule.test(s)) return { rule, why: rule.why(s) };
  return null;
}

// Words that don't change what a statistic counts, for comparing names. Qualifiers that narrow or widen a count
// ("world", "battleground", "and other things") are NOT filler: World Honorable Kills is part of Total Honorable Kills
// (run 2: 7 world + 26 battleground = 33 total), and "Fish and other things caught" counts more than fish. A name
// match only raises a suggestion's confidence; the values must be equal as well.
const NAME_FILLER = new Set(['total', 'the', 'of', 'a', 'an', 'number', 'times']);
const nameCore = (name) => new Set(String(name).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w && !NAME_FILLER.has(w)));
/** True when two names say the same thing once filler words are dropped ("Total deaths" / "Deaths"). */
export function namesMatch(a, b) {
  const x = nameCore(a);
  const y = nameCore(b);
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
}

/**
 * Possible duplicates: statistics whose per-character values are identical for every character that has either, with
 * at least DUPLICATE_MIN_PRESENT characters and at least two different values among them (a column of zeros matches
 * every other column of zeros). Map(statisticId → duplicate info), stored on each catalog row as `duplicate`:
 *   { role: 'candidate', of, ofName, confidence: 'possible' | 'likely', present, nonzero, distinct, group }
 *   { role: 'primary', group }   the one that keeps counting if the admin approves the others' pairings
 * The primary is the lowest id that isn't a name + number statistic. Needs `valuesBySubject` (analyze.js rows).
 * Equal values are evidence, not proof: these become suggestions the admin approves or rejects.
 */
export function findDuplicateCandidates(catalog) {
  const groups = new Map();
  for (const s of catalog) {
    const v = s.valuesBySubject;
    if (!v || v.size < DUPLICATE_MIN_PRESENT || s.charactersPresent !== v.size || new Set(v.values()).size < 2) continue;
    const sig = JSON.stringify([...v].sort(([a], [b]) => (a < b ? -1 : 1)));
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(s);
  }
  const out = new Map();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => (a.valueType === 'name-and-number') - (b.valueType === 'name-and-number') || a.statisticId - b.statisticId);
    const primary = ranked[0];
    const group = members.map((x) => x.statisticId).sort((a, b) => a - b);
    out.set(primary.statisticId, { role: 'primary', group });
    for (const m of ranked.slice(1)) {
      out.set(m.statisticId, {
        role: 'candidate', of: primary.statisticId, ofName: primary.name, confidence: namesMatch(m.name, primary.name) ? 'likely' : 'possible',
        present: m.charactersPresent, nonzero: m.charactersNonzero, distinct: new Set(m.valuesBySubject.values()).size, group,
      });
    }
  }
  return out;
}

/** The admin's value-type correction, if any, applied over the analysis's guess. */
export function effectiveValueType(stat, decisions) {
  const d = decisions.get('value_type');
  if (d?.decision === 'approved' && VALUE_TYPES.includes(d.value)) {
    const same = d.value === stat.valueType;
    return { valueType: d.value, valueTypeBasis: same ? `confirmed by you (the analysis guessed the same: ${stat.valueTypeBasis})` : `set by you (the analysis said "${stat.valueType}": ${stat.valueTypeBasis})`, valueTypeGuessed: false, valueTypeSetBy: 'admin', analysedValueType: stat.valueType };
  }
  return { valueType: stat.valueType, valueTypeBasis: stat.valueTypeBasis, valueTypeGuessed: stat.valueTypeGuessed !== false, valueTypeSetBy: 'analysis', analysedValueType: stat.valueType };
}

const approvedDuplicate = (decisions) => {
  const d = decisions.get('duplicate');
  return d?.decision === 'approved' && Number.isSafeInteger(d.value?.of) ? d.value.of : null;
};

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
  if (s.derived && String(s.derived).startsWith('feed:')) {
    return { kind: 'grading', value: 'none', reasoning: 'A number Blizzard returns in one of its feeds (0.10.0: every feed is a leaderboard). A leaderboard only: it counts toward nothing until you approve "overall" or "category" here.', evidence: { ...evidence, derived: s.derived } };
  }
  if (s.derived) {
    return { kind: 'grading', value: 'none', reasoning: 'A collection count (0.9.0): the collections design keeps these as leaderboards and pinnable counts, not graded, and some are shared across a Battle.net account. It counts toward nothing until you approve "overall" or "category" here.', evidence: { ...evidence, derived: s.derived } };
  }
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
  const approvedOf = approvedDuplicate(ctx.decisions ?? new Map());
  if (approvedOf !== null) {
    return { kind: 'grading', value: 'none', reasoning: `You approved it as a duplicate of id ${approvedOf}, so only that one counts toward tiers. It keeps its own leaderboard.`, evidence: { ...evidence, duplicateOf: approvedOf } };
  }
  const c = categoryFor(s);
  const dup = s.duplicate ?? null;
  const pending = dup?.role === 'candidate' ? ` It may be a duplicate of "${dup.ofName}" (id ${dup.of}): if you approve that pairing, this one stops counting.` : '';
  if (c?.rule.farmable) {
    return { kind: 'grading', value: 'category', reasoning: `Counts toward its own "${c.rule.label}" tier on the character page, but not the overall tier: anyone can raise it at will.${pending}`, evidence: { ...evidence, category: c.rule.label } };
  }
  return { kind: 'grading', value: 'overall', reasoning: `Counts toward its category's tier and the overall tier.${pending}`, evidence };
}

function suggestDuplicate(s, ctx) {
  const dup = s.duplicate ?? null;
  const approvedOf = approvedDuplicate(ctx.decisions ?? new Map());
  if (dup?.role === 'candidate') {
    const why = dup.confidence === 'likely'
      ? `Likely the same thing as "${dup.ofName}" (id ${dup.of}): the names say so, and the values are identical`
      : `Possibly the same as "${dup.ofName}" (id ${dup.of}): the values are identical, but the names differ, so this may only hold for these samples`;
    return {
      kind: 'duplicate', value: { of: dup.of },
      reasoning: `${why} for all ${dup.present} characters that have either (${dup.nonzero} non-zero, ${dup.distinct} different values). Unknown from ${dup.present} samples whether they ever differ. Approve to stop counting this one toward tiers; both keep their leaderboards.`,
      evidence: { of: dup.of, confidence: dup.confidence, present: dup.present, nonzero: dup.nonzero, distinct: dup.distinct, group: dup.group },
    };
  }
  if (approvedOf !== null) {
    // The admin's approval stands; the evidence for it no longer does. Say so, so it can be undone.
    return { kind: 'duplicate', value: { of: approvedOf }, stale: true, reasoning: `You approved this as a duplicate of id ${approvedOf}, but the current samples no longer support it (their values differ, or fewer than ${DUPLICATE_MIN_PRESENT} characters have both). Consider undoing it.`, evidence: { of: approvedOf } };
  }
  return null;
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

export const SUGGESTERS = [suggestCategory, suggestGrading, suggestLeaderboard, suggestDuplicate];
export const SUGGESTION_KINDS = ['category', 'grading', 'leaderboard', 'duplicate'];

/**
 * Suggestions for one statistic (a catalog row with its `duplicate` info). `ctx.decisions` is the admin's current
 * decisions for it, Map(kind → { value, decision }); suggesters that have nothing to say return null.
 */
export const suggestionsFor = (stat, ctx = {}) => SUGGESTERS.map((f) => f(stat, ctx)).filter(Boolean);

/**
 * A catalog row as the Discovery page shows it: the admin's value-type correction applied, suggestions computed with
 * the current decisions, and each suggestion marked with its decision.
 */
export function present(row, decisions = new Map()) {
  const stat = { ...row, ...effectiveValueType(row, decisions) };
  const vt = decisions.get('value_type');
  return {
    ...stat,
    valueTypeDecidedAt: vt?.decision === 'approved' ? vt.decidedAt ?? null : null,
    suggestions: withDecisions(suggestionsFor(stat, { decisions }), decisions),
  };
}

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
