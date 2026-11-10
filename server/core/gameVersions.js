/**
 * GAME VERSIONS and REGIONS (0.10.0): the ONE place a game version, a region, an API host, an OAuth host or a namespace
 * is written. Everything else asks this file (or core/config.js, which reads it). `server/test/game-versions.test.js`
 * greps the server and client for namespace strings, version ids and region literals outside it.
 *
 * Sources (read 2026-11-09, as JSON from community.developer.battle.net/api/pages/content/documentation/…):
 *   - guides/regionality-and-apis: API hosts us/eu/kr/tw.api.blizzard.com (China: gateway.battlenet.com.cn, a separate
 *     account partition, not planned); locale defaults to en_US; US locales en_US, es_MX, pt_BR.
 *   - guides/using-oauth: authorize/token at https://oauth.battle.net for US, EU and APAC ("APAC … replaces the
 *     previously-used kr and tw regions"); userinfo https://oauth.battle.net/userinfo; tokens last 24 hours.
 *   - world-of-warcraft/guides/namespaces: retail static-{region}, dynamic-{region}, profile-{region}.
 *   - world-of-warcraft-classic/guides/namespaces: Classic Era classic1x, Progression classic (Mists of Pandaria Classic
 *     at the time), Anniversary classicann (Burning Crusade Classic Anniversary) — Anniversary is NOT classic1x.
 *     Hardcore and Season of Discovery: not stated (the 0.10.0 probe records how their realms are told apart).
 *   - WoW Forever: in no Blizzard doc. profile-forever-{region} / dynamic-forever-{region} / a versioned static
 *     namespace are what discovery runs 1–2 and the 0.8.3 probe saw.
 *
 * A version:
 *   id            stable, stored in every per-version row (game_version) and used in URLs (/{id}/{region}/…)
 *   name          what people read                    short  a tight label (admin selectors)
 *   regions       region ids this version can be read in
 *   namespaces    { profile, dynamic } patterns with {region}; static is NEVER written: it is detected from the API's
 *                 own links and must match `staticPattern` (a versioned build like static-1.60.1_70399-forever-us, or a
 *                 plain static-us on retail; both detected the same way). A build segment starts with a digit, so
 *                 retail's pattern can never match a classic namespace (static-classic-us).
 *   staticPlain   0.10.1: the version's PLAIN static namespace (no build segment), as Blizzard's namespace guides write
 *                 it. Probes #5 (Retail) and #6 (Classic) found every static index 404 and every search empty in the
 *                 versioned namespace their links named, so the probe asks static indexes in BOTH (probe/staticCheck.js)
 *                 and uses whichever answers with real data. Forever: null. Its plain static-forever-{region} answers
 *                 403, so Forever keeps the detected versioned namespace exactly as before.
 *   realms        false: realmless (Forever: /profile/wow/character/{name-surname}); true: realm paths
 *                 (/profile/wow/character/{realmSlug}/{name}, /data/wow/guild/{realmSlug}/{guild})
 *   realmCategory where a character's "realm category" (what tiers and boards are graded within) comes from, and what
 *                 copy calls it. 'ruleset': the character profile's ruleset (Blizzard's /data/wow/ruleset/index lists
 *                 them; Forever's are Normal / PvP / Roleplay / Roleplay PvP today, never typed in). 'realm-type': the
 *                 realm's type from realm/{slug} (NORMAL, PVP, RP… as Blizzard names them). The categories themselves
 *                 are always data.
 *   nativeIds     true for the version whose rows predate 0.10.0: there, Everstats' id IS Blizzard's id (characters,
 *                 guilds, rulesets, statistics), so nothing existing moved. Every other version's ids are allocated
 *                 (core/localIds.js) so two versions' Blizzard ids can never collide.
 *   enabled       visible to players and crawled, always (the primary version).
 *   switchable    0.11.1: BUILT (pages, crawl, boards, tiers) and switched on or off by the admin at Features (the boolean
 *                 admin setting `versions.{id}`, default off; core/versionSwitch.js keeps each process's copy fresh).
 *                 A version that is neither enabled nor switchable isn't built yet and can't be switched on anywhere.
 *   realmCategory.source 'region' (0.11.1, owner's decision for Retail): ONE pool per region. Every player realm of the
 *                 region is graded and ranked together; the realm's type (NORMAL, RP) is kept on the character and is
 *                 only a board FILTER (`boardFilters`), never a separate pool.
 *   categoryRenames  Blizzard statistic categories this version files under another name on our side (Retail's "Legacy"
 *                 is "Past seasons", so it never reads like Forever's Legacy Points).
 *   tierGroups    the owner's group choices for a version that isn't the native one, applied ONCE by the worker
 *                 (tiers/groups.js seedVersionGroups); the owner changes any of them later in Discovery.
 *   seasons       season boards (stats/seasons.js): Mythic+ (current season's rating and best run) and the PvP brackets
 *                 asked for, each keyed by Blizzard's season id.
 *   collections   backfill (the daily first-fetch batch; false = on demand only), accountWide (pages say so), decor.
 *   seeding       how untracked characters are found besides lookups and sign-ins: rosters of guilds people open and
 *                 the current Mythic+ leaderboards, each capped per day by an admin setting. Never a realm-wide crawl.
 *   leaderboardCharacters  where the PROBE may pick a character besides the admin's account (discovery/probe).
 *   primary       the version every existing (unprefixed) URL means: /c/{slug}, /g/{slug}, /leaderboards/… .
 *   eraFamily     the Classic Era family (Era and whatever shares classic1x, plus Anniversary): the probe asks how its
 *                 realms are told apart.
 */
export const GAME_VERSIONS = Object.freeze([
  {
    id: 'forever', name: 'WoW Forever', short: 'Forever', regions: ['us', 'eu', 'kr', 'tw'],
    namespaces: { profile: 'profile-forever-{region}', dynamic: 'dynamic-forever-{region}' },
    staticPattern: '^static-\\d[A-Za-z0-9._]*-forever-{region}$', staticPlain: null,
    realms: false, realmCategory: { source: 'ruleset', label: 'ruleset', plural: 'rulesets' },
    nativeIds: true, enabled: true, primary: true,
    collections: { backfill: true, accountWide: false, decor: false },
  },
  {
    id: 'retail', name: 'World of Warcraft', short: 'Retail', regions: ['us', 'eu', 'kr', 'tw'],
    namespaces: { profile: 'profile-{region}', dynamic: 'dynamic-{region}' },
    staticPattern: '^static-(?:\\d[A-Za-z0-9._]*-)?{region}$', staticPlain: 'static-{region}',
    realms: true, realmCategory: { source: 'region', label: 'region', plural: 'regions' },
    boardFilters: [{ id: 'realm-type', label: 'Realm type' }],
    nativeIds: false, enabled: false, switchable: true, primary: false,
    categoryRenames: { Legacy: 'Past seasons' },
    tierGroups: {
      counts: ['Dungeons & Raids', 'Combat', 'Adventure', 'Professions', 'PvP', 'Character', 'Delves'],
      category: ['Social', 'Camping & Hearth', 'Pet Battles'],
      none: ['Deaths & mishaps', 'Past seasons', 'Legion: Remix', 'Dastardly Duos', 'Reputation', 'Collections', 'Guild'],
    },
    seasons: { mythicPlus: true, pvpBrackets: ['2v2', '3v3', 'rbg'] },
    collections: { backfill: false, accountWide: true, decor: true },
    seeding: { openedGuildRosters: true, mythicLeaderboards: true },
    leaderboardCharacters: 'mythic-leaderboard',
  },
  {
    id: 'classic', name: 'WoW Classic (progression)', short: 'Classic', regions: ['us', 'eu', 'kr', 'tw'],
    namespaces: { profile: 'profile-classic-{region}', dynamic: 'dynamic-classic-{region}' },
    staticPattern: '^static-(?:\\d[A-Za-z0-9._]*-)?classic-{region}$', staticPlain: 'static-classic-{region}',
    realms: true, realmCategory: { source: 'realm-type', label: 'realm type', plural: 'realm types' },
    nativeIds: false, enabled: false, primary: false, leaderboardCharacters: 'challenge-mode',
  },
  {
    // Era, and whichever of Hardcore / Season of Discovery live in classic1x: the probe records how realms differ.
    id: 'classic-era', name: 'WoW Classic Era', short: 'Classic Era', regions: ['us', 'eu', 'kr', 'tw'],
    namespaces: { profile: 'profile-classic1x-{region}', dynamic: 'dynamic-classic1x-{region}' },
    staticPattern: '^static-(?:\\d[A-Za-z0-9._]*-)?classic1x-{region}$', staticPlain: 'static-classic1x-{region}',
    realms: true, realmCategory: { source: 'realm-type', label: 'realm type', plural: 'realm types' },
    nativeIds: false, enabled: false, primary: false, eraFamily: true, leaderboardCharacters: 'challenge-mode',
  },
  {
    // Not in the 0.10.0 brief: Blizzard's Classic namespaces guide gives Anniversary its own namespace.
    id: 'classic-anniversary', name: 'WoW Classic Anniversary', short: 'Anniversary', regions: ['us', 'eu', 'kr', 'tw'],
    namespaces: { profile: 'profile-classicann-{region}', dynamic: 'dynamic-classicann-{region}' },
    staticPattern: '^static-(?:\\d[A-Za-z0-9._]*-)?classicann-{region}$', staticPlain: 'static-classicann-{region}',
    realms: true, realmCategory: { source: 'realm-type', label: 'realm type', plural: 'realm types' },
    nativeIds: false, enabled: false, primary: false, eraFamily: true, leaderboardCharacters: 'challenge-mode',
  },
].map((v) => Object.freeze(v)));

/**
 * A region: its API host, its OAuth host (one for US, EU and APAC), the namespace suffix and the default locale
 * (Blizzard: en_US unless asked; for the others, the first locale Blizzard lists for the region, our choice).
 * Only `enabled` regions are accepted by config (REGION) until 1.0.
 */
export const REGIONS = Object.freeze([
  { id: 'us', name: 'Americas', apiHost: 'https://us.api.blizzard.com', oauthHost: 'https://oauth.battle.net', suffix: 'us', locale: 'en_US', enabled: true },
  { id: 'eu', name: 'Europe', apiHost: 'https://eu.api.blizzard.com', oauthHost: 'https://oauth.battle.net', suffix: 'eu', locale: 'en_GB', enabled: false },
  { id: 'kr', name: 'Korea', apiHost: 'https://kr.api.blizzard.com', oauthHost: 'https://oauth.battle.net', suffix: 'kr', locale: 'ko_KR', enabled: false },
  { id: 'tw', name: 'Taiwan', apiHost: 'https://tw.api.blizzard.com', oauthHost: 'https://oauth.battle.net', suffix: 'tw', locale: 'zh_TW', enabled: false },
].map((r) => Object.freeze(r)));

const versionMap = new Map(GAME_VERSIONS.map((v) => [v.id, v]));
const regionMap = new Map(REGIONS.map((r) => [r.id, r]));

export const versionById = (id) => versionMap.get(String(id ?? '')) ?? null;
export const regionById = (id) => regionMap.get(String(id ?? '')) ?? null;
export const PRIMARY_VERSION = GAME_VERSIONS.find((v) => v.primary);
export const NATIVE_VERSION = GAME_VERSIONS.find((v) => v.nativeIds);
export const VERSION_IDS = Object.freeze(GAME_VERSIONS.map((v) => v.id));
export const REGION_IDS = Object.freeze(REGIONS.map((r) => r.id));

/**
 * Enabled = the registry's flag, narrowed (never widened) by GAME_VERSIONS=forever,retail in the environment, so a
 * deploy can switch a version off without a code change but can't switch on one that isn't built.
 */
// Safe in a browser too (the client imports server/crawler/queue.js, which imports this file): no process there.
const env = typeof process === 'undefined' ? {} : process.env;
const envList = String(env.GAME_VERSIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Tests only (server/test/helpers.js sets EVERSTATS_TESTING): a disabled version switched on to prove isolation.
const testEnabled = new Set();
export function enableVersionForTests(id, on = true) {
  if (env.EVERSTATS_TESTING !== '1') throw new Error('enableVersionForTests is for tests only');
  if (!versionById(id)) throw new Error(`unknown game version ${id}`);
  if (on) testEnabled.add(id);
  else testEnabled.delete(id);
}
// 0.11.1: the switchable versions the admin has switched on (Features → the version's card). Each server process keeps
// this set fresh from the `versions.{id}` settings (core/versionSwitch.js); a browser's stays empty (the client reads
// which versions are on from /api/session).
let switchedOn = new Set();
export function setSwitchedOnVersions(ids) {
  switchedOn = new Set([...ids].filter((id) => versionById(id)?.switchable));
}
export const switchableVersions = () => GAME_VERSIONS.filter((v) => v.switchable);
/** May this version run here at all (GAME_VERSIONS= in the environment narrows; nothing widens)? */
export const versionAllowedHere = (id) => envList.length === 0 || envList.includes(id);
export const isVersionEnabled = (id) => {
  if (testEnabled.has(id)) return true;
  const v = versionById(id);
  if (!v || !versionAllowedHere(id)) return false;
  return Boolean(v.enabled) || (Boolean(v.switchable) && switchedOn.has(id));
};
export const enabledVersions = () => GAME_VERSIONS.filter((v) => isVersionEnabled(v.id));
export const isRegionEnabled = (id) => Boolean(regionById(id)?.enabled);

function need(versionId, regionId) {
  const v = versionById(versionId);
  const r = regionById(regionId);
  if (!v) throw new Error(`unknown game version ${versionId}`);
  if (!r) throw new Error(`unknown region ${regionId}`);
  if (!v.regions.includes(r.id)) throw new Error(`${v.id} isn't served in region ${r.id}`);
  return { v, r };
}

/** The profile or dynamic namespace for a version in a region. Static: detect it (staticNamespaceIn / isStaticNamespace). */
export function namespaceFor(versionId, regionId, kind) {
  const { v, r } = need(versionId, regionId);
  const pattern = v.namespaces[kind];
  if (!pattern) throw new Error(`no ${kind} namespace pattern for ${v.id}: static namespaces are detected, never written`);
  return pattern.replace('{region}', r.suffix);
}

/** The version's plain static namespace in a region (0.10.1), or null where it isn't used (Forever: 403). */
export function plainStaticFor(versionId, regionId) {
  const { v, r } = need(versionId, regionId);
  return v.staticPlain ? v.staticPlain.replace('{region}', r.suffix) : null;
}

/** Is `ns` this version's static namespace in this region (a build Blizzard's links named)? */
export function isStaticNamespace(versionId, regionId, ns) {
  const { v, r } = need(versionId, regionId);
  return new RegExp(v.staticPattern.replace('{region}', r.suffix)).test(String(ns ?? ''));
}

/** Which version and region a namespace string belongs to (profile/dynamic exactly, static by pattern), or null. */
export function versionOfNamespace(ns) {
  for (const v of GAME_VERSIONS) {
    for (const rid of v.regions) {
      const r = regionById(rid);
      if (Object.values(v.namespaces).some((p) => p.replace('{region}', r.suffix) === ns)) return { version: v.id, region: r.id };
      if (new RegExp(v.staticPattern.replace('{region}', r.suffix)).test(String(ns ?? ''))) return { version: v.id, region: r.id };
    }
  }
  return null;
}

/**
 * Everything a Blizzard call needs for one (version, region): hosts, namespaces, locale and the path builders.
 * Paths are Blizzard's; realm segments appear only for a version with realms.
 */
export function blizzardContext(versionId, regionId) {
  const { v, r } = need(versionId, regionId);
  const enc = encodeURIComponent;
  const ctx = {
    version: v.id,
    region: r.id,
    apiHost: r.apiHost,
    oauthHost: r.oauthHost,
    locale: r.locale,
    realms: v.realms,
    namespaces: Object.freeze({ profile: namespaceFor(v.id, r.id, 'profile'), dynamic: namespaceFor(v.id, r.id, 'dynamic') }),
    isStatic: (ns) => isStaticNamespace(v.id, r.id, ns),
    plainStatic: v.staticPlain ? v.staticPlain.replace('{region}', r.suffix) : null,
    paths: Object.freeze({
      rulesets: '/data/wow/ruleset/index',
      // 0.11.1 (shapes: probe #7, Retail): the season index names `current_season`; a connected realm's Mythic+
      // leaderboard index lists this period's dungeon leaderboards.
      mythicSeasons: '/data/wow/mythic-keystone/season/index',
      mythicLeaderboards: (connectedRealmId) => `/data/wow/connected-realm/${Number(connectedRealmId)}/mythic-leaderboard/index`,
      realms: '/data/wow/realm/index',
      realm: (slug) => `/data/wow/realm/${enc(slug)}`,
      connectedRealms: '/data/wow/connected-realm/index',
      connectedRealmSearch: '/data/wow/search/connected-realm',
      accountCharacters: '/profile/user/wow',
    }),
    /** A character's own path: { slug } on a realmless version, { realmSlug, slug } on a realm version. */
    characterPath({ realmSlug = null, slug }) {
      if (v.realms) {
        if (!realmSlug) throw new Error(`${v.id} characters live on a realm`);
        return `/profile/wow/character/${enc(realmSlug)}/${enc(slug)}`;
      }
      return `/profile/wow/character/${enc(slug)}`;
    },
    guildPath({ realmSlug = null, slug }) {
      if (v.realms) {
        if (!realmSlug) throw new Error(`${v.id} guilds live on a realm`);
        return `/data/wow/guild/${enc(realmSlug)}/${enc(slug)}`;
      }
      return `/data/wow/guild/${enc(slug)}`;
    },
  };
  return Object.freeze(ctx);
}

/** A version's realm-category word for copy: "ruleset" on Forever, "realm type" elsewhere (registry, never a branch). */
export const categoryLabel = (versionId, { plural = false } = {}) => {
  const c = versionById(versionId)?.realmCategory;
  return c ? (plural ? c.plural : c.label) : null;
};

/** What the client may know (no hosts): ids, names, realms, the category word, enabled. */
export const publicVersions = () => GAME_VERSIONS.map((v) => ({
  id: v.id, name: v.name, short: v.short, realms: v.realms, categoryLabel: v.realmCategory.label, enabled: isVersionEnabled(v.id), primary: v.primary,
  regions: v.regions.filter(isRegionEnabled),
  // 0.11.1: what pages need to know about a version (no hosts, no namespaces).
  onePool: v.realmCategory.source === 'region', boardFilters: v.boardFilters ?? [], accountWide: Boolean(v.collections?.accountWide),
  seasons: Boolean(v.seasons), switchable: Boolean(v.switchable),
}));

/** Does this version grade and rank everyone in a region together (one realm category per region)? */
export const onePool = (versionId) => versionById(versionId)?.realmCategory.source === 'region';
/** The one pool's key and name for a region ("US realms"): built from the region id, never typed in per version. */
export const poolOf = (regionId) => ({ key: `region:${regionId}`, name: `${String(regionId).toUpperCase()} realms` });
