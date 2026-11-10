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
// 0.9.1: ids DERIVED_BASE + 1 … + 999 are the fixed COUNTS; from DERIVED_DYNAMIC on, ids are allocated as FAMILIES boards
// first appear (a new achievement category, a transmog slot, an instance, a PvP field), and stay with their key.
export const DERIVED_DYNAMIC = DERIVED_BASE + 1000;
export const DERIVED_MAX = DERIVED_BASE + 100_000_000;
export const isDerivedId = (id) => Number(id) > DERIVED_BASE && Number(id) < DERIVED_MAX;
export const COLLECTIONS_CATEGORY = 'Collections';

/**
 * 0.9.2: transmog slots. Blizzard's slot TYPES (its item-appearance slot index) sorted into Armour and Weapons for the
 * tracker's picker when the appearance catalog can't say from item classes yet; anything else is Other.
 */
export const SLOT_GROUPS = Object.freeze({
  Armor: ['HEAD', 'SHOULDER', 'CLOAK', 'CHEST', 'ROBE', 'BODY', 'TABARD', 'WRIST', 'HAND', 'WAIST', 'LEGS', 'FEET'],
  Weapon: ['WEAPON', 'WEAPONMAINHAND', 'WEAPONOFFHAND', 'TWOHWEAPON', 'RANGED', 'RANGEDRIGHT', 'THROWN', 'SHIELD', 'HOLDABLE'],
});
export const slotGroup = (type) => Object.entries(SLOT_GROUPS).find(([, l]) => l.includes(type))?.[0] ?? null;
/**
 * Blizzard names two slots "Chest" (CHEST and ROBE). A name two slots share keeps it plain for the slot whose type IS
 * that name and adds the type in brackets to the other: "Chest" and "Chest (robe)". → Map(type → label)
 */
export function slotLabels(slots) {
  const out = new Map();
  for (const s of slots) {
    const twins = slots.filter((x) => x.name === s.name);
    const plain = twins.length < 2 || String(s.type).toLowerCase() === String(s.name).toLowerCase();
    out.set(s.type, plain ? s.name : `${s.name} (${String(s.type).toLowerCase()})`);
  }
  return out;
}

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
  { key: 'heirlooms', short: 'Heirlooms', onlyWithCatalog: true, n: 10, name: 'Heirlooms collected', kind: 'heirlooms', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'heirloom' },
  { key: 'titles', short: 'Titles', n: 4, name: 'Titles earned', kind: 'titles', shared: 'detected', count: (d) => new Set(d.items.map((x) => x.id)).size, catalog: 'title' },
  { key: 'achievements', short: 'Achievements', n: 5, name: 'Achievements earned', kind: 'achievements', shared: 'stated', count: (d) => d.items.filter((a) => a.completedAt).length, catalog: 'achievement' },
  // Blizzard's own standing name, never a tier number we'd have to interpret.
  { key: 'exalted', short: 'Exalted', n: 6, name: 'Exalted reputations', kind: 'reputations', count: (d) => d.items.filter((r) => r.standing === 'Exalted').length },
  // Named apart from Blizzard's own "Quests completed" statistic: this one counts Blizzard's completed-quest list.
  { key: 'quests', short: 'Quests', n: 8, name: 'Completed quests (quest log)', kind: 'quests-completed', count: (d) => d.items.length },
  // 0.9.1. Blizzard's own quality type; a pet species counted once (its best copy).
  { key: 'pets-rare', short: 'Rare+ pets', n: 11, name: 'Rare or better pets', kind: 'pets', shared: 'detected', count: (d) => new Set(d.items.filter((p) => ['rare', 'epic', 'legendary'].includes(p.quality)).map((p) => p.speciesId)).size },
  { key: 'revered', short: 'Revered+', n: 12, name: 'Reputations at Revered or higher', kind: 'reputations', count: (d) => d.items.filter((r) => r.standing === 'Revered' || r.standing === 'Exalted').length },
  // Registered only once someone has a kill: Blizzard's encounter lists were empty in every Forever sample so far.
  { key: 'boss-kills', short: 'Boss kills', n: 13, lazy: true, name: 'Dungeon and raid boss kills', kind: 'dungeons', count: (d, ctx) => ['dungeons', 'raids'].reduce((n, k) => n + (ctx.rows?.get(k)?.data?.items ?? []).reduce((m, i) => m + i.modes.reduce((x, md) => x + md.bosses.reduce((y, b) => y + (b.kills ?? 0), 0), 0), 0), 0) },
  // Hunters only, ranked among hunters (board population: characters of Blizzard's class "Hunter").
  { key: 'hunter-pets', short: 'Hunter pets', n: 14, lazy: true, population: 'hunters', name: 'Hunter pets owned', kind: 'hunter-pets', count: (d) => d.items.length },
  { key: 'legacy', short: 'Legacy Points', n: 9, name: 'Legacy Points', kind: 'achievements', shared: 'stated', count: (d, ctx) => (ctx.achievementCatalog?.size ? legacyOf(d.items, ctx.achievementCatalog).points : null) },
].map((c) => Object.freeze({ ...c, id: derivedId(c.n) })));
export const countById = new Map(COUNTS.map((c) => [c.id, c]));

/**
 * 0.9.1 FAMILIES: one board per thing Blizzard returns (an achievement category, a transmog slot, an instance, a PvP
 * summary field). entries(data, ctx) → [{ key, name, value }]; a key's id is allocated the first time any character
 * has a value above zero for it (collections/store.js ensureDerivedId), so a board exists only for what Blizzard really
 * returns on Forever. Names are built from Blizzard's own names (so they age out with the window like Blizzard's).
 */
const PVP_LABELS = { honorable_kills: 'Honorable kills', pvp_rank: 'PvP rank', honor_level: 'Honor level' };
const pretty = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const FAMILIES = Object.freeze([
  {
    family: 'achcat', kind: 'achievements', shared: 'stated', label: 'Achievements earned, per category',
    entries: (d, ctx) => {
      if (!ctx.achievementCatalog?.size) return [];
      const by = new Map();
      for (const a of d.items) {
        if (!a.completedAt) continue;
        const c = ctx.achievementCatalog.get(a.id);
        if (!c?.categoryId || !c.category) continue;
        const e = by.get(c.categoryId) ?? { key: `achcat:${c.categoryId}`, name: `Achievements earned: ${c.category}`, value: 0 };
        e.value += 1;
        by.set(c.categoryId, e);
      }
      return [...by.values()];
    },
  },
  {
    family: 'slot', kind: 'transmog', shared: 'detected', label: 'Appearances collected, per slot',
    entries: (d) => {
      const slots = d.slots.filter((s) => /^[A-Z0-9_]{1,30}$/.test(s.type));
      const labels = slotLabels(slots);
      return slots.map((s) => ({ key: `slot:${s.type}`, name: `Appearances collected: ${labels.get(s.type)}`, value: new Set(s.ids).size }));
    },
  },
  {
    family: 'instance', kind: 'dungeons', label: 'Boss kills, per instance',
    entries: (d, ctx) => ['dungeons', 'raids'].flatMap((k) => (ctx.rows?.get(k)?.data?.items ?? []).map((i) => ({
      key: `instance:${i.id}`, name: `${i.name ?? `Instance ${i.id}`} boss kills`,
      value: i.modes.reduce((x, md) => x + md.bosses.reduce((y, b) => y + (b.kills ?? 0), 0), 0),
    }))),
  },
  {
    family: 'pvp', kind: 'pvp', label: 'PvP summary fields',
    entries: (d) => Object.entries(d.fields).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && Number.isFinite(v)).map(([k, v]) => ({ key: `pvp:${k}`, name: `${PVP_LABELS[k] ?? pretty(k)} (PvP summary)`, value: v })),
  },
]);
export const familyOf = (key) => FAMILIES.find((f) => String(key ?? '').startsWith(`${f.family}:`)) ?? null;
/** The fixed count or family a derived key belongs to → { kind, shared, population } (for boards and notes). */
export const derivedInfo = (key) => countByKey.get(key) ?? familyOf(key);
export const countByKey = new Map(COUNTS.map((c) => [c.key, c]));

/** How a statistic Everstats counts says where it came from (provenance lines, the Discovery page). */
export const derivedSource = (key) => {
  const c = countByKey.get(key);
  return c ? `Counted by Everstats from Blizzard's character ${kindById.get(c.kind)?.label.toLowerCase() ?? c.kind}` : null;
};
