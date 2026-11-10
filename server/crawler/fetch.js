import { BLIZZARD_API } from '../core/config.js';
import { blizzardContext, versionById } from '../core/gameVersions.js';
import { localId } from '../core/localIds.js';
import { listedConnectedRealms, realmConnectedId, realmExclusion } from '../realms/playerRealms.js';
import { storeFeedValues } from '../stats/feedStore.js';
import { getSetting } from '../admin/settings.js';
import { EQUIPMENT_VERSION, parseAttributes, parseEquipment, parseGuildProfile, parseMedia, parseProfile, parseRoster, parseStatistics } from './parse.js';
import { queueItemMedia } from './items.js';
import { gradeCharacter } from '../tiers/store.js';
import { evaluateQuietly } from '../badges/rules.js';
import { currentGuildMaster, syncGuildMaster } from '../guilds/manage.js';
import { PRIORITY, enqueueMany } from './queue.js';
import {
  markProfileMissing, storeDetails, storeGuildProfile, storeMedia, storeProfile, storeRoster, takeSnapshot, updateGains, upsertKnown, upsertRealmCategory, upsertRuleset,
} from './store.js';

/**
 * What one crawl-queue item does. `client.request(endpoint, path, { priority })` is the crawler's paced, backed-off
 * Blizzard GET (crawler/service.js); every function here returns an outcome word and throws RetryableError when
 * Blizzard didn't answer properly (429, 5xx, no answer), so the item is tried again later.
 *
 * A character, by slug:
 *   profile (1 request). 404 → not found. Then, unless the item is a 'check' AND the profile's last_login_timestamp
 *   equals the one at the last full fetch: achievement statistics, attributes, equipment and character-media
 *   (4 more, in parallel). Unchanged → 1 request (2 while the render isn't ready yet). Either way today's snapshot is
 *   taken from the current values, so every tracked character has one a day.
 * A guild, by slug, once a day: its profile and its roster (2 requests); members of level 10+ not yet tracked are
 * queued at roster priority (when roster expansion is on).
 */
export class RetryableError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export const MIN_TRACKED_LEVEL = 10;
/** The longest a tracked character goes without a full fetch (statistics, gear, attributes, render). */
export const FULL_REFRESH_DAYS = 7;
const ROSTER_EVERY_MS = 24 * 60 * 60 * 1000;
/** The primary version's character path (realmless): what the unprefixed pages and discovery use. */
export const characterPath = (slug) => BLIZZARD_API.paths.character.replace('{slug}', encodeURIComponent(slug));

/**
 * 0.10.0: a crawl item's key names the character (or guild) within its version and region: the slug on a realmless
 * version ("path-vexley"), "{realmSlug}/{slug}" on a version with realms ("area-52/thrall"). Slugs never hold "/".
 */
export const crawlKey = ({ realmSlug = null, slug }) => (realmSlug ? `${realmSlug}/${slug}` : slug);
export function parseCrawlKey(version, key) {
  const k = String(key);
  if (!versionById(version)?.realms) return { realmSlug: null, slug: k };
  const i = k.indexOf('/');
  return i > 0 ? { realmSlug: k.slice(0, i), slug: k.slice(i + 1) } : { realmSlug: null, slug: k };
}
/** An item's scope and Blizzard context: hosts, namespaces and paths of its version and region. */
export function itemScope(item) {
  const scope = { version: item.game_version ?? BLIZZARD_API.version, region: item.region ?? BLIZZARD_API.region };
  return { scope, ctx: blizzardContext(scope.version, scope.region) };
}

const REALM_EVERY_MS = 24 * 60 * 60 * 1000;
// connected-realm/index per (database, version, region), re-read daily: which connected realms are player ones.
const listedCache = new WeakMap();
async function listedFor({ db, client }, { scope, ctx }, priority) {
  if (!listedCache.has(db)) listedCache.set(db, new Map());
  const cache = listedCache.get(db);
  const k = `${scope.version}/${scope.region}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < REALM_EVERY_MS) return hit.listed;
  const r = await client.request('connected-realm-index', ctx.paths.connectedRealms, { priority, namespace: ctx.namespaces.dynamic, version: scope.version, region: scope.region });
  const listed = listedConnectedRealms(okOr(r, 'connected-realm index'));
  cache.set(k, { at: Date.now(), listed });
  return listed;
}

/**
 * A realm version's realm: its realm category (the realm's TYPE, realm/{slug}, dynamic namespace) and, 0.10.1, whether
 * it is a player realm at all (realms/playerRealms.js rule 1: an internal realm is excluded, never crawled). Read at most
 * once a day per realm and kept in `realms`. → { categoryId, excluded }: categoryId null when Blizzard didn't say (the
 * character then has no category and is on no board until it does: never a guess); an excluded realm gets no category.
 */
export async function realmInfo({ db, client }, { scope, ctx }, realm, priority) {
  if (!realm?.slug) return { categoryId: null, excluded: null };
  const known = await db.one('SELECT category_id, excluded, fetched_at FROM realms WHERE game_version = $1 AND region = $2 AND slug = $3', [scope.version, scope.region, realm.slug]);
  if (known && Date.now() - new Date(known.fetched_at).getTime() < REALM_EVERY_MS) return { categoryId: known.category_id, excluded: known.excluded };
  const r = await client.request('realm', ctx.paths.realm(realm.slug), { priority, namespace: ctx.namespaces.dynamic, version: scope.version, region: scope.region });
  const json = okOr(r, 'realm');
  const connectedRealmId = realmConnectedId(json);
  const { excluded } = json ? realmExclusion(connectedRealmId, await listedFor({ db, client }, { scope, ctx }, priority)) : { excluded: null };
  const type = json?.type && typeof json.type === 'object' ? json.type : null;
  const key = !excluded && typeof type?.type === 'string' ? type.type : null;
  return db.tx(async (q) => {
    const categoryId = key ? await upsertRealmCategory(q, { key, name: typeof type.name === 'string' ? type.name : key }, { scope }) : null;
    await q.query(
      `INSERT INTO realms (game_version, region, slug, blizzard_id, name, type_key, type_name, category_id, connected_realm_id, excluded, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (game_version, region, slug) DO UPDATE SET blizzard_id = EXCLUDED.blizzard_id, name = EXCLUDED.name, type_key = EXCLUDED.type_key,
         type_name = EXCLUDED.type_name, category_id = EXCLUDED.category_id, connected_realm_id = EXCLUDED.connected_realm_id,
         excluded = EXCLUDED.excluded, fetched_at = now()`,
      [scope.version, scope.region, realm.slug, Number.isSafeInteger(json?.id) ? json.id : realm.id, typeof json?.name === 'string' ? json.name.slice(0, 80) : realm.name,
        excluded ? null : key, excluded ? null : (type?.name ?? null), categoryId, connectedRealmId, excluded],
    );
    return { categoryId, excluded };
  });
}
const usesRealmTypes = (scope) => versionById(scope.version)?.realmCategory.source === 'realm-type';
/** The outcome of an item on an internal realm: nothing is fetched or stored (realms/playerRealms.js). */
export const EXCLUDED_OUTCOME = 'excluded: internal realm';

const okOr = (r, what) => {
  if (r.status === 200 && r.json) return r.json;
  if (r.status === 404) return null;
  throw new RetryableError(`${what}: ${r.status === null ? `no answer (${r.error ?? 'error'})` : `HTTP ${r.status}`}`, 'blizzard');
};

export async function fetchCharacter({ db, client, now = Date.now }, item) {
  const { scope, ctx } = itemScope(item);
  const ref = parseCrawlKey(scope.version, item.key);
  const slug = ref.slug;
  const priority = item.priority;
  const base = ctx.characterPath(ref);
  const ask = (endpoint, path) => client.request(endpoint, path, { priority, namespace: ctx.namespaces.profile, version: scope.version, region: scope.region });
  // 0.10.1: never a character on an internal realm (realms/playerRealms.js): its realm is read first (cached a day).
  if (usesRealmTypes(scope) && ref.realmSlug && (await realmInfo({ db, client }, { scope, ctx }, { slug: ref.realmSlug }, priority)).excluded) return EXCLUDED_OUTCOME;
  const prof = await ask('profile', base);
  const pj = okOr(prof, 'profile');
  if (!pj) {
    await db.tx((q) => markProfileMissing(q, ref, { scope }));
    return 'not_found';
  }
  const p = parseProfile(pj, { realms: ctx.realms });
  if (!p) throw new RetryableError('profile: an answer without a character in it', 'blizzard');
  if (!p.slug) p.slug = slug;
  if (ctx.realms && !p.realm && ref.realmSlug) p.realm = { id: null, slug: ref.realmSlug, name: null };
  // 0.10.0: Everstats' id for it (Blizzard's own on the native version) and, on a realm version, its realm's category.
  const id = await localId(db, { kind: 'character', version: scope.version, region: scope.region, blizzardId: p.id });
  const realmOfP = usesRealmTypes(scope) ? await realmInfo({ db, client }, { scope, ctx }, p.realm, priority) : null;
  if (realmOfP?.excluded) return EXCLUDED_OUTCOME;
  const rulesetId = realmOfP ? realmOfP.categoryId : undefined;
  const store = { source: sourceOf(item), scope, rulesetId };

  const existing = await db.one('SELECT login_at_full, last_fetched_at, media_state, equipment_version, missing_since FROM characters WHERE id = $1', [id]);
  // Equipment stored before 0.4.1 has no tooltip fields: one full fetch brings them in, logged in or not.
  const unchanged = item.mode === 'check' && existing?.last_fetched_at && p.lastLoginAt && existing.login_at_full
    && new Date(existing.login_at_full).getTime() === new Date(p.lastLoginAt).getTime()
    && existing.equipment_version >= EQUIPMENT_VERSION
    // Blizzard's 30-day rule (0.4.2): statistics, gear and attributes are refetched at least every FULL_REFRESH_DAYS
    // even for a character who hasn't logged in, so they never age out of the retention window while it's active.
    && Date.now() - new Date(existing.last_fetched_at).getTime() < FULL_REFRESH_DAYS * 24 * 60 * 60 * 1000
    // Back after being missing: its values were taken off the boards, so fetch them again.
    && !existing.missing_since;

  if (unchanged) {
    let media = null;
    if (existing.media_state !== 'ok') media = mediaResult(await ask('character-media', `${base}/character-media`));
    await db.tx(async (q) => {
      await storeProfile(q, p, store);
      if (media) await storeMedia(q, id, media);
      await storeFeedValues(q, id, 'profile', pj); // 0.10.0 rule A7: every number a feed returns is a board
      await takeSnapshot(q, id, { now });
      await updateGains(q, id, { now });
      await queueItemMedia(q, id, priority); // an icon past its 30-day TTL is fetched again
    });
    // Its values didn't change: its tier only needs grading if it has none yet (the full grading keeps the rest).
    if (!(await db.one('SELECT 1 AS x FROM character_tiers WHERE character_id = $1', [id]))) await gradeQuietly(db, id);
    await maybeRoster({ db }, p, scope);
    await badgesForOwner(db, id);
    // 0.9.0: a character that hasn't logged in still gets its weekly collections refresh.
    const { maybeQueueCollections } = await import('../collections/fetch.js');
    await maybeQueueCollections(db, id, p.slug ?? slug, priority).catch(() => {});
    return 'unchanged';
  }

  const [stats, attrs, equip, media] = await Promise.all([
    ask('achievement-statistics', `${base}/achievements/statistics`),
    ask('statistics', `${base}/statistics`),
    ask('equipment', `${base}/equipment`),
    ask('character-media', `${base}/character-media`),
  ]);
  const statsJson = okOr(stats, 'achievement statistics');
  const attrsJson = optional(attrs);
  const equipJson = optional(equip);
  await db.tx(async (q) => {
    await storeProfile(q, p, store);
    await storeDetails(q, id, {
      stats: statsJson ? parseStatistics(statsJson) : null,
      attributes: attrsJson ? parseAttributes(attrsJson) : null,
      equipment: equipJson ? parseEquipment(equipJson) : null,
      media: mediaResult(media),
      loginAt: p.lastLoginAt,
    });
    // 0.10.0 rule A7: every number these feeds return is a board (stats/feeds.js); a feed that didn't answer keeps its old values.
    await storeFeedValues(q, id, 'profile', pj);
    await storeFeedValues(q, id, 'statistics', attrsJson);
    await storeFeedValues(q, id, 'equipment', equipJson);
    await takeSnapshot(q, id, { now });
    await updateGains(q, id, { now });
    // Icons go in their own work item at this priority: the character is ready without waiting for them.
    await queueItemMedia(q, id, priority);
  });
  // 0.6.0: its tier from its new values, before the item finishes, so a lookup's page shows it.
  await gradeQuietly(db, id);
  // 0.9.0: collections refresh weekly, as part of the full fetch (collections/fetch.js).
  try {
    const { maybeQueueCollections } = await import('../collections/fetch.js');
    await maybeQueueCollections(db, id, p.slug, priority);
  } catch (err) {
    console.error(`[collections] couldn't queue: ${err.code ?? err.name}`);
  }
  await maybeRoster({ db }, p, scope);
  await badgesForOwner(db, id);
  return 'fetched';
}

/** 0.7.0: an owned character's fetch (the daily refresh included) re-checks its owner's automatic badges. */
async function badgesForOwner(db, characterId) {
  const row = await db.one('SELECT owner_account_id FROM characters WHERE id = $1', [characterId]);
  if (row?.owner_account_id) await evaluateQuietly(db, row.owner_account_id);
}

/** A tier that couldn't be graded never fails the fetch: the next full grading includes the character anyway. */
async function gradeQuietly(db, characterId) {
  try {
    await gradeCharacter(db, characterId);
  } catch (err) {
    console.error(`[tiers] character grading failed: ${err.code ?? err.name}`);
  }
}

const sourceOf = (item) => (item.priority === PRIORITY.roster || item.priority === PRIORITY.guild ? 'guild' : item.priority === PRIORITY.auto ? 'account' : 'lookup');

/** Gear and attributes are secondary: a failure there keeps the old ones rather than failing the whole fetch. */
const optional = (r) => (r.status === 200 && r.json ? r.json : null);

/** character-media: 200 → the render URLs; 404 with a 200 profile → "not ready yet"; anything else → failed. */
function mediaResult(r) {
  if (r.status === 200 && r.json) {
    const assets = parseMedia(r.json);
    return Object.keys(assets).length ? { state: 'ok', assets } : { state: 'not_ready' };
  }
  if (r.status === 404) return { state: 'not_ready' };
  return { state: 'failed' };
}

/**
 * Queues the character's guild (profile + roster), at most once a day. 0.5.0: always, because guild pages need the
 * roster; the crawler.rosterExpansion setting now decides only whether the roster's members are queued as well.
 */
async function maybeRoster({ db }, p, scope) {
  if (!p.guild?.slug) return;
  const g = await db.one('SELECT roster_checked_at FROM guilds WHERE game_version = $1 AND region = $2 AND blizzard_id = $3', [scope.version, scope.region, p.guild.id]);
  if (g?.roster_checked_at && Date.now() - new Date(g.roster_checked_at).getTime() < ROSTER_EVERY_MS) return;
  // 0.10.0 capped seeding: on any version but the primary, a roster is read only for a guild someone opens. A
  // character's own fetch never queues its guild there.
  if (scope.version !== BLIZZARD_API.version) return;
  const realmSlug = p.guild.realm?.slug ?? p.realm?.slug ?? null;
  await enqueueMany(db, [{ kind: 'guild', key: crawlKey({ realmSlug, slug: p.guild.slug }), priority: PRIORITY.roster, ...scope }]);
}

/** The primary version's guild path (realmless). Per-version code uses ctx.guildPath. */
export const guildPath = (slug) => `/data/wow/guild/${encodeURIComponent(slug)}`;

/**
 * A guild, by slug: its profile (the header: name, faction, ruleset, member count, created date) and its roster
 * (rank numbers and levels; level 10+ members not yet tracked are queued when roster expansion is on). 2 requests.
 * A 404 profile means Blizzard serves no guild at that slug (disbanded, renamed, or never): recorded, and the roster
 * isn't asked for.
 */
export async function fetchGuildRoster({ db, client }, item) {
  const { scope, ctx } = itemScope(item);
  const ref = parseCrawlKey(scope.version, String(item.key).toLowerCase());
  const slug = ref.slug;
  const ask = (endpoint, path) => client.request(endpoint, path, { priority: item.priority, namespace: ctx.namespaces.profile, version: scope.version, region: scope.region });
  if (usesRealmTypes(scope) && ref.realmSlug && (await realmInfo({ db, client }, { scope, ctx }, { slug: ref.realmSlug }, item.priority)).excluded) return EXCLUDED_OUTCOME;
  const prof = await ask('guild-profile', ctx.guildPath(ref));
  const pj = okOr(prof, 'guild profile');
  if (!pj) {
    await db.query(
      `UPDATE guilds SET profile_state = 'not_found', roster_checked_at = now()
        WHERE game_version = $1 AND region = $2 AND coalesce(realm_slug, '') = coalesce($3, '') AND slug = $4`,
      [scope.version, scope.region, ref.realmSlug, slug],
    );
    await noteFetchAll(db, { key: item.key, members: null, problem: 'Blizzard serves no guild at this address.', scope });
    return 'not_found';
  }
  const gp = parseGuildProfile(pj, { realms: ctx.realms });
  if (!gp) throw new RetryableError('guild profile: an answer without a guild in it', 'blizzard');
  if (ctx.realms && !gp.realm && ref.realmSlug) gp.realm = { id: null, slug: ref.realmSlug, name: null };
  const guildRealm = usesRealmTypes(scope) ? await realmInfo({ db, client }, { scope, ctx }, gp.realm, item.priority) : null;
  if (guildRealm?.excluded) return EXCLUDED_OUTCOME;
  const rulesetId = guildRealm ? guildRealm.categoryId : undefined;
  // 0.10.0: from here on the guild is Everstats' id (Blizzard's own on the native version).
  const guildId = await db.tx((q) => storeGuildProfile(q, gp, { scope, rulesetId }));
  const guild = { ...gp, id: guildId, blizzardId: gp.id };

  const r = await ask('guild-roster', `${ctx.guildPath({ realmSlug: gp.realm?.slug ?? null, slug: gp.slug })}/roster`);
  const json = okOr(r, 'guild roster');
  if (!json) {
    await db.query('UPDATE guilds SET roster_checked_at = now() WHERE id = $1', [guildId]);
    await noteFetchAll(db, { key: item.key, guild, members: null, problem: 'Blizzard sent no roster for this guild.', scope });
    return 'profile only: no roster';
  }
  const parsed = parseRoster(json, { realms: ctx.realms });
  // Members carry Everstats' ids from here (storeRoster maps them).
  const members = (await db.tx((q) => storeRoster(q, guildId, parsed, { scope }))).map((m) => ({ ...m, blizzardId: m.id, id: m.localId }));
  // 0.9.0: a "Fetch all members" waiting on this roster gets its counts and its work list (guilds/fetchAll.js).
  await noteFetchAll(db, { key: item.key, guild, members, scope });
  // 0.7.0: who controls the guild's Everstats page follows the roster (a handover is logged), and the rank-0
  // character's owner gets Guild Master. Neither can fail the roster.
  try {
    await db.tx((q) => syncGuildMaster(q, guildId));
    const gm = await currentGuildMaster(db, guildId);
    if (gm?.accountId) await evaluateQuietly(db, gm.accountId);
  } catch (err) {
    console.error(`[guilds] guild master sync failed: ${err.code ?? err.name}`);
  }
  // 0.10.0 capped seeding: roster expansion (queueing every member) is for the primary version only; elsewhere members
  // are fetched only when someone asks (a guild page's "Fetch all members", inside that version's budget ceiling).
  if (scope.version !== BLIZZARD_API.version) return `roster: ${members.length} members (${scope.version}: no expansion)`;
  if (!(await getSetting(db, 'crawler.rosterExpansion'))) return `roster: ${members.length} members (expansion off)`;
  const eligible = members.filter((m) => Number.isInteger(m.level) && m.level >= MIN_TRACKED_LEVEL);
  const known = new Set((await db.query('SELECT id FROM characters WHERE id = ANY($1::bigint[])', [eligible.map((m) => m.id)])).map((x) => x.id));
  const fresh = eligible.filter((m) => !known.has(m.id));
  await enqueueMany(db, fresh.map((m) => ({ kind: 'character', key: crawlKey(m), priority: PRIORITY.roster, ...scope })));
  return `roster: ${members.length} members, ${fresh.length} new of level ${MIN_TRACKED_LEVEL}+`;
}

/** A guild fetch's step 1 never fails the roster it waits on. */
async function noteFetchAll(db, args) {
  try {
    const { noteRoster } = await import('../guilds/fetchAll.js');
    await db.tx((q) => noteRoster(q, args));
  } catch (err) {
    console.error(`[guild-fetch] roster note failed: ${err.code ?? err.name}`);
  }
}

/** The ruleset index and each ruleset it links to (dynamic namespace). Rulesets are never typed in. */
export async function fetchRulesets({ db, client }, scope = { version: BLIZZARD_API.version, region: BLIZZARD_API.region }) {
  // 0.10.0: only a version whose realm categories ARE rulesets has a ruleset index to read.
  if (versionById(scope.version)?.realmCategory.source !== 'ruleset') return 0;
  const ctx = blizzardContext(scope.version, scope.region);
  const opts = { priority: PRIORITY.daily, version: scope.version, region: scope.region };
  const idx = await client.request('ruleset', ctx.paths.rulesets, { ...opts, namespace: ctx.namespaces.dynamic });
  const json = okOr(idx, 'ruleset index');
  const listed = (Array.isArray(json?.rulesets) ? json.rulesets : []).filter((x) => Number.isInteger(x?.id));
  let n = 0;
  for (const item of listed.slice(0, 30)) {
    const href = typeof item.key?.href === 'string' ? item.key.href : `/data/wow/ruleset/${item.id}`;
    const r = await client.request('ruleset', href, opts);
    const rj = r.status === 200 ? r.json : null;
    if (rj && typeof rj.name === 'string') {
      await upsertRuleset(db, { id: item.id, name: rj.name }, { listed: true, scope });
      n += 1;
    }
  }
  if (listed.length) {
    await db.query(
      'UPDATE rulesets SET listed = false WHERE game_version = $2 AND region = $3 AND NOT (blizzard_id = ANY($1::bigint[]))',
      [listed.map((x) => x.id), scope.version, scope.region],
    );
  }
  return n;
}

export { upsertKnown };
