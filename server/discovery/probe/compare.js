import { statisticsIn } from '../analyze.js';
import { CATEGORY_RULES, categoryFor } from '../suggest.js';
import { FEEDS, numericFields } from '../../stats/feeds.js';
import { COUNTS, FAMILIES, KINDS } from '../../collections/registry.js';
import { parseMedia } from '../../crawler/parse.js';

/**
 * The 0.10.0 probe's comparisons, from stored responses only (re-analyse asks Blizzard nothing):
 *   statisticCatalog(json)                 the version's statistics as its achievement-statistics answer lists them
 *   compareStatistics(here, forever)       shared / new / missing ids and the category trees, against Forever's catalog
 *   groupSuggestions(…)                    every group with Forever's choice as a SUGGESTION (nothing is applied)
 *   boardsFrom(…)                          every board rule A7 would make (stats/feeds.js), by group, and the skip list
 *   renderCheck(…)                         the render URLs beside the race Blizzard names (only the admin's eyes decide)
 * Nothing here writes anything.
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
export const OTHER_GROUP = 'Other';
const KNOWN_GROUPS = new Set(CATEGORY_RULES.map((r) => r.label));

/** [{ id, name, categoryPath: [{ id, name }] }] from an achievement-statistics answer (the first of each id). */
export function statisticCatalog(json) {
  const seen = new Set();
  const out = [];
  for (const s of statisticsIn(json)) {
    if (!Number.isSafeInteger(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: String(s.name).slice(0, 200), categoryPath: (s.categoryPath ?? []).map((c) => ({ id: c.id ?? null, name: String(c.name ?? '').slice(0, 100) })) });
  }
  return out;
}

/** The group a statistic falls in: Forever's category rules, else Blizzard's top category (a PROPOSED new group). */
export function groupOf(stat) {
  const hit = categoryFor({ name: stat.name, categoryPath: stat.categoryPath ?? [], derived: null });
  if (hit) return { label: hit.rule.label, proposed: false, why: hit.why };
  const top = stat.categoryPath?.[0]?.name;
  if (top) return { label: top, proposed: !KNOWN_GROUPS.has(top), why: `Blizzard files it under "${top}", which no Everstats group covers yet` };
  return { label: OTHER_GROUP, proposed: !KNOWN_GROUPS.has(OTHER_GROUP), why: 'Blizzard gives it no category' };
}

const topNames = (list) => [...new Set(list.map((s) => s.categoryPath?.[0]?.name).filter(Boolean))].sort();

/**
 * `here`: the probed version's catalog; `forever`: Forever's production statistics [{ blizzardId, name, categoryPath }].
 * Ids are Blizzard's on both sides. Names compared exactly (case-insensitive).
 */
export function compareStatistics(here, forever) {
  const byId = new Map(forever.map((f) => [Number(f.blizzardId), f]));
  const hereIds = new Set(here.map((s) => s.id));
  const shared = here.filter((s) => byId.has(s.id));
  const renamed = shared.filter((s) => String(byId.get(s.id).name ?? '').toLowerCase() !== s.name.toLowerCase());
  const fresh = here.filter((s) => !byId.has(s.id));
  const missing = forever.filter((f) => !hereIds.has(Number(f.blizzardId)));
  const ht = topNames(here);
  const ft = topNames(forever);
  return {
    probed: here.length,
    forever: forever.length,
    shared: shared.length,
    sharedSameName: shared.length - renamed.length,
    sharedRenamed: renamed.map((s) => ({ id: s.id, here: s.name, forever: byId.get(s.id).name })),
    new: fresh.map((s) => ({ id: s.id, name: s.name, category: s.categoryPath.map((c) => c.name).join(' › ') })),
    missing: missing.map((f) => ({ id: Number(f.blizzardId), name: f.name, category: (f.categoryPath ?? []).map((c) => c.name).join(' › ') })),
    categories: { here: ht, forever: ft, both: ht.filter((x) => ft.includes(x)), onlyHere: ht.filter((x) => !ft.includes(x)), onlyForever: ft.filter((x) => !ht.includes(x)) },
  };
}

const CHOICE_WORDS = {
  counts: 'Forever counts this group',
  category: 'Forever: own letter only',
  none: 'Forever: doesn’t count',
  undecided: 'Forever: undecided',
  absent: 'Forever has no such group',
};

/**
 * Forever's stance on one group: its group choice when it has one; else what its per-statistic roles add up to
 * (the majority of its decided statistics, with the counts), else undecided.
 */
function foreverStance(label, { groups, roles }) {
  const g = groups.get(label);
  if (g) return { choice: g.choice, text: CHOICE_WORDS[g.choice], basis: `Forever's group choice (${g.origin === 'migration' ? 'carried over from its statistic decisions' : 'chosen on the Discovery page'})` };
  const r = roles.get(label);
  if (!r) return { choice: 'absent', text: CHOICE_WORDS.absent, basis: 'Forever has no statistics in this group' };
  const tally = { counts: r.overall, category: r.categoryOnly, none: r.none };
  const decided = tally.counts + tally.category + tally.none;
  if (!decided) return { choice: 'undecided', text: CHOICE_WORDS.undecided, basis: `none of Forever's ${r.total} statistics here is decided` };
  const choice = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  return { choice, text: CHOICE_WORDS[choice], basis: `Forever's statistics here: ${tally.counts} count, ${tally.category} own letter only, ${tally.none} don't count, ${r.undecided} undecided` };
}

/**
 * Forever's per-statistic roles by category, from its live catalog: Map(label → { total, overall, categoryOnly, none,
 * undecided }). `statistics`: the loadCatalog() statistics map.
 */
export function rolesByGroup(statistics) {
  const out = new Map();
  for (const s of statistics.values()) {
    if (s.name === null) continue;
    const r = out.get(s.category) ?? { total: 0, overall: 0, categoryOnly: 0, none: 0, undecided: 0 };
    r.total += 1;
    if (s.tierRole === 'counted') {
      if (s.countsOverall) r.overall += 1;
      else r.categoryOnly += 1;
    } else if (s.tierRole === 'bad' || s.tierRole === 'named') r.none += 1;
    else r.undecided += 1;
    out.set(s.category, r);
  }
  return out;
}

/**
 * Every group the probed version has, with Forever's stance as the suggestion. `boards`: boardsFrom() (adds groups
 * that come only from feeds: Reputation, Mythic+, Guild …). Suggestions only: nothing is chosen for the version.
 */
export function groupSuggestions({ here, foreverIds, groups, roles, boards = null }) {
  const by = new Map();
  const add = (label, proposed) => {
    if (!by.has(label)) by.set(label, { label, proposed, statistics: 0, matchForever: 0, boards: 0 });
    return by.get(label);
  };
  for (const s of here) {
    const g = groupOf(s);
    const e = add(g.label, g.proposed);
    e.statistics += 1;
    if (foreverIds.has(s.id)) e.matchForever += 1;
  }
  for (const b of boards?.groups ?? []) add(b.group, !KNOWN_GROUPS.has(b.group)).boards += b.boards;
  return [...by.values()].map((e) => {
    const stance = foreverStance(e.label, { groups, roles });
    return {
      ...e,
      forever: stance,
      suggestion: `${stance.text}${e.statistics ? ` · ${e.matchForever} of ${e.statistics} statistic ids match Forever's` : ''}`,
      applied: false,
    };
  }).sort((a, b) => (b.statistics + b.boards) - (a.statistics + a.boards) || a.label.localeCompare(b.label));
}

/** Probe entry → stats/feeds.js feed id. */
export const FEED_ENTRIES = Object.freeze({
  'character.profile': 'profile', 'character.statistics': 'statistics', 'character.equipment': 'equipment',
  'character.reputations': 'reputations', 'character.professions': 'professions', 'character.pvp-summary': 'pvp-summary',
  'character.mythic-keystone-profile': 'mythic-keystone-profile', 'character.achievements': 'achievements',
  'character.collections-pets': 'collections-pets', 'character.hunter-pets': 'hunter-pets',
  'guild.profile': 'guild-profile', 'guild.achievements': 'guild-achievements',
});
/** Collections KINDS id → the probe entry that asks the same path. */
export const KIND_ENTRIES = Object.freeze({
  transmog: 'character.collections-transmogs', mounts: 'character.collections-mounts', pets: 'character.collections-pets',
  'hunter-pets': 'character.hunter-pets', toys: 'character.collections-toys', heirlooms: 'character.collections-heirlooms',
  titles: 'character.titles', achievements: 'character.achievements', reputations: 'character.reputations',
  professions: 'character.professions', dungeons: 'character.encounters-dungeons', raids: 'character.encounters-raids',
  quests: 'character.quests', 'quests-completed': 'character.quests-completed', pvp: 'character.pvp-summary',
});

/**
 * Every board rule A7 gives this version, from one character's (and one guild's) answers:
 *   - one per achievement-statistics id (Blizzard's statistics feed), grouped by groupOf
 *   - Everstats' collection counts (COUNTS) whose collection answered, and the FAMILIES entries this character has
 *   - every numeric field of every other feed (stats/feeds.js numericFields), and every field skipped, with why
 * A PvP-summary field is also a collections family board (pvp:{field}): listed once, as the family's (overlaps says so).
 * `answers`: Map(entry id → json of its first 200). → { total, groups: [{ group, boards }], list, skipped, overlaps }
 */
export function boardsFrom({ answers, here }) {
  const list = [];
  for (const s of here) list.push({ key: `statistic:${s.id}`, name: s.name, group: groupOf(s).label, source: 'achievement-statistics' });

  const rows = new Map();
  for (const k of KINDS) {
    const json = answers.get(KIND_ENTRIES[k.id]);
    if (json === undefined) continue;
    try {
      rows.set(k.id, { data: k.parse(json) });
    } catch {
      /* an answer the parser can't read: no board from it */
    }
  }
  for (const c of COUNTS) {
    if (!rows.has(c.kind)) continue;
    list.push({ key: `collections:${c.key}`, name: c.name, group: 'Collections', source: `collections (${c.kind})`, ...(c.lazy ? { note: 'made once someone has a value above zero' } : {}) });
  }
  const familyKeys = new Set();
  for (const f of FAMILIES) {
    const row = rows.get(f.kind);
    if (!row) continue;
    let entries = [];
    try {
      entries = f.entries(row.data, { rows, achievementCatalog: new Map() });
    } catch {
      entries = [];
    }
    for (const e of entries.filter((x) => Number(x.value) > 0)) {
      familyKeys.add(e.key);
      list.push({ key: `collections:${e.key}`, name: e.name, group: f.kind === 'pvp' ? 'PvP' : 'Collections', source: `collections family (${f.family})` });
    }
    if (f.family === 'achcat') list.push({ key: 'collections:achcat:*', name: 'Achievements earned, per category (one per category, once the achievement catalog is built)', group: 'Collections', source: 'collections family (achcat)', note: 'counted per category from the static achievement catalog, which a probe doesn’t build' });
  }

  const skipped = [];
  const overlaps = [];
  for (const [entryId, feedId] of Object.entries(FEED_ENTRIES)) {
    const json = answers.get(entryId);
    if (json === undefined) continue;
    const r = numericFields(feedId, json);
    for (const f of r.fields) {
      // pvp-summary's top-level numbers are already the PvP family's boards.
      if (feedId === 'pvp-summary' && !f.path.includes('.') && !f.path.includes('[') && rows.has('pvp')) {
        overlaps.push({ key: f.key, family: `pvp:${f.path}` });
        continue;
      }
      list.push({ key: f.key, name: f.name, group: f.group, source: `feed (${feedId})` });
    }
    for (const x of r.skipped) skipped.push({ feed: feedId, ...x });
  }
  const groups = new Map();
  for (const b of list) groups.set(b.group, (groups.get(b.group) ?? 0) + 1);
  return {
    total: list.length,
    groups: [...groups.entries()].map(([group, boards]) => ({ group, boards })).sort((a, b) => b.boards - a.boards || a.group.localeCompare(b.group)),
    list,
    skipped,
    overlaps,
    feedsAnswered: Object.keys(FEED_ENTRIES).filter((id) => answers.has(id)).map((id) => FEED_ENTRIES[id]),
    feedsKnown: FEEDS.map((f) => f.id),
  };
}

/**
 * The render beside the race Blizzard names for the character. Whether the render DRAWS that race only a person can
 * say: verdict stays null ("unknown until checked") until the admin ticks it on the probe page.
 */
export function renderCheck({ media, profile, account, check = null }) {
  const assets = media ? parseMedia(media) : {};
  const race = nameOf(profile?.race) ?? nameOf(profile?.playable_race) ?? account?.race ?? null;
  return {
    race,
    gender: nameOf(profile?.gender),
    urls: assets,
    main: assets['main-raw'] ?? assets.main ?? assets.inset ?? assets.avatar ?? null,
    verdict: check?.verdict ?? null,
    checkedAt: check?.at ?? null,
    text: !media
      ? 'No character-media answer, so there is no render to check.'
      : check?.verdict
        ? `Checked by the admin: the render ${check.verdict === 'right' ? 'draws' : 'does NOT draw'} the race Blizzard names (${race ?? 'race not named'}).`
        : `Blizzard names the race ${race ?? '(not named)'}; whether the render draws it is unknown until checked on this page.`,
  };
}
