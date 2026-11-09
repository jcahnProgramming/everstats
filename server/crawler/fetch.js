import { BLIZZARD_API } from '../core/config.js';
import { getSetting } from '../admin/settings.js';
import { parseAttributes, parseEquipment, parseMedia, parseProfile, parseRoster, parseStatistics } from './parse.js';
import { PRIORITY, enqueueMany } from './queue.js';
import { markProfileMissing, storeDetails, storeMedia, storeProfile, takeSnapshot, updateGains, upsertKnown, upsertRuleset } from './store.js';

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
 * A guild, by slug: the roster (1 request); members of level 10+ not yet tracked are queued at roster priority.
 */
export class RetryableError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export const MIN_TRACKED_LEVEL = 10;
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

  const existing = await db.one('SELECT login_at_full, last_fetched_at, media_state FROM characters WHERE id = $1', [p.id]);
  const unchanged = item.mode === 'check' && existing?.last_fetched_at && p.lastLoginAt && existing.login_at_full
    && new Date(existing.login_at_full).getTime() === new Date(p.lastLoginAt).getTime();

  if (unchanged) {
    let media = null;
    if (existing.media_state !== 'ok') media = mediaResult(await client.request('character-media', `${base}/character-media`, { priority, namespace: PROFILE_NS }));
    await db.tx(async (q) => {
      await storeProfile(q, p, { source: sourceOf(item) });
      if (media) await storeMedia(q, p.id, media);
      await takeSnapshot(q, p.id, { now });
      await updateGains(q, p.id, { now });
    });
    await maybeRoster({ db }, p);
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
  });
  await maybeRoster({ db }, p);
  return 'fetched';
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

/** Queues the character's guild roster, at most once a day, when roster expansion is on. */
async function maybeRoster({ db }, p) {
  if (!p.guild?.slug) return;
  if (!(await getSetting(db, 'crawler.rosterExpansion'))) return;
  const g = await db.one('SELECT roster_checked_at FROM guilds WHERE id = $1', [p.guild.id]);
  if (g?.roster_checked_at && Date.now() - new Date(g.roster_checked_at).getTime() < ROSTER_EVERY_MS) return;
  await enqueueMany(db, [{ kind: 'guild', key: p.guild.slug, priority: PRIORITY.roster }]);
}

export async function fetchGuildRoster({ db, client }, item) {
  const slug = item.key;
  const r = await client.request('guild-roster', `/data/wow/guild/${encodeURIComponent(slug)}/roster`, { priority: item.priority, namespace: PROFILE_NS });
  const json = okOr(r, 'guild roster');
  if (!json) {
    await db.query('UPDATE guilds SET roster_checked_at = now() WHERE slug = $1', [slug]);
    return 'not_found';
  }
  const members = parseRoster(json);
  const eligible = members.filter((m) => Number.isInteger(m.level) && m.level >= MIN_TRACKED_LEVEL);
  const known = new Set((await db.query('SELECT id FROM characters WHERE id = ANY($1::bigint[])', [eligible.map((m) => m.id)])).map((x) => x.id));
  const fresh = eligible.filter((m) => !known.has(m.id));
  await db.query('UPDATE guilds SET roster_checked_at = now(), roster_members = $2 WHERE slug = $1', [slug, members.length]);
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
