/**
 * EVERY FEED IS A LEADERBOARD (0.10.0, rule A7, owner's decision). Every numeric value Blizzard returns for a
 * character or a guild gets its own board automatically, for every game version, with the usual rules (overall, weekly,
 * the rolling window, ties, zeros never ranked, freshness, pins, share cards). Nobody approves boards one by one.
 * Whether a board counts toward a TIER is a separate thing: the owner's Discovery decisions (tiers/counting.js).
 *
 * A board is keyed by (game version, region, realm category, SOURCE FEED, field). Version, region and realm category
 * are the character's (statistics.game_version, the character's ruleset_id); feed + field are the statistic's derived
 * key here: "feed:{feedId}:{path}". So two values never merge onto one board because they look alike: the same field on
 * Forever and on Retail is two statistics, and "honorable kills" from the statistics feed and from the PvP summary are
 * two boards, named apart: "Honorable kills (PvP summary)".
 *
 * Feeds Blizzard's achievement statistics (one statistic per Blizzard id, recordStatistics) and Everstats' collection
 * counts (collections/registry.js COUNTS and FAMILIES) are boards already; FEEDS below are every other character or
 * guild response, walked by numericFields() with ONE set of skip rules (SKIP_RULES), so the skip list is a list, not a
 * pile of special cases. Every skipped field is reported with its reason (the probe's export and the Discovery page).
 *
 *   FEEDS: { id, label (what a board's name says in brackets), group (the category it is filed under, Discovery can
 *            re-file it), subject 'character' | 'guild', path (suffix to the character's / guild's own path),
 *            collectionList? (the response is a collection: its per-item numbers are not boards; its count is) }
 *   numericFields(feedId, json) → { fields: [{ key, name, value, group }], skipped: [{ path, reason }] }
 */
export const FEED_PREFIX = 'feed:';
export const NEVER_STORE = Object.freeze(['position', 'bind_position', 'wow_account']); // never stored, shown or logged
const MAX_DEPTH = 6; // a primary profession's skill is at primaries[].tiers[].skill_points (depth 5)
const MAX_FIELDS = 600;

export const FEEDS = Object.freeze([
  { id: 'profile', label: 'profile', group: 'Character', subject: 'character', path: '' },
  { id: 'statistics', label: 'character stats', group: 'Character', subject: 'character', path: '/statistics' },
  { id: 'equipment', label: 'equipment', group: 'Character', subject: 'character', path: '/equipment' },
  { id: 'reputations', label: 'reputations', group: 'Reputation', subject: 'character', path: '/reputations' },
  { id: 'professions', label: 'professions', group: 'Professions', subject: 'character', path: '/professions' },
  { id: 'pvp-summary', label: 'PvP summary', group: 'PvP', subject: 'character', path: '/pvp-summary' },
  { id: 'mythic-keystone-profile', label: 'Mythic+ profile', group: 'Mythic+', subject: 'character', path: '/mythic-keystone-profile' },
  { id: 'achievements', label: 'achievements', group: 'Collections', subject: 'character', path: '/achievements', collectionList: true },
  { id: 'collections-pets', label: 'pets', group: 'Collections', subject: 'character', path: '/collections/pets', collectionList: true },
  { id: 'hunter-pets', label: 'hunter pets', group: 'Collections', subject: 'character', path: '/hunter-pets', collectionList: true },
  { id: 'guild-profile', label: 'guild profile', group: 'Guild', subject: 'guild', path: '' },
  { id: 'guild-achievements', label: 'guild achievements', group: 'Guild', subject: 'guild', path: '/achievements', collectionList: true },
]);
export const feedById = new Map(FEEDS.map((f) => [f.id, f]));

/**
 * The skip list, in the order the rules are tried. Each: { id, reason, test(path, key, value, ctx) }.
 * `path` is the dotted path ("melee_crit.rating", "equipped_items[HEAD].level.value"), `key` its last part.
 */
export const SKIP_RULES = Object.freeze([
  { id: 'never-store', reason: 'never stored or shown (position, bind position, WoW account)', test: (path) => NEVER_STORE.some((k) => path.split(/[.[\]]/).includes(k)) },
  { id: 'links', reason: 'a link, not a value', test: (path, key) => key === 'href' || path.startsWith('_links') || /(^|\.)key$/.test(path) },
  { id: 'id', reason: 'an id, not an amount', test: (path, key) => key === 'id' || /_id$|Id$/.test(key) },
  { id: 'timestamp', reason: 'a time, not an amount', test: (path, key) => /timestamp|_at$|^date$|_date$|time$/i.test(key) },
  { id: 'non-numeric', reason: 'not a number (text, true/false or empty)', test: (path, key, value) => typeof value !== 'number' },
  { id: 'not-finite', reason: 'not a finite number', test: (path, key, value) => !Number.isFinite(value) },
  { id: 'collection-item', reason: 'a value of one item inside a collection list: the list’s count is its board', test: (path, key, value, ctx) => ctx.collectionList && path.includes('[') },
  { id: 'unkeyed-list', reason: 'inside a list whose items carry no id or type, so a board couldn’t follow the same item from one fetch to the next', test: (path) => path.includes('[#') },
  { id: 'too-deep', reason: `nested deeper than ${MAX_DEPTH} levels`, test: (path, key, value, ctx) => ctx.depth > MAX_DEPTH },
]);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
const pretty = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const SAFE = /^[A-Za-z0-9_]{1,40}$/;

/** An array item's stable identity and name: its own id/type, or a child object's (faction, slot, tier, profession …). */
function identityOf(item) {
  if (!isObj(item)) return null;
  if (Number.isSafeInteger(item.id)) return { id: String(item.id), name: nameOf(item) };
  if (typeof item.type === 'string' && SAFE.test(item.type)) return { id: item.type, name: nameOf(item) };
  // A child's TYPE first (an equipment slot: HEAD), then a child's id (a faction, a tier): the slot, not the item worn.
  const children = Object.entries(item).filter(([k, v]) => isObj(v) && k !== '_links' && k !== 'key');
  for (const [, v] of children) if (typeof v.type === 'string' && SAFE.test(v.type)) return { id: v.type, name: nameOf(v) ?? pretty(v.type.toLowerCase()) };
  for (const [k, v] of children) if (Number.isSafeInteger(v.id)) return { id: `${k}-${v.id}`, name: nameOf(v) };
  return null;
}

/** The fields of one response that are boards, and every field that isn't, with why. */
export function numericFields(feedId, json) {
  const feed = feedById.get(feedId);
  if (!feed) throw new Error(`unknown feed ${feedId}`);
  const fields = [];
  const skipped = [];
  // Reported per field SHAPE ("pets[].level"), not per item: a collection of 900 pets is one line.
  const skip = (path, rule) => skipped.push({ path: path.replace(/\[[^\]]*\]/g, '[]'), reason: rule.reason, rule: rule.id });
  const walk = (v, path, names, depth) => {
    if (fields.length >= MAX_FIELDS) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ident = identityOf(item);
        const p = ident ? `${path}[${ident.id}]` : `${path}[#${i}]`;
        if (!ident) {
          // Still reported once per list, not once per item.
          if (i === 0) walk(item, p.replace(/\[#0\]$/, '[#]'), names, depth + 1);
          return;
        }
        walk(item, p, [...names, ident.name ?? ident.id], depth + 1);
      });
      return;
    }
    if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === '_links') continue;
        const p = path ? `${path}.${k}` : k;
        if (isObj(x) && typeof x.href === 'string' && Object.keys(x).length === 1) continue; // a bare link
        // A value object ({ value, display_string }, { effective, base }, { raw, value, max }) names its parent.
        // A list's own name isn't repeated: its items are named ("Stormwind: Standing", not "Reputations: Stormwind …").
        walk(x, p, isObj(x) ? [...names, pretty(k)] : names, depth + 1);
      }
      return;
    }
    const key = path.split('.').at(-1).replace(/\[.*\]$/, '');
    const ctx = { depth, collectionList: Boolean(feed.collectionList) };
    const rule = SKIP_RULES.find((r) => r.test(path, key, v, ctx));
    if (rule) return skip(path, rule);
    const parts = path.split('.');
    const last = parts.at(-1);
    // "melee_crit.rating" → "Melee crit: rating"; "equipped_items[HEAD].level.value" → "Head: level".
    const nameParts = [...names];
    if (!['value', 'effective'].includes(last) || nameParts.length === 0) nameParts.push(pretty(last));
    // A tier named like its profession reads "Herbalism: Skill points", not "Herbalism: Herbalism: …".
    const name = `${nameParts.filter((x, i, a) => x && x !== a[i - 1]).join(': ')} (${feed.label})`.slice(0, 200);
    fields.push({ key: `${FEED_PREFIX}${feed.id}:${path}`.slice(0, 200), name, value: v, group: feed.group, path });
  };
  walk(json ?? null, '', [], 0);
  // A path reported for several items of an unkeyed list is listed once.
  const seen = new Set();
  return { fields, skipped: skipped.filter((s) => !seen.has(`${s.path}|${s.rule}`) && seen.add(`${s.path}|${s.rule}`)) };
}

/** Does a derived statistic key come from a feed? → { feedId, path } or null. */
export function feedOfKey(key) {
  const k = String(key ?? '');
  if (!k.startsWith(FEED_PREFIX)) return null;
  const rest = k.slice(FEED_PREFIX.length);
  const i = rest.indexOf(':');
  return i > 0 ? { feedId: rest.slice(0, i), path: rest.slice(i + 1) } : null;
}
