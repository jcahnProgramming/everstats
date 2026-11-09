import { BLIZZARD_API } from '../core/config.js';
import { getSetting } from '../admin/settings.js';
import { EQUIPMENT_VERSION, parseAttributes, parseEquipment, parseGuildProfile, parseMedia, parseProfile, parseRoster, parseStatistics } from './parse.js';
import { queueItemMedia } from './items.js';
import { gradeCharacter } from '../tiers/store.js';
import { evaluateQuietly } from '../badges/rules.js';
import { currentGuildMaster, syncGuildMaster } from '../guilds/manage.js';
import { PRIORITY, enqueueMany } from './queue.js';
import {
  markProfileMissing, storeDetails, storeGuildProfile, storeMedia, storeProfile, storeRoster, takeSnapshot, updateGains, upsertKnown, upsertRuleset,
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
const PROFILE_NS = BLIZZARD_API.namespaces.profile;

export const characterPath = (slug) => BLIZZARD_API.paths.character.replace('{slug}', encodeURIComponent(slug));

const okOr = (r, what) => {
  if (r.status === 200 && r.json) return r.json;
  if (r.status === 404) return null;
  throw new RetryableError(`${what}: ${r.status === null ? `no answer (${r.error ?? 'error'})` : `HTTP ${r.status}`}`, 'blizzard');
};

export async function fetchCharacter({ db, client, now = Date.now }, item) {
  const slug = item.key;
  const priority = item.priority;
  const base = characterPath(slug);
  const prof = await client.request('profile', base, { priority, namespace: PROFILE_NS });
  const pj = okOr(prof, 'profile');
  if (!pj) {
    await db.tx((q) => markProfileMissing(q, slug));
    return 'not_found';
  }
  const p = parseProfile(pj);
  if (!p) throw new RetryableError('profile: an answer without a character in it', 'blizzard');
  if (!p.slug) p.slug = slug;

  const existing = await db.one('SELECT login_at_full, last_fetched_at, media_state, equipment_version, missing_since FROM characters WHERE id = $1', [p.id]);
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
    if (existing.media_state !== 'ok') media = mediaResult(await client.request('character-media', `${base}/character-media`, { priority, namespace: PROFILE_NS }));
    await db.tx(async (q) => {
      await storeProfile(q, p, { source: sourceOf(item) });
      if (media) await storeMedia(q, p.id, media);
      await takeSnapshot(q, p.id, { now });
      await updateGains(q, p.id, { now });
      await queueItemMedia(q, p.id, priority); // an icon past its 30-day TTL is fetched again
    });
    // Its values didn't change: its tier only needs grading if it has none yet (the full grading keeps the rest).
    if (!(await db.one('SELECT 1 AS x FROM character_tiers WHERE character_id = $1', [p.id]))) await gradeQuietly(db, p.id);
    await maybeRoster({ db }, p);
    await badgesForOwner(db, p.id);
    // 0.9.0: a character that hasn't logged in still gets its weekly collections refresh.
    const { maybeQueueCollections } = await import('../collections/fetch.js');
    await maybeQueueCollections(db, p.id, p.slug ?? slug, priority).catch(() => {});
    return 'unchanged';
  }

  const [stats, attrs, equip, media] = await Promise.all([
    client.request('achievement-statistics', `${base}/achievements/statistics`, { priority, namespace: PROFILE_NS }),
    client.request('statistics', `${base}/statistics`, { priority, namespace: PROFILE_NS }),
    client.request('equipment', `${base}/equipment`, { priority, namespace: PROFILE_NS }),
    client.request('character-media', `${base}/character-media`, { priority, namespace: PROFILE_NS }),
  ]);
  const statsJson = okOr(stats, 'achievement statistics');
  const attrsJson = optional(attrs);
  const equipJson = optional(equip);
  await db.tx(async (q) => {
    await storeProfile(q, p, { source: sourceOf(item) });
    await storeDetails(q, p.id, {
      stats: statsJson ? parseStatistics(statsJson) : null,
      attributes: attrsJson ? parseAttributes(attrsJson) : null,
      equipment: equipJson ? parseEquipment(equipJson) : null,
      media: mediaResult(media),
      loginAt: p.lastLoginAt,
    });
    await takeSnapshot(q, p.id, { now });
    await updateGains(q, p.id, { now });
    // Icons go in their own work item at this priority: the character is ready without waiting for them.
    await queueItemMedia(q, p.id, priority);
  });
  // 0.6.0: its tier from its new values, before the item finishes, so a lookup's page shows it.
  await gradeQuietly(db, p.id);
  // 0.9.0: collections refresh weekly, as part of the full fetch (collections/fetch.js).
  try {
    const { maybeQueueCollections } = await import('../collections/fetch.js');
    await maybeQueueCollections(db, p.id, p.slug, priority);
  } catch (err) {
    console.error(`[collections] couldn't queue: ${err.code ?? err.name}`);
  }
  await maybeRoster({ db }, p);
  await badgesForOwner(db, p.id);
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

const sourceOf = (item) => (item.priority === PRIORITY.roster ? 'guild' : item.priority === PRIORITY.auto ? 'account' : 'lookup');

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
async function maybeRoster({ db }, p) {
  if (!p.guild?.slug) return;
  const g = await db.one('SELECT roster_checked_at FROM guilds WHERE id = $1', [p.guild.id]);
  if (g?.roster_checked_at && Date.now() - new Date(g.roster_checked_at).getTime() < ROSTER_EVERY_MS) return;
  await enqueueMany(db, [{ kind: 'guild', key: p.guild.slug, priority: PRIORITY.roster }]);
}

export const guildPath = (slug) => `/data/wow/guild/${encodeURIComponent(slug)}`;

/**
 * A guild, by slug: its profile (the header: name, faction, ruleset, member count, created date) and its roster
 * (rank numbers and levels; level 10+ members not yet tracked are queued when roster expansion is on). 2 requests.
 * A 404 profile means Blizzard serves no guild at that slug (disbanded, renamed, or never): recorded, and the roster
 * isn't asked for.
 */
export async function fetchGuildRoster({ db, client }, item) {
  const slug = String(item.key).toLowerCase();
  const prof = await client.request('guild-profile', guildPath(slug), { priority: item.priority, namespace: PROFILE_NS });
  const pj = okOr(prof, 'guild profile');
  if (!pj) {
    await db.query("UPDATE guilds SET profile_state = 'not_found', roster_checked_at = now() WHERE slug = $1", [slug]);
    return 'not_found';
  }
  const gp = parseGuildProfile(pj);
  if (!gp) throw new RetryableError('guild profile: an answer without a guild in it', 'blizzard');
  await db.tx((q) => storeGuildProfile(q, gp));

  const r = await client.request('guild-roster', `${guildPath(gp.slug)}/roster`, { priority: item.priority, namespace: PROFILE_NS });
  const json = okOr(r, 'guild roster');
  if (!json) {
    await db.query('UPDATE guilds SET roster_checked_at = now() WHERE id = $1', [gp.id]);
    return 'profile only: no roster';
  }
  const members = parseRoster(json);
  await db.tx((q) => storeRoster(q, gp.id, members));
  // 0.7.0: who controls the guild's Everstats page follows the roster (a handover is logged), and the rank-0
  // character's owner gets Guild Master. Neither can fail the roster.
  try {
    await db.tx((q) => syncGuildMaster(q, gp.id));
    const gm = await currentGuildMaster(db, gp.id);
    if (gm?.accountId) await evaluateQuietly(db, gm.accountId);
  } catch (err) {
    console.error(`[guilds] guild master sync failed: ${err.code ?? err.name}`);
  }
  if (!(await getSetting(db, 'crawler.rosterExpansion'))) return `roster: ${members.length} members (expansion off)`;
  const eligible = members.filter((m) => Number.isInteger(m.level) && m.level >= MIN_TRACKED_LEVEL);
  const known = new Set((await db.query('SELECT id FROM characters WHERE id = ANY($1::bigint[])', [eligible.map((m) => m.id)])).map((x) => x.id));
  const fresh = eligible.filter((m) => !known.has(m.id));
  await enqueueMany(db, fresh.map((m) => ({ kind: 'character', key: m.slug, priority: PRIORITY.roster })));
  return `roster: ${members.length} members, ${fresh.length} new of level ${MIN_TRACKED_LEVEL}+`;
}

/** The ruleset index and each ruleset it links to (dynamic namespace). Rulesets are never typed in. */
export async function fetchRulesets({ db, client }) {
  const idx = await client.request('ruleset', BLIZZARD_API.paths.rulesets, { priority: PRIORITY.daily, namespace: BLIZZARD_API.namespaces.dynamic });
  const json = okOr(idx, 'ruleset index');
  const listed = (Array.isArray(json?.rulesets) ? json.rulesets : []).filter((x) => Number.isInteger(x?.id));
  let n = 0;
  for (const item of listed.slice(0, 30)) {
    const href = typeof item.key?.href === 'string' ? item.key.href : `/data/wow/ruleset/${item.id}`;
    const r = await client.request('ruleset', href, { priority: PRIORITY.daily });
    const rj = r.status === 200 ? r.json : null;
    if (rj && typeof rj.name === 'string') {
      await upsertRuleset(db, { id: item.id, name: rj.name }, { listed: true });
      n += 1;
    }
  }
  if (listed.length) await db.query('UPDATE rulesets SET listed = false WHERE NOT (id = ANY($1::int[]))', [listed.map((x) => x.id)]);
  return n;
}

export { upsertKnown };
