import { NATIVE_VERSION, PRIMARY_VERSION, versionById } from '../core/gameVersions.js';
import { HttpError } from '../core/errors.js';
import { clearCatalogCache, currentGroupDecisions, loadCatalogFresh } from '../stats/catalog.js';
import { GROUP_CHOICES, gradingPlan, whatCounts } from './counting.js';

/**
 * Tier decisions by GROUP (0.10.0, owner's decision). A group is a category label (Combat, Adventure … Collections,
 * PvP; tiers/counting.js applies the choices). Per game version the owner picks, for each group: 'counts' | 'category'
 * | 'none', in Discovery; one click covers every statistic in it, later ones included. Per-statistic decisions stay and
 * show as exceptions. Nothing is copied between versions: another version's groups start undecided, and Forever's
 * choices appear there only as a suggestion.
 *
 * migrateForever: Forever (the native version: its decisions predate groups) gets, ONCE, the choice that matches what
 * is approved in each group today, plus a 'group_exempt' marker on every statistic whose result the group choice would
 * otherwise change, so its tiers come out IDENTICAL. The plan (what counts, per category, overall or not) is compared
 * before and after inside the same transaction; any difference rolls everything back and nothing is marked done.
 */
export const MIGRATED_KEY = 'tier_groups_migrated_at';
const MIGRATION_REASON = 'Set by the 0.10.0 migration: the choice that matches the statistics approved in this group before group choices existed.';
const EXEMPT_REASON = 'Kept exactly as it was before group choices (0.10.0 migration): it follows its own decisions, not its group’s.';

/** What a plan says, in a form two plans can be compared by. */
export function planFingerprint(plan) {
  const sort = (xs) => [...xs].map(Number).sort((a, b) => a - b);
  return JSON.stringify({
    statisticIds: sort(plan.statisticIds),
    categories: [...plan.categories].sort((a, b) => a.key.localeCompare(b.key)).map((c) => ({
      key: c.key, farmable: c.farmable, inOverall: c.inOverall, statisticIds: sort(c.statisticIds), overallIds: sort(c.overallIds),
    })),
  });
}

/** Each statistic's result: role + grading + overall, for the before/after comparison. */
const resultOf = (counts) => new Map([...counts.statistics.values()].map((s) => [s.id, `${s.role}|${s.grading ?? ''}|${s.overall}`]));

/** The choice a group's OWN decisions support most: 'counts' | 'category' | 'none', or null when nothing in it is decided. */
export function majorityChoice(stats) {
  const tally = { counts: 0, category: 0, none: 0 };
  for (const s of stats) {
    if (s.via !== 'own') continue;
    if (s.role === 'counted') tally[s.grading === 'overall' ? 'counts' : 'category'] += 1;
    else if (s.role === 'bad' || s.role === 'named') tally.none += 1;
  }
  const best = Math.max(tally.counts, tally.category, tally.none);
  if (best === 0) return null;
  // A tie goes to the more cautious choice: a later statistic then counts only once the owner says so.
  return ['none', 'category', 'counts'].find((k) => tally[k] === best);
}

export async function migrateForever(db, { log = console } = {}) {
  if (await db.one('SELECT at FROM pipeline_facts WHERE key = $1', [MIGRATED_KEY])) return { done: false, why: 'already migrated' };
  const version = NATIVE_VERSION.id;
  const result = await db.tx(async (q) => {
    const claimed = await q.query('INSERT INTO pipeline_facts (key, at) VALUES ($1, now()) ON CONFLICT DO NOTHING RETURNING 1', [MIGRATED_KEY]);
    if (!claimed.length) return { done: false, why: 'already migrated' };
    clearCatalogCache();
    const before = await loadCatalogFresh(q, { version });
    if ((await currentGroupDecisions(q, version)).size) return { done: false, why: 'group choices already exist' };
    const countsBefore = whatCounts({ ...before, groups: new Map() });
    const planBefore = planFingerprint(gradingPlan(countsBefore));
    const resultsBefore = resultOf(countsBefore);

    // 1. each group's choice from what is approved in it
    const choices = [];
    for (const c of countsBefore.categories) {
      const stats = [...countsBefore.statistics.values()].filter((s) => s.category === c.label);
      const choice = majorityChoice(stats);
      if (!choice) continue;
      choices.push({ group: c.label, choice });
      await q.query(
        "INSERT INTO discovery_group_decisions (game_version, group_label, choice, reasoning, origin) VALUES ($1, $2, $3, $4, 'migration')",
        [version, c.label, choice, MIGRATION_REASON],
      );
    }
    // 2. every statistic the choices would change: exempt (it keeps its own decisions)
    const groups = await currentGroupDecisions(q, version);
    const countsMid = whatCounts({ ...before, groups });
    const exempt = [];
    for (const [id, was] of resultsBefore) {
      const now = resultOf(countsMid).get(id);
      if (now !== was) exempt.push(id);
    }
    for (const id of exempt) {
      await q.query(
        "INSERT INTO discovery_decisions (statistic_id, kind, value, decision, reasoning, game_version) VALUES ($1, 'group_exempt', $2::jsonb, 'approved', $3, $4)",
        [id, JSON.stringify({ migration: '0.10.0' }), EXEMPT_REASON, version],
      );
    }
    // 3. the proof: the same plan and the same result for every statistic, or nothing happened
    clearCatalogCache();
    const after = await loadCatalogFresh(q, { version });
    const countsAfter = whatCounts(after);
    const planAfter = planFingerprint(gradingPlan(countsAfter));
    const resultsAfter = resultOf(countsAfter);
    const differs = [...resultsBefore].filter(([id, r]) => resultsAfter.get(id) !== r).map(([id]) => id);
    if (planAfter !== planBefore || differs.length) {
      const err = new Error(`tier group migration would change what counts (${differs.length} statistic(s)); rolled back`);
      err.code = 'GROUP_MIGRATION_CHANGED_PLAN';
      throw err;
    }
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('tiers.groups_migrated', $1::jsonb)", [JSON.stringify({ version, groups: choices, exempt: exempt.length })]);
    return { done: true, groups: choices, exempt: exempt.length, statistics: resultsBefore.size };
  });
  clearCatalogCache();
  if (result.done) log.log?.(`[tiers] group choices set for ${version}: ${result.groups.length} group(s), ${result.exempt} exception(s); what counts is unchanged`);
  return result;
}

/** The worker calls this before each tier check: a no-op once done; a failure is logged and tried again later. */
export async function ensureGroupsMigrated(db, { log = console } = {}) {
  try {
    return await migrateForever(db, { log });
  } catch (err) {
    log.error(`[tiers] group migration refused: ${err.code ?? err.name}`);
    return { done: false, why: err.code ?? err.name };
  }
}

/** The owner's choice for one group of one version (Discovery). choice 'cleared' takes it back. */
export async function setGroupChoice(db, { version, group, choice, reasoning = '' }) {
  if (!versionById(version)) throw new HttpError(400, 'Unknown game version', 'invalid');
  if (![...Object.keys(GROUP_CHOICES), 'cleared'].includes(choice)) throw new HttpError(400, 'That isn’t a group choice.', 'invalid');
  const label = String(group ?? '').trim().slice(0, 80);
  if (!label) throw new HttpError(400, 'Which group?', 'invalid');
  await db.tx(async (q) => {
    await q.query('INSERT INTO discovery_group_decisions (game_version, group_label, choice, reasoning) VALUES ($1, $2, $3, $4)', [version, label, choice, String(reasoning).slice(0, 600)]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('discovery.group_decided', $1::jsonb)", [JSON.stringify({ version, group: label, choice, ...(String(reasoning ?? '').trim() ? { reason: String(reasoning).trim().slice(0, 500) } : {}) })]);
    const { requestTierRecompute } = await import('./store.js');
    await requestTierRecompute(q, `group ${label} (${version})`);
  });
  clearCatalogCache();
}

/**
 * Discovery's group list for a version: each group with its choice (or none), its statistics' results, the exceptions
 * to the choice, and the SUGGESTION: Forever's choice for the same group and how many of its statistic ids match
 * Forever's (Blizzard ids). Nothing is applied by this.
 */
export async function groupsView(db, version) {
  if (!versionById(version)) throw new HttpError(400, 'Unknown game version', 'invalid');
  const catalog = await loadCatalogFresh(db, { version });
  const counts = whatCounts(catalog);
  const groups = catalog.groups;
  const native = version === NATIVE_VERSION.id;
  const foreverGroups = native ? groups : await currentGroupDecisions(db, NATIVE_VERSION.id);
  const foreverIds = native ? null : new Set((await db.query(
    'SELECT blizzard_id FROM statistics WHERE game_version = $1 AND blizzard_id IS NOT NULL LIMIT 50000', [NATIVE_VERSION.id],
  )).map((r) => Number(r.blizzard_id)));
  const blizzardOf = native ? null : new Map((await db.query(
    'SELECT id, blizzard_id FROM statistics WHERE game_version = $1 AND blizzard_id IS NOT NULL LIMIT 50000', [version],
  )).map((r) => [Number(r.id), Number(r.blizzard_id)]));
  const list = counts.categories.map((c) => {
    const stats = [...counts.statistics.values()].filter((s) => s.category === c.label);
    const decided = groups.get(c.label) ?? null;
    const exceptions = stats.filter((s) => s.exception).map((s) => ({ id: s.id, name: s.name, role: s.role, grading: s.grading, via: s.via, reason: s.reason }));
    const fg = foreverGroups.get(c.label) ?? null;
    return {
      label: c.label, key: c.key, farmable: c.farmable, statistics: stats.length,
      choice: decided ? { choice: decided.choice, label: GROUP_CHOICES[decided.choice]?.label ?? decided.choice, origin: decided.origin, decidedAt: decided.decidedAt } : null,
      results: { counted: c.counted.length, overall: c.overall.length, bad: c.bad.length + c.named.length, duplicate: c.duplicate.length, undecided: c.undecided.length },
      exceptions,
      suggestion: native ? null : {
        forever: fg ? { choice: fg.choice, label: `Forever: ${GROUP_CHOICES[fg.choice]?.label.toLowerCase() ?? fg.choice}` } : { choice: null, label: 'Forever: undecided' },
        idsMatchingForever: stats.filter((s) => foreverIds.has(blizzardOf.get(Number(s.id)))).length,
      },
    };
  });
  return { version, primary: version === PRIMARY_VERSION.id, choices: Object.fromEntries(Object.entries(GROUP_CHOICES).map(([k, v]) => [k, v.label])), groups: list };
}
