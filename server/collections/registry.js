import { legacyOf } from './legacy.js';
import {
  parseAchievements, parseEncounters, parseHeirlooms, parseHunterPets, parseMounts, parsePets, parseProfessions, parsePvp, parseQuestsCompleted,
  parseQuestsInProgress, parseReputations, parseTitles, parseToys, parseTransmogs,
} from './parse.js';

/**
 * Collections (0.9.0): the REGISTRY. Code that fetches, stores, counts or shows collections iterates these lists; a new
 * collection is one entry here (and its section on the client), never an `if (kind === …)` in a route.
 *
 * KINDS: one per character endpoint (path is appended to the character's own profile path, so nothing here names a
 * namespace or a game version). Shapes and availability are from the 0.8.3 endpoint probe (run #4):
 *   - `when(ctx)` decides whether a character is asked at all. Hunter pets: hunters only (Blizzard answers 404 for
 *     everyone else). Heirlooms: only while Blizzard's heirloom catalog has any (empty on Forever in run #4, so the
 *     character endpoint is not asked and the section doesn't exist; it appears by itself if Blizzard adds some).
 *   - `notFoundIsEmpty`: a 404 means "none", not "not returned".
 *   - Housing (every decor/house endpoint 404s), Mythic+ and PvP seasons/brackets (404 or empty) are NOT here.
 *
 * COUNTS: the collection counts that are STATISTICS (DERIVED_BASE + n). Their values go in character_statistics like any
 * statistic, so they get boards per ruleset (overall, weekly, the rolling window), pins, snapshots and the same tie,
 * zero and freshness rules. They are listed on the Discovery page as statistics like any other: none counts toward a
 * tier until the owner approves it there (tiers count decisions only, never a suggestion).
 *   `count(data, ctx)` → a number, or null when it can't be counted (Legacy Points before the achievement catalog).
 *   `short`: the label on a share card (where the full name doesn't fit).
 *   `shared`: how "Shared across this account" is known: 'detected' (identical on every fetched character of a
 *   signed-in account: collection_sharing), 'stated' (Blizzard says so per achievement), or none.
 */
export const DERIVED_BASE = 2_000_000_000;
export const derivedId = (n) => DERIVED_BASE + n;
export const isDerivedId = (id) => Number(id) > DERIVED_BASE && Number(id) < DERIVED_BASE + 1000;
export const COLLECTIONS_CATEGORY = 'Collections';

const has = (d) => Array.isArray(d?.items) && d.items.length > 0;

export const KINDS = Object.freeze([
  { id: 'transmog', label: 'Transmog', path: '/collections/transmogs', parse: parseTransmogs, isEmpty: (d) => !d.slots.some((s) => s.ids.length), detect: true },
  { id: 'mounts', label: 'Mounts', path: '/collections/mounts', parse: parseMounts, isEmpty: (d) => !has(d), detect: true },
  { id: 'pets', label: 'Pets', path: '/collections/pets', parse: parsePets, isEmpty: (d) => !has(d), detect: true },
  { id: 'hunter-pets', label: 'Hunter pets', path: '/hunter-pets', parse: parseHunterPets, isEmpty: (d) => !has(d), notFoundIsEmpty: true, when: ({ character }) => character.class === 'Hunter' },
  { id: 'toys', label: 'Toys', path: '/collections/toys', parse: parseToys, isEmpty: (d) => !has(d), detect: true },
  { id: 'heirlooms', label: 'Heirlooms', path: '/collections/heirlooms', parse: parseHeirlooms, isEmpty: (d) => !has(d), detect: true, when: ({ catalogTotals }) => (catalogTotals.heirloom ?? 0) > 0 },
  { id: 'titles', label: 'Titles', path: '/titles', parse: parseTitles, isEmpty: (d) => !has(d), detect: true },
  { id: 'achievements', label: 'Achievements', path: '/achievements', parse: parseAchievements, isEmpty: (d) => !has(d) },
  { id: 'reputations', label: 'Reputations', path: '/reputations', parse: parseReputations, isEmpty: (d) => !has(d) },
  { id: 'professions', label: 'Professions', path: '/professions', parse: parseProfessions, isEmpty: (d) => !d.primaries.length && !d.secondaries.length },
  { id: 'dungeons', label: 'Dungeons', path: '/encounters/dungeons', parse: (j) => parseEncounters(j, 'dungeon'), isEmpty: (d) => !has(d) },
  { id: 'raids', label: 'Raids', path: '/encounters/raids', parse: (j) => parseEncounters(j, 'raid'), isEmpty: (d) => !has(d) },
  { id: 'quests', label: 'Quests in progress', path: '/quests', parse: parseQuestsInProgress, isEmpty: (d) => !has(d) },
  { id: 'quests-completed', label: 'Completed quests', path: '/quests/completed', parse: parseQuestsCompleted, isEmpty: (d) => !has(d) },
  { id: 'pvp', label: 'PvP', path: '/pvp-summary', parse: parsePvp, isEmpty: (d) => !Object.keys(d.fields).length },
]);
export const kindById = new Map(KINDS.map((k) => [k.id, k]));

const uniqueAppearances = (d) => new Set(d.slots.flatMap((s) => s.ids)).size;

export const COUNTS = Object.freeze([
  { key: 'appearances', short: 'Appearances', n: 7, name: 'Appearances collected', kind: 'transmog', shared: 'detected', count: uniqueAppearances, catalog: 'appearance' },
  { key: 'mounts', short: 'Mounts', n: 1, name: 'Mounts collected', kind: 'mounts', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'mount' },
  { key: 'pets', short: 'Pets', n: 2, name: 'Pets collected', kind: 'pets', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.speciesId)).size, catalog: 'pet' },
  { key: 'toys', short: 'Toys', n: 3, name: 'Toys collected', kind: 'toys', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'toy' },
  { key: 'heirlooms', short: 'Heirlooms', n: 10, name: 'Heirlooms collected', kind: 'heirlooms', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'heirloom' },
  { key: 'titles', short: 'Titles', n: 4, name: 'Titles earned', kind: 'titles', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'title' },
  { key: 'achievements', short: 'Achievements', n: 5, name: 'Achievements earned', kind: 'achievements', shared: 'stated', count: (d) => d.items.filter((a) => a.completedAt).length, catalog: 'achievement' },
  // Blizzard's own standing name, never a tier number we'd have to interpret.
  { key: 'exalted', short: 'Exalted', n: 6, name: 'Exalted reputations', kind: 'reputations', count: (d) => d.items.filter((r) => r.standing === 'Exalted').length },
  // Named apart from Blizzard's own "Quests completed" statistic: this one counts Blizzard's completed-quest list.
  { key: 'quests', short: 'Quests', n: 8, name: 'Completed quests (quest log)', kind: 'quests-completed', count: (d) => d.items.length },
  { key: 'legacy', short: 'Legacy Points', n: 9, name: 'Legacy Points', kind: 'achievements', shared: 'stated', count: (d, ctx) => (ctx.achievementCatalog?.size ? legacyOf(d.items, ctx.achievementCatalog).points : null) },
].map((c) => Object.freeze({ ...c, id: derivedId(c.n) })));
export const countById = new Map(COUNTS.map((c) => [c.id, c]));
export const countByKey = new Map(COUNTS.map((c) => [c.key, c]));

/** How a statistic Everstats counts says where it came from (provenance lines, the Discovery page). */
export const derivedSource = (key) => {
  const c = countByKey.get(key);
  return c ? `Counted by Everstats from Blizzard's character ${kindById.get(c.kind)?.label.toLowerCase() ?? c.kind}` : null;
};
