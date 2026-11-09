import { BLIZZARD_API } from '../core/config.js';

/**
 * What a discovery run asks Blizzard for: a registry, so adding an endpoint to probe is one line here.
 *
 * Every path is a GUESS until a run shows what answers: these are retail's documented paths with Forever's
 * namespaces (community probing, Nov 2026). A 404 is a finding, recorded as one.
 *
 *   namespace  'static' | 'dynamic' | 'profile': which BLIZZARD_API namespace kind; 'static' uses the version the run
 *              detects from the API's own links (never a hardcoded version)
 *   catalog    true: its responses feed the statistics catalog (discovery/analyze.js)
 */

/** Game data, asked once per run with the app token. Rulesets come from the index's own links. */
export const DATA_ENDPOINTS = [
  { id: 'data.ruleset-index', path: BLIZZARD_API.paths.rulesets, namespace: 'dynamic', why: 'The rulesets, never hardcoded' },
  { id: 'data.region-index', path: '/data/wow/region/index', namespace: 'dynamic', why: 'Which regions the namespace knows' },
  { id: 'data.realm-index', path: '/data/wow/realm/index', namespace: 'dynamic', why: 'Retail lists realms here; Forever is said to have none' },
  { id: 'data.playable-race-index', path: '/data/wow/playable-race/index', namespace: 'static', why: 'Races (is Skyborne one?)' },
  { id: 'data.playable-class-index', path: '/data/wow/playable-class/index', namespace: 'static', why: 'Classes' },
  { id: 'data.achievement-category-index', path: '/data/wow/achievement-category/index', namespace: 'static', why: 'How achievements and statistics are grouped' },
];

/** The signed-in Battle.net account (user token, profile namespace). */
export const ACCOUNT_ENDPOINTS = [
  { id: 'account.profile', path: BLIZZARD_API.paths.accountCharacters, namespace: 'profile', why: 'Every Forever character on the account' },
  { id: 'account.collections', path: `${BLIZZARD_API.paths.accountCharacters}/collections`, namespace: 'profile', why: 'Account-wide collections' },
];
/** How many of the account's characters also get their protected-character link fetched. */
export const PROTECTED_CHARACTER_SAMPLES = 3;

/** Per character, relative to the character's own path (profile namespace, app token). */
export const CHARACTER_ENDPOINTS = [
  { id: 'character.profile', suffix: '' },
  { id: 'character.status', suffix: '/status' },
  { id: 'character.statistics', suffix: '/statistics', catalog: true },
  { id: 'character.achievements', suffix: '/achievements' },
  { id: 'character.achievement-statistics', suffix: '/achievements/statistics', catalog: true },
  { id: 'character.equipment', suffix: '/equipment' },
  { id: 'character.appearance', suffix: '/appearance' },
  { id: 'character.character-media', suffix: '/character-media' },
  { id: 'character.collections', suffix: '/collections' },
  { id: 'character.collections-mounts', suffix: '/collections/mounts' },
  { id: 'character.collections-pets', suffix: '/collections/pets' },
  { id: 'character.collections-toys', suffix: '/collections/toys' },
  { id: 'character.collections-heirlooms', suffix: '/collections/heirlooms' },
  { id: 'character.collections-transmogs', suffix: '/collections/transmogs' },
  { id: 'character.professions', suffix: '/professions' },
  { id: 'character.quests', suffix: '/quests' },
  { id: 'character.quests-completed', suffix: '/quests/completed' },
  { id: 'character.reputations', suffix: '/reputations' },
  { id: 'character.specializations', suffix: '/specializations' },
  { id: 'character.titles', suffix: '/titles' },
  { id: 'character.pvp-summary', suffix: '/pvp-summary' },
  { id: 'character.encounters', suffix: '/encounters' },
  { id: 'character.encounters-dungeons', suffix: '/encounters/dungeons' },
  { id: 'character.encounters-raids', suffix: '/encounters/raids' },
  { id: 'character.mythic-keystone-profile', suffix: '/mythic-keystone-profile' },
  { id: 'character.hunter-pets', suffix: '/hunter-pets' },
];
/** Links a character's profile advertises that aren't listed above are fetched too, up to this many per character. */
export const MAX_LINKED_EXTRAS = 10;

/** Per guild, relative to the guild's own path (the href the character profile gives). */
export const GUILD_ENDPOINTS = [
  { id: 'guild.profile', suffix: '' },
  { id: 'guild.roster', suffix: '/roster' },
  { id: 'guild.activity', suffix: '/activity' },
  { id: 'guild.achievements', suffix: '/achievements' },
];

/**
 * How the primary character's slug is probed, to learn how Blizzard addresses names (hyphens, case, encoding).
 * Each turns { name, surname } into a path segment; the raw segment is used as is (already encoded where shown).
 */
export const SLUG_PROBES = [
  { id: 'probe.slug-mixed-case', label: 'Name-Surname, as typed', segment: ({ name, surname }) => `${encodeURIComponent(name)}-${encodeURIComponent(surname)}` },
  { id: 'probe.slug-encoded-hyphen', label: 'name%2Dsurname (hyphen percent-encoded)', segment: ({ name, surname }) => `${enc(name)}%2D${enc(surname)}` },
  { id: 'probe.slug-encoded-space', label: 'name%20surname (a space)', segment: ({ name, surname }) => `${enc(name)}%20${enc(surname)}` },
  { id: 'probe.slug-underscore', label: 'name_surname', segment: ({ name, surname }) => `${enc(name)}_${enc(surname)}` },
  { id: 'probe.slug-name-only', label: 'name alone', segment: ({ name }) => enc(name) },
  { id: 'probe.slug-extra-hyphen', label: 'name-sur-name (a hyphen inside the surname)', segment: ({ name, surname }) => `${enc(name)}-${enc(surname.slice(0, Math.ceil(surname.length / 2)))}-${enc(surname.slice(Math.ceil(surname.length / 2)))}` },
];
const enc = (s) => encodeURIComponent(String(s).toLowerCase());

export const ALL_ENDPOINT_IDS = [
  ...DATA_ENDPOINTS.map((e) => e.id), 'data.ruleset',
  ...ACCOUNT_ENDPOINTS.map((e) => e.id), 'account.protected-character',
  ...CHARACTER_ENDPOINTS.map((e) => e.id),
  ...GUILD_ENDPOINTS.map((e) => e.id),
  ...SLUG_PROBES.map((e) => e.id),
];

export const characterPath = (slug) => BLIZZARD_API.paths.character.replace('{slug}', slug);
