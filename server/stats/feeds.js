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

// 0.11.1: `group` is the feed's own group of Everstats-made boards (discovery/suggest.js CATEGORY_RULES files a board
// by its derived key, so these names and those rules say the same thing).
export const FEEDS = Object.freeze([
  { id: 'profile', label: 'profile', group: 'Character stats (gear)', subject: 'character', path: '' },
  { id: 'statistics', label: 'character stats', group: 'Character stats (gear)', subject: 'character', path: '/statistics' },
  { id: 'equipment', label: 'equipment', group: 'Character stats (gear)', subject: 'character', path: '/equipment' },
  { id: 'reputations', label: 'reputations', group: 'Reputations', subject: 'character', path: '/reputations' },
  { id: 'professions', label: 'professions', group: 'Profession skills', subject: 'character', path: '/professions' },
  { id: 'pvp-summary', label: 'PvP summary', group: 'Battleground maps', subject: 'character', path: '/pvp-summary' },
  { id: 'mythic-keystone-profile', label: 'Mythic+ profile', group: 'Season ratings', subject: 'character', path: '/mythic-keystone-profile' },
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
  // ---- 0.11.1: the owner's TRIM (decision 4), by what a field MEANS, for every game version. Probe #7 (Retail) made
  // 1,471 boards; these bring it to about 870 that say something about a character. `pathOnly`: the rule needs only the
  // feed and the path, so an existing board can be told it is one no longer (feedKeySkipped).
  { id: 'guild-number', pathOnly: true, reason: 'a number about the guild, not the character: guild numbers are never character boards', test: (path, key, value, ctx) => ctx.subject === 'guild' || /(^|[.\]])guild[.[]/.test(`.${path}`) },
  { id: 'covered-elsewhere', pathOnly: true, reason: 'the PvP summary’s own board since 0.9.1 (“Honorable kills (PvP summary)”): the same feed and field, so the same board', test: (path, key, value, ctx) => ctx.feed === 'pvp-summary' && !/[.[]/.test(path) },
  { id: 'display', pathOnly: true, reason: 'how a value is drawn (display text or a colour), not an amount', test: (path) => /(^|[.\]])(display|color)([.[]|$)/.test(path) },
  { id: 'item-quantity', pathOnly: true, reason: 'how many of an item sit in an equipment slot (one), not something a character achieved', test: (path, key, value, ctx) => ctx.feed === 'equipment' && key === 'quantity' },
  { id: 'item-context', pathOnly: true, reason: 'an item’s source context code, not an amount', test: (path, key) => key === 'context' },
  { id: 'sell-price', pathOnly: true, reason: 'what a vendor pays for an item, not something a character achieved', test: (path) => /(^|[.\]])sell_price([.[]|$)/.test(path) },
  { id: 'requirements', pathOnly: true, reason: 'what an item requires (a level, a skill), not what the character has', test: (path) => /(^|[.\]])requirements([.[]|$)/.test(path) },
  { id: 'durability', pathOnly: true, reason: 'an item’s durability: it changes with every fight and repair', test: (path) => /(^|[.\]])durability([.[]|$)/.test(path) },
  { id: 'timewalker-level', pathOnly: true, reason: 'the level an item scales to in Timewalking, not the character’s', test: (path, key) => key === 'timewalker_level' },
  { id: 'ceiling', pathOnly: true, reason: 'a ceiling (the most a standing, a paragon bar or a skill can reach), the same for everyone', test: (path, key) => /(^|[.\]])(standing|paragon)\.max$/.test(path) || key === 'max_skill_points' },
  { id: 'rating-normalized', pathOnly: true, reason: 'the same rating again, normalized: its rating and its value are the boards', test: (path, key) => key === 'rating_normalized' },
  { id: 'weapon-range', pathOnly: true, reason: 'a weapon’s minimum and maximum damage and its speed: the weapon’s numbers; damage per second stays', test: (path, key) => /^(main|off)_hand_(damage_min|damage_max|speed)$/.test(path) || /(^|[.\]])weapon\.(damage\.(min_value|max_value)|attack_speed\.value)$/.test(path) },
  { id: 'power', pathOnly: true, reason: 'the class resource pool (mana, rage, energy …): a different thing for each class, so not one board', test: (path, key, value, ctx) => ctx.feed === 'statistics' && path === 'power' },
  { id: 'mana-regen-duplicate', pathOnly: true, reason: 'mana regeneration is returned twice (mana_regen and mana_regen_combat): one board, the in-combat one', test: (path, key, value, ctx) => ctx.feed === 'statistics' && path === 'mana_regen' },
  { id: 'spell-penetration', pathOnly: true, reason: 'spell penetration: not a board (owner’s decision, 0.11.1)', test: (path, key, value, ctx) => ctx.feed === 'statistics' && path === 'spell_penetration' },
  { id: 'equipment', pathOnly: true, reason: 'no equipment boards (owner’s decision, 0.11.1): a worn item’s numbers change with every upgrade. The profile’s equipped and average item level are the boards', test: (path, key, value, ctx) => ctx.feed === 'equipment' },
  // One board per faction: its raw standing, or its renown level when it is a renown faction (Blizzard sends
  // renown_level instead of a tier for those). The standing's value, tier and paragon numbers are the same progress again.
  { id: 'faction-one-board', pathOnly: true, reason: 'one board per faction: its raw standing, or its renown level for a renown faction', test: (path, key, value, ctx) => ctx.feed === 'reputations' && path.includes('[') && !/\.standing\.(raw|renown_level)$/.test(path) },
  { id: 'faction-renown', reason: 'a renown faction: its renown level is its board, not its raw standing', test: (path, key, value, ctx) => ctx.feed === 'reputations' && /\.standing\.raw$/.test(path) && Number.isFinite(ctx.parent?.renown_level) },
]);

/**
 * Is this derived key a feed field the rules now leave out? Only the `pathOnly` rules can say so without the response
 * (a board that existed before a rule was added: the catalog drops it at once, its values go at the next fetch).
 */
export function feedKeySkipped(derivedKey) {
  const k = feedOfKey(derivedKey);
  const feed = k ? feedById.get(k.feedId) : null;
  if (!feed) return false;
  const key = k.path.split('.').at(-1).replace(/\[.*\]$/, '');
  const ctx = { depth: 0, collectionList: Boolean(feed.collectionList), feed: feed.id, subject: feed.subject, parent: null };
  return SKIP_RULES.some((r) => r.pathOnly && r.test(k.path, key, undefined, ctx));
}

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
  const walk = (v, path, names, depth, parent = null) => {
    if (fields.length >= MAX_FIELDS) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        const ident = identityOf(item);
        const p = ident ? `${path}[${ident.id}]` : `${path}[#${i}]`;
        if (!ident) {
          // Still reported once per list, not once per item.
          if (i === 0) walk(item, p.replace(/\[#0\]$/, '[#]'), names, depth + 1, v);
          return;
        }
        walk(item, p, [...names, ident.name ?? ident.id], depth + 1, v);
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
        walk(x, p, isObj(x) ? [...names, pretty(k)] : names, depth + 1, v);
      }
      return;
    }
    const key = path.split('.').at(-1).replace(/\[.*\]$/, '');
    const ctx = { depth, collectionList: Boolean(feed.collectionList), feed: feed.id, subject: feed.subject, parent };
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

/**
 * 0.11.1 (owner's decision 4): boards for ONE faction, ONE instance's bosses or ONE transmog slot. They exist and show
 * on character pages, but the leaderboards INDEX lists one only from `boards.minIndexEntries` ranked characters (admin
 * setting). Rolled-up counts (Exalted reputations, Revered+, boss kills in total, appearances) are not these.
 */
const GRANULAR = [/^feed:reputations:/, /^instance:/, /^slot:/];
export const indexThresholdApplies = (derivedKey) => GRANULAR.some((re) => re.test(String(derivedKey ?? '')));

/** Does a derived statistic key come from a feed? → { feedId, path } or null. */
export function feedOfKey(key) {
  const k = String(key ?? '');
  if (!k.startsWith(FEED_PREFIX)) return null;
  const rest = k.slice(FEED_PREFIX.length);
  const i = rest.indexOf(':');
  return i > 0 ? { feedId: rest.slice(0, i), path: rest.slice(i + 1) } : null;
}
