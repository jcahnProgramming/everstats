import { NATIVE_VERSION } from '../../core/gameVersions.js';

/**
 * The endpoint probe's registry (0.8.3): EVERY endpoint in Blizzard's WoW API docs (retail and classic, profile and game
 * data, as listed on community.developer.battle.net on 2026-11-09), plus the Forever-only guesses. 0.10.0: the same list
 * runs against ANY game version in core/gameVersions.js: {C} and {G} are built by that version's blizzardContext (realm
 * paths where it has realms), the namespaces are its own, and a guess runs only on the versions it names (`versions`). A probe run (probe/run.js) walks this list IN ORDER, so an entry whose ids come from another entry comes
 * after it (server/test/probe.test.js checks).
 *
 * Adapted to Forever:
 *   - realmless: {C} is the character's own path (/profile/wow/character/{name-surname}), {G} the guild's
 *     (/data/wow/guild/{slug}); retail's {realmSlug}/ segments are dropped.
 *   - namespaces: ns 'profile' | 'dynamic' | 'static' is the KIND (retail's docs); the namespace itself is
 *     profile-forever-us / dynamic-forever-us, or the static namespace DETECTED from the API's own links (never a
 *     hardcoded version). A path-free data entry that answers 404 is asked once more in the other data namespace,
 *     and a detail uses the namespace its link names.
 *   - {param}s are never invented: the values come from an earlier answer (`from`, in order): first the links in it that
 *     match this entry's path, else the ids its list carries. Only where no index exists are common values tried
 *     (`common`, every one of them, recorded as such). Discovered values: at most two, stopping at the first 200.
 *
 *   id      stable (stored as discovery_responses.endpoint 'ep.<id>')
 *   area    PROBE_AREAS id (how the results are grouped)
 *   from    entry ids whose 200 answers supply {param}s
 *   common  [{ param: value }]: tried when no `from` answer supplies one (pvp brackets)
 *   linksOnly true: values only from links in a `from` answer whose path matches (never ids from some list)
 *   every   true: every linked value is tried (each is its own data), then the `common` ones not linked
 *   none    the skip reason, in words, when every `from` answered without a value ("the character profile names no house")
 *   A `from` answer's `current_season` is tried first (season indexes list retired seasons first; those answer 403).
 *   fixed   { param: value }: a constant alongside discovered values (recorded)
 *   pick    (json) → [{ param: value }]: a custom reading of the `from` answer (only where links can't supply it)
 *   query   extra parameters (search endpoints only)
 *   auth    'user': needs the admin's Discovery Battle.net token, else "skipped: needs user token"
 *   realms  true: skipped with the reason when connected-realm/index shows Forever has no realms
 *   first   true: never probed before 0.8.3          later  true: a system retail added in a later expansion
 *   classic true: in the classic docs only           guess  true: a Forever-only guess, in no docs
 *   versions [ids]: only on these game versions (the guesses: their own version only); absent = every version
 */
export const PROBE_AREAS = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'collections', label: 'Collections' },
  { id: 'housing', label: 'Housing' },
  { id: 'transmog', label: 'Transmog catalog' },
  { id: 'journal', label: 'Journal' },
  { id: 'pvp', label: 'PvP' },
  { id: 'mythic', label: 'Mythic+' },
  { id: 'quests', label: 'Quests' },
  { id: 'reputation', label: 'Reputation' },
  { id: 'professions', label: 'Professions' },
  { id: 'catalogs', label: 'Titles/Toys/Mounts/Pets' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'items', label: 'Items & spells' },
  { id: 'classes', label: 'Classes & talents' },
  { id: 'creatures', label: 'Creatures' },
  { id: 'realms', label: 'Realms & auctions' },
  { id: 'other', label: 'Other game data' },
  { id: 'guild', label: 'Guild' },
  { id: 'search', label: 'Search' },
  { id: 'guesses', label: 'Forever guesses' },
];

const c = (id, area, suffix, extra = {}) => ({ id: `character.${id}`, area, path: `{C}${suffix}`, ns: 'profile', ...extra });
const g = (id, suffix) => ({ id: `guild.${id}`, area: 'guild', path: `{G}${suffix}`, ns: 'profile' });
const d = (id, area, path, ns, extra = {}) => ({ id: `data.${id}`, area, path: `/data/wow/${path}`, ns, ...extra });
const S = 'static';
const D = 'dynamic';
// Search endpoints: one request each with a minimal query (sorted by id, first page). Retail's docs: orderby + _page.
const MINIMAL = { orderby: 'id', _page: 1 };
const s = (id, path, ns, extra = {}) => ({ id: `search.${id}`, area: 'search', path: `/data/wow/search/${path}`, ns, query: MINIMAL, ...extra });

const slugOf = (name) => String(name ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The Forever-only guesses (the list's last section): each as a character sub-path AND as /data/wow/{x}/index. */
export const FOREVER_GUESSES = ['legacy', 'legacies', 'heritage', 'housing', 'camping', 'camp', 'skyborne', 'renown', 'account-progression', 'forever'];
// The game version the guesses are about (core/gameVersions.js: the one with Forever's namespaces).
const GUESS_VERSIONS = Object.freeze([NATIVE_VERSION.id]);

export const PROBE_ENDPOINTS = [
  // ---- the character first: its links carry the static namespace every static entry needs
  c('profile', 'profile', ''),
  c('status', 'profile', '/status'),
  c('statistics', 'profile', '/statistics'),
  c('achievements', 'achievements', '/achievements'),
  c('achievement-statistics', 'achievements', '/achievements/statistics'),
  c('equipment', 'profile', '/equipment'),
  c('appearance', 'profile', '/appearance'),
  c('character-media', 'profile', '/character-media'),
  c('collections', 'collections', '/collections'),
  c('collections-mounts', 'collections', '/collections/mounts'),
  c('collections-pets', 'collections', '/collections/pets'),
  c('collections-toys', 'collections', '/collections/toys'),
  c('collections-heirlooms', 'collections', '/collections/heirlooms'),
  c('collections-transmogs', 'collections', '/collections/transmogs'),
  c('collections-decor', 'housing', '/collections/decor', { first: true, later: true }),
  // 0.10.4: the house number only from the profile's own link to its house (no `common` guess); none → a recorded skip.
  c('house', 'housing', '/house/house-{houseNumber}', { first: true, later: true, from: ['character.profile'], linksOnly: true, none: 'the character profile names no house' }),
  c('professions', 'professions', '/professions'),
  c('quests', 'quests', '/quests'),
  c('quests-completed', 'quests', '/quests/completed'),
  c('reputations', 'reputation', '/reputations'),
  c('specializations', 'classes', '/specializations'),
  c('titles', 'collections', '/titles'),
  c('pvp-summary', 'pvp', '/pvp-summary'),
  // 0.10.4: every bracket pvp-summary links first (the only source of per-spec names: shuffle-{class}-{spec},
  // blitz-{class}-{spec}; never built), then 2v2 / 3v3 / rbg (no bracket index exists) where not linked.
  c('pvp-bracket', 'pvp', '/pvp-bracket/{pvpBracket}', { first: true, from: ['character.pvp-summary'], linksOnly: true, every: true, common: [{ pvpBracket: '2v2' }, { pvpBracket: '3v3' }, { pvpBracket: 'rbg' }] }),
  c('encounters', 'journal', '/encounters'),
  c('encounters-dungeons', 'journal', '/encounters/dungeons'),
  c('encounters-raids', 'journal', '/encounters/raids'),
  c('mythic-keystone-profile', 'mythic', '/mythic-keystone-profile', { later: true }),
  c('hunter-pets', 'profile', '/hunter-pets'),
  c('soulbinds', 'profile', '/soulbinds', { first: true, later: true }),

  // ---- the account (the admin's Discovery token) and the guild
  { id: 'account.profile', area: 'account', path: '/profile/user/wow', ns: 'profile', auth: 'user' },
  { id: 'account.protected-character', area: 'account', path: '/profile/user/wow/protected-character/{realmId}-{characterId}', ns: 'profile', auth: 'user', from: ['account.profile'], preferPrimary: 'characterId', first: true },
  g('profile', ''),
  g('activity', '/activity'),
  g('achievements', '/achievements'),
  g('roster', '/roster'),

  // ---- realms, regions, rulesets, token (dynamic). connected-realm/index decides whether realm endpoints are tried.
  d('ruleset-index', 'other', 'ruleset/index', D),
  d('ruleset', 'other', 'ruleset/{rulesetId}', D, { from: ['data.ruleset-index'] }),
  d('region-index', 'realms', 'region/index', D),
  d('region', 'realms', 'region/{regionId}', D, { from: ['data.region-index'] }),
  d('realm-index', 'realms', 'realm/index', D),
  d('realm', 'realms', 'realm/{realmSlug}', D, { from: ['data.realm-index'] }),
  d('connected-realm-index', 'realms', 'connected-realm/index', D),
  d('connected-realm', 'realms', 'connected-realm/{connectedRealmId}', D, { from: ['data.connected-realm-index'], realms: true }),
  d('auctions', 'realms', 'connected-realm/{connectedRealmId}/auctions', D, { from: ['data.connected-realm'], realms: true }),
  d('auctions-index', 'realms', 'connected-realm/{connectedRealmId}/auctions/index', D, { from: ['data.connected-realm'], realms: true, classic: true }),
  d('auctions-house', 'realms', 'connected-realm/{connectedRealmId}/auctions/{auctionHouseId}', D, { from: ['data.auctions-index'], realms: true, classic: true }),
  // 0.11.1 (owner's decision): never fetched. Probe #7 measured it once: 19.9 MB a request, and nothing on Everstats
  // uses commodity prices. The entry stays so the probe's list still matches Blizzard's docs; it is recorded as a skip.
  d('auctions-commodities', 'realms', 'auctions/commodities', D, { realms: true, never: 'never fetched: 19.9 MB a request (measured by probe #7), and Everstats uses no commodity prices' }),
  d('token-index', 'other', 'token/index', D),

  // ---- search (once each, a minimal query): early, because some details take their ids from search results
  s('connected-realm', 'connected-realm', D),
  s('realm', 'realm', D),
  s('azerite-essence', 'azerite-essence', S, { later: true }),
  s('creature', 'creature', S),
  s('decor', 'decor', S, { later: true }),
  s('fixture', 'fixture', S, { later: true }),
  s('fixture-hook', 'fixture-hook', S, { later: true }),
  s('item', 'item', S),
  s('item-appearance', 'item-appearance', S),
  s('journal-encounter', 'journal-encounter', S),
  s('media', 'media', S, { query: { ...MINIMAL, tags: 'item' } }),
  s('mount', 'mount', S),
  s('spell', 'spell', S),

  // ---- achievements
  d('achievement-index', 'achievements', 'achievement/index', S),
  d('achievement', 'achievements', 'achievement/{achievementId}', S, { from: ['data.achievement-index', 'character.achievements'] }),
  d('achievement-media', 'achievements', 'media/achievement/{achievementId}', S, { from: ['data.achievement'] }),
  d('achievement-category-index', 'achievements', 'achievement-category/index', S),
  d('achievement-category', 'achievements', 'achievement-category/{achievementCategoryId}', S, { from: ['data.achievement-category-index'] }),

  // ---- the catalogs Collections would compare against
  d('mount-index', 'catalogs', 'mount/index', S),
  d('mount', 'catalogs', 'mount/{mountId}', S, { from: ['data.mount-index', 'search.mount', 'character.collections-mounts'] }),
  d('pet-index', 'catalogs', 'pet/index', S),
  d('pet', 'catalogs', 'pet/{petId}', S, { from: ['data.pet-index', 'character.collections-pets'] }),
  d('pet-media', 'catalogs', 'media/pet/{petId}', S, { from: ['data.pet'] }),
  d('pet-ability-index', 'catalogs', 'pet-ability/index', S),
  d('pet-ability', 'catalogs', 'pet-ability/{petAbilityId}', S, { from: ['data.pet-ability-index'] }),
  d('pet-ability-media', 'catalogs', 'media/pet-ability/{petAbilityId}', S, { from: ['data.pet-ability'] }),
  d('toy-index', 'catalogs', 'toy/index', S),
  d('toy', 'catalogs', 'toy/{toyId}', S, { from: ['data.toy-index', 'character.collections-toys'] }),
  d('title-index', 'catalogs', 'title/index', S),
  d('title', 'catalogs', 'title/{titleId}', S, { from: ['data.title-index', 'character.titles'] }),
  d('heirloom-index', 'catalogs', 'heirloom/index', S),
  d('heirloom', 'catalogs', 'heirloom/{heirloomId}', S, { from: ['data.heirloom-index', 'character.collections-heirlooms'] }),

  // ---- housing
  d('decor-index', 'housing', 'decor/index', S, { later: true }),
  d('decor', 'housing', 'decor/{decorId}', S, { from: ['data.decor-index', 'search.decor', 'character.collections-decor'], later: true }),
  d('fixture-index', 'housing', 'fixture/index', S, { later: true }),
  d('fixture', 'housing', 'fixture/{fixtureId}', S, { from: ['data.fixture-index', 'search.fixture'], later: true }),
  d('fixture-hook-index', 'housing', 'fixture-hook/index', S, { later: true }),
  d('fixture-hook', 'housing', 'fixture-hook/{fixtureHookId}', S, { from: ['data.fixture-hook-index', 'search.fixture-hook'], later: true }),
  d('room-index', 'housing', 'room/index', S, { later: true }),
  d('room', 'housing', 'room/{roomId}', S, { from: ['data.room-index'], later: true }),
  d('neighborhood-map-index', 'housing', 'neighborhood-map/index', S, { later: true }),
  d('neighborhood-map', 'housing', 'neighborhood-map/{neighborhoodMapId}', S, { from: ['data.neighborhood-map-index'], later: true }),
  d('neighborhood', 'housing', 'neighborhood-map/{neighborhoodMapId}/neighborhood/{neighborhoodId}', S, { from: ['data.neighborhood-map'], later: true }),

  // ---- items, item classes, item sets, spells (real ids from the character's own gear and talents first)
  d('item', 'items', 'item/{itemId}', S, { from: ['character.equipment', 'search.item'] }),
  d('item-media', 'items', 'media/item/{itemId}', S, { from: ['character.equipment', 'data.item'] }),
  d('item-class-index', 'items', 'item-class/index', S),
  d('item-class', 'items', 'item-class/{itemClassId}', S, { from: ['data.item-class-index'] }),
  d('item-subclass', 'items', 'item-class/{itemClassId}/item-subclass/{itemSubclassId}', S, { from: ['data.item-class'] }),
  d('item-set-index', 'items', 'item-set/index', S),
  d('item-set', 'items', 'item-set/{itemSetId}', S, { from: ['data.item-set-index', 'character.equipment'] }),
  d('spell', 'items', 'spell/{spellId}', S, { from: ['character.specializations', 'search.spell'] }),
  d('spell-media', 'items', 'media/spell/{spellId}', S, { from: ['data.spell', 'character.specializations'] }),

  // ---- the transmog catalog
  d('item-appearance', 'transmog', 'item-appearance/{appearanceId}', S, { from: ['data.item', 'search.item-appearance', 'character.collections-transmogs'] }),
  d('item-appearance-set-index', 'transmog', 'item-appearance/set/index', S),
  d('item-appearance-set', 'transmog', 'item-appearance/set/{appearanceSetId}', S, { from: ['data.item-appearance-set-index'] }),
  d('item-appearance-slot-index', 'transmog', 'item-appearance/slot/index', S),
  d('item-appearance-slot', 'transmog', 'item-appearance/slot/{slotType}', S, { from: ['data.item-appearance-slot-index'] }),

  // ---- the Adventure Journal (drop sources)
  d('journal-expansion-index', 'journal', 'journal-expansion/index', S),
  d('journal-expansion', 'journal', 'journal-expansion/{journalExpansionId}', S, { from: ['data.journal-expansion-index'] }),
  d('journal-instance-index', 'journal', 'journal-instance/index', S),
  d('journal-instance', 'journal', 'journal-instance/{journalInstanceId}', S, { from: ['data.journal-instance-index', 'data.journal-expansion'] }),
  d('journal-instance-media', 'journal', 'media/journal-instance/{journalInstanceId}', S, { from: ['data.journal-instance'] }),
  d('journal-encounter-index', 'journal', 'journal-encounter/index', S),
  d('journal-encounter', 'journal', 'journal-encounter/{journalEncounterId}', S, { from: ['data.journal-encounter-index', 'data.journal-instance', 'search.journal-encounter'] }),
  // Hall of Fame names a raid by slug, and no index lists raid slugs: the raid names in a journal expansion, made into
  // slugs (recorded as such), and one faction.
  d('hall-of-fame', 'journal', 'leaderboard/hall-of-fame/{raid}/{faction}', D, {
    from: ['data.journal-expansion'], fixed: { faction: 'alliance' }, later: true,
    pick: (json) => (Array.isArray(json?.raids) ? json.raids : []).map((r) => ({ raid: slugOf(r?.name) })).filter((v) => v.raid),
  }),

  // ---- creatures (ids from search and the journal: there's no creature index)
  d('creature', 'creatures', 'creature/{creatureId}', S, { from: ['search.creature'] }),
  d('creature-display-media', 'creatures', 'media/creature-display/{creatureDisplayId}', S, { from: ['data.journal-encounter', 'search.creature', 'data.creature'] }),
  d('creature-family-index', 'creatures', 'creature-family/index', S),
  d('creature-family', 'creatures', 'creature-family/{creatureFamilyId}', S, { from: ['data.creature-family-index'] }),
  d('creature-family-media', 'creatures', 'media/creature-family/{creatureFamilyId}', S, { from: ['data.creature-family'] }),
  d('creature-type-index', 'creatures', 'creature-type/index', S),
  d('creature-type', 'creatures', 'creature-type/{creatureTypeId}', S, { from: ['data.creature-type-index'] }),

  // ---- classes, races, specs, power types, talents
  d('playable-class-index', 'classes', 'playable-class/index', S),
  d('playable-class', 'classes', 'playable-class/{classId}', S, { from: ['data.playable-class-index', 'character.profile'] }),
  d('playable-class-media', 'classes', 'media/playable-class/{classId}', S, { from: ['data.playable-class'] }),
  d('pvp-talent-slots', 'classes', 'playable-class/{classId}/pvp-talent-slots', S, { from: ['data.playable-class'] }),
  d('playable-race-index', 'classes', 'playable-race/index', S),
  d('playable-race', 'classes', 'playable-race/{raceId}', S, { from: ['data.playable-race-index', 'character.profile'] }),
  d('playable-specialization-index', 'classes', 'playable-specialization/index', S),
  d('playable-specialization', 'classes', 'playable-specialization/{specId}', S, { from: ['data.playable-specialization-index', 'character.specializations'] }),
  d('playable-specialization-media', 'classes', 'media/playable-specialization/{specId}', S, { from: ['data.playable-specialization'] }),
  d('power-type-index', 'classes', 'power-type/index', S),
  d('power-type', 'classes', 'power-type/{powerTypeId}', S, { from: ['data.power-type-index'] }),
  d('talent-tree-index', 'classes', 'talent-tree/index', S, { later: true }),
  d('talent-tree', 'classes', 'talent-tree/{talentTreeId}', S, { from: ['data.talent-tree-index'], later: true }),
  d('talent-tree-spec', 'classes', 'talent-tree/{talentTreeId}/playable-specialization/{specId}', S, { from: ['data.talent-tree-index'], later: true }),
  d('talent-index', 'classes', 'talent/index', S),
  d('talent', 'classes', 'talent/{talentId}', S, { from: ['data.talent-index', 'character.specializations'] }),
  d('pvp-talent-index', 'classes', 'pvp-talent/index', S),
  d('pvp-talent', 'classes', 'pvp-talent/{pvpTalentId}', S, { from: ['data.pvp-talent-index'] }),
  d('tech-talent-tree-index', 'classes', 'tech-talent-tree/index', S, { later: true }),
  d('tech-talent-tree', 'classes', 'tech-talent-tree/{techTalentTreeId}', S, { from: ['data.tech-talent-tree-index'], later: true }),
  d('tech-talent-index', 'classes', 'tech-talent/index', S, { later: true }),
  d('tech-talent', 'classes', 'tech-talent/{techTalentId}', S, { from: ['data.tech-talent-index'], later: true }),
  d('tech-talent-media', 'classes', 'media/tech-talent/{techTalentId}', S, { from: ['data.tech-talent'], later: true }),

  // ---- professions
  d('profession-index', 'professions', 'profession/index', S),
  d('profession', 'professions', 'profession/{professionId}', S, { from: ['data.profession-index', 'character.professions'] }),
  d('profession-media', 'professions', 'media/profession/{professionId}', S, { from: ['data.profession'] }),
  d('profession-skill-tier', 'professions', 'profession/{professionId}/skill-tier/{skillTierId}', S, { from: ['data.profession', 'character.professions'] }),
  d('recipe', 'professions', 'recipe/{recipeId}', S, { from: ['data.profession-skill-tier', 'character.professions'] }),
  d('recipe-media', 'professions', 'media/recipe/{recipeId}', S, { from: ['data.recipe'] }),
  d('modified-crafting-index', 'professions', 'modified-crafting/index', S, { later: true }),
  d('modified-crafting-category-index', 'professions', 'modified-crafting/category/index', S, { later: true }),
  d('modified-crafting-category', 'professions', 'modified-crafting/category/{categoryId}', S, { from: ['data.modified-crafting-category-index'], later: true }),
  d('modified-crafting-reagent-slot-type-index', 'professions', 'modified-crafting/reagent-slot-type/index', S, { later: true }),
  d('modified-crafting-reagent-slot-type', 'professions', 'modified-crafting/reagent-slot-type/{slotTypeId}', S, { from: ['data.modified-crafting-reagent-slot-type-index'], later: true }),

  // ---- quests
  d('quest-index', 'quests', 'quest/index', S),
  d('quest-category-index', 'quests', 'quest/category/index', S),
  d('quest-category', 'quests', 'quest/category/{questCategoryId}', S, { from: ['data.quest-category-index'] }),
  d('quest-area-index', 'quests', 'quest/area/index', S),
  d('quest-area', 'quests', 'quest/area/{questAreaId}', S, { from: ['data.quest-area-index'] }),
  d('quest-type-index', 'quests', 'quest/type/index', S),
  d('quest-type', 'quests', 'quest/type/{questTypeId}', S, { from: ['data.quest-type-index'] }),
  d('quest', 'quests', 'quest/{questId}', S, { from: ['character.quests-completed', 'data.quest-area', 'data.quest-category', 'data.quest-type'] }),

  // ---- reputation
  d('reputation-faction-index', 'reputation', 'reputation-faction/index', S),
  d('reputation-faction', 'reputation', 'reputation-faction/{reputationFactionId}', S, { from: ['data.reputation-faction-index', 'character.reputations'] }),
  d('reputation-tiers-index', 'reputation', 'reputation-tiers/index', S),
  d('reputation-tiers', 'reputation', 'reputation-tiers/{reputationTiersId}', S, { from: ['data.reputation-tiers-index', 'data.reputation-faction'] }),

  // ---- PvP (retail's seasons, classic's regions)
  d('pvp-season-index', 'pvp', 'pvp-season/index', D),
  d('pvp-season', 'pvp', 'pvp-season/{pvpSeasonId}', D, { from: ['data.pvp-season-index'] }),
  d('pvp-leaderboard-index', 'pvp', 'pvp-season/{pvpSeasonId}/pvp-leaderboard/index', D, { from: ['data.pvp-season'] }),
  d('pvp-leaderboard', 'pvp', 'pvp-season/{pvpSeasonId}/pvp-leaderboard/{pvpBracket}', D, { from: ['data.pvp-leaderboard-index'] }),
  d('pvp-reward-index', 'pvp', 'pvp-season/{pvpSeasonId}/pvp-reward/index', D, { from: ['data.pvp-season'] }),
  d('pvp-tier-index', 'pvp', 'pvp-tier/index', S),
  d('pvp-tier', 'pvp', 'pvp-tier/{pvpTierId}', S, { from: ['data.pvp-tier-index'] }),
  d('pvp-tier-media', 'pvp', 'media/pvp-tier/{pvpTierId}', S, { from: ['data.pvp-tier'] }),
  d('pvp-region-index', 'pvp', 'pvp-region/index', D, { classic: true }),
  d('pvp-region-season-index', 'pvp', 'pvp-region/{pvpRegionId}/pvp-season/index', D, { from: ['data.pvp-region-index'], classic: true }),
  d('pvp-region-season', 'pvp', 'pvp-region/{pvpRegionId}/pvp-season/{pvpSeasonId}', D, { from: ['data.pvp-region-season-index'], classic: true }),
  d('pvp-region-leaderboard-index', 'pvp', 'pvp-region/{pvpRegionId}/pvp-season/{pvpSeasonId}/pvp-leaderboard/index', D, { from: ['data.pvp-region-season'], classic: true }),
  d('pvp-region-leaderboard', 'pvp', 'pvp-region/{pvpRegionId}/pvp-season/{pvpSeasonId}/pvp-leaderboard/{pvpBracket}', D, { from: ['data.pvp-region-leaderboard-index'], classic: true }),
  d('pvp-region-reward-index', 'pvp', 'pvp-region/{pvpRegionId}/pvp-season/{pvpSeasonId}/pvp-reward/index', D, { from: ['data.pvp-region-season'], classic: true }),

  // ---- Mythic+ (and the character's seasons, from the season index or its own profile)
  d('keystone-affix-index', 'mythic', 'keystone-affix/index', S, { later: true }),
  d('keystone-affix', 'mythic', 'keystone-affix/{keystoneAffixId}', S, { from: ['data.keystone-affix-index'], later: true }),
  d('keystone-affix-media', 'mythic', 'media/keystone-affix/{keystoneAffixId}', S, { from: ['data.keystone-affix'], later: true }),
  d('mythic-keystone-index', 'mythic', 'mythic-keystone/index', D, { later: true }),
  d('mythic-keystone-dungeon-index', 'mythic', 'mythic-keystone/dungeon/index', D, { later: true }),
  d('mythic-keystone-dungeon', 'mythic', 'mythic-keystone/dungeon/{dungeonId}', D, { from: ['data.mythic-keystone-dungeon-index'], later: true }),
  d('mythic-keystone-period-index', 'mythic', 'mythic-keystone/period/index', D, { later: true }),
  d('mythic-keystone-period', 'mythic', 'mythic-keystone/period/{periodId}', D, { from: ['data.mythic-keystone-period-index'], later: true }),
  d('mythic-keystone-season-index', 'mythic', 'mythic-keystone/season/index', D, { later: true }),
  d('mythic-keystone-season', 'mythic', 'mythic-keystone/season/{seasonId}', D, { from: ['data.mythic-keystone-season-index'], later: true }),
  c('mythic-keystone-season', 'mythic', '/mythic-keystone-profile/season/{seasonId}', { first: true, later: true, from: ['character.mythic-keystone-profile', 'data.mythic-keystone-season-index'] }),
  d('mythic-leaderboard-index', 'mythic', 'connected-realm/{connectedRealmId}/mythic-leaderboard/index', D, { from: ['data.connected-realm'], realms: true, later: true }),
  d('mythic-leaderboard', 'mythic', 'connected-realm/{connectedRealmId}/mythic-leaderboard/{dungeonId}/period/{periodId}', D, { from: ['data.mythic-leaderboard-index'], realms: true, later: true }),

  // ---- other game data
  d('azerite-essence-index', 'other', 'azerite-essence/index', S, { later: true }),
  d('azerite-essence', 'other', 'azerite-essence/{azeriteEssenceId}', S, { from: ['data.azerite-essence-index', 'search.azerite-essence'], later: true }),
  d('azerite-essence-media', 'other', 'media/azerite-essence/{azeriteEssenceId}', S, { from: ['data.azerite-essence'], later: true }),
  d('covenant-index', 'other', 'covenant/index', S, { later: true }),
  d('covenant', 'other', 'covenant/{covenantId}', S, { from: ['data.covenant-index'], later: true }),
  d('covenant-media', 'other', 'media/covenant/{covenantId}', S, { from: ['data.covenant'], later: true }),
  d('soulbind-index', 'other', 'covenant/soulbind/index', S, { later: true }),
  d('soulbind', 'other', 'covenant/soulbind/{soulbindId}', S, { from: ['data.soulbind-index'], later: true }),
  d('conduit-index', 'other', 'covenant/conduit/index', S, { later: true }),
  d('conduit', 'other', 'covenant/conduit/{conduitId}', S, { from: ['data.conduit-index'], later: true }),
  d('guild-crest-index', 'other', 'guild-crest/index', S),
  d('guild-crest-border-media', 'other', 'media/guild-crest/border/{borderId}', S, { from: ['data.guild-crest-index', 'guild.profile'] }),
  d('guild-crest-emblem-media', 'other', 'media/guild-crest/emblem/{emblemId}', S, { from: ['data.guild-crest-index', 'guild.profile'] }),

  // ---- the Forever-only guesses (in no docs): a character sub-path and a game-data index each
  ...FOREVER_GUESSES.map((x) => c(`guess-${x}`, 'guesses', `/${x}`, { guess: true, versions: GUESS_VERSIONS })),
  ...FOREVER_GUESSES.map((x) => d(`guess-${x}-index`, 'guesses', `${x}/index`, S, { guess: true, versions: GUESS_VERSIONS })),
];

/** The entries a probe of `version` asks, in order: everything except guesses meant for another version. */
export const probeEntriesFor = (version) => PROBE_ENDPOINTS.filter((e) => !e.versions || e.versions.includes(version));
/** Areas with at least one entry for `version` (no "Forever guesses" area on Retail). */
export const probeAreasFor = (version) => PROBE_AREAS.filter((a) => probeEntriesFor(version).some((e) => e.area === a.id));

/** {param} names in a path template ({C} and {G} are the character and the guild, not params). */
export function templateParams(path) {
  return [...String(path).matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).filter((p) => p !== 'C' && p !== 'G');
}

export const PROBE_ENDPOINT_IDS = PROBE_ENDPOINTS.map((e) => e.id);
export const probeEndpointById = new Map(PROBE_ENDPOINTS.map((e) => [e.id, e]));
export const probeResponseEndpoint = (id) => `ep.${id}`;
