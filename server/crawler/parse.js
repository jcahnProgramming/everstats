import { statisticsIn } from '../discovery/analyze.js';

/**
 * Blizzard responses → the PARSED values the production tables keep. No raw body is stored anywhere in production.
 * Shapes are the ones discovery runs 1 and 2 stored (discovery_responses, profile-forever-us, 2026-11-09):
 *
 *   profile             { id, name, surname, level, gender{name}, faction{type,name}, race{name}, character_class{name},
 *                         guild{ id, name, slug, faction }, ruleset{ id, name }, last_login_timestamp, _links.self.href }
 *                       (no `slug` field: the slug is the last segment of its own self link)
 *   achievements/statistics  categories[].statistics[] + categories[].sub_categories[].statistics[]:
 *                       { id, name, quantity, description?, last_updated_timestamp }. A statistic a character doesn't
 *                       have is simply absent (zero).
 *   statistics          character attributes: health, power, power_type, { base, effective } stats, { value } ratings
 *   equipment           equipped_items[]: { slot{type,name}, name, quality{type}, level{value}, item{id} }
 *   character-media     assets[]: { key: 'main-raw' | 'main-sd-raw' | 'avatar' | 'avatar-sd', value: url }
 *   /profile/user/wow   wow_accounts[].characters[]: { id, name, surname, level, character{href}, playable_class,
 *                       playable_race, faction } (no ruleset, no slug field: the slug is in character.href)
 *   guild roster        members[]: { character: { id, name, surname, slug, level, … }, rank }
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nameOf = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.name === 'string' ? v.name : null);
const int = (v) => (Number.isFinite(v) ? Math.trunc(v) : null);
const ms = (v) => (Number.isFinite(v) && v > 0 ? new Date(v).toISOString() : null);
const str = (v, max = 100) => (typeof v === 'string' ? v.slice(0, max) : null);

/** The character slug a profile href names ("…/profile/wow/character/h%C3%A9ros-shade?…" → "héros-shade"). */
export function slugFromHref(href) {
  if (typeof href !== 'string') return null;
  try {
    const m = /\/profile\/wow\/character\/([^/?#]+)/.exec(new URL(href, 'https://x.invalid').pathname);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

export function parseProfile(json) {
  if (!isObj(json) || !Number.isFinite(json.id) || typeof json.name !== 'string') return null;
  const g = isObj(json.guild) && Number.isFinite(json.guild.id) ? json.guild : null;
  return {
    id: json.id,
    slug: slugFromHref(json._links?.self?.href),
    name: json.name.slice(0, 60),
    surname: str(json.surname, 60) ?? '',
    level: int(json.level),
    gender: nameOf(json.gender),
    faction: nameOf(json.faction),
    race: nameOf(json.race) ?? nameOf(json.playable_race),
    class: nameOf(json.character_class) ?? nameOf(json.playable_class),
    ruleset: isObj(json.ruleset) && Number.isInteger(json.ruleset.id) ? { id: json.ruleset.id, name: nameOf(json.ruleset) ?? `Ruleset ${json.ruleset.id}` } : null,
    guild: g ? { id: g.id, name: str(g.name) ?? '', slug: str(g.slug) ?? null, faction: nameOf(g.faction) } : null,
    lastLoginAt: ms(json.last_login_timestamp),
  };
}

/** [{ id, name, value, text, updatedAt, categoryPath }], one per statistic id (the first if Blizzard repeats one). */
export function parseStatistics(json) {
  const seen = new Set();
  const out = [];
  for (const s of statisticsIn(json)) {
    if (!Number.isSafeInteger(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: s.name.slice(0, 200),
      value: Number.isFinite(s.quantity) ? s.quantity : 0,
      text: typeof s.text === 'string' ? s.text.slice(0, 120) : null,
      updatedAt: ms(s.lastUpdated),
      categoryPath: s.categoryPath.map((c) => ({ id: c.id, name: String(c.name).slice(0, 100) })),
    });
  }
  return out;
}

const pretty = (key) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Core attributes, in the order Blizzard lists them, as { key, label, value, percent }. Whatever the API returns:
 * numbers, { effective } stats and { value } ratings, zeros included (0.4.2).
 */
export function parseAttributes(json) {
  if (!isObj(json)) return [];
  const out = [];
  for (const [key, v] of Object.entries(json)) {
    if (key === '_links' || key === 'character' || key === 'power_type') continue;
    let value = null;
    let percent = false;
    if (Number.isFinite(v)) value = v;
    else if (isObj(v) && Number.isFinite(v.effective)) value = v.effective;
    else if (isObj(v) && Number.isFinite(v.value)) {
      value = v.value;
      percent = 'rating_bonus' in v;
    }
    // 0.4.2: zeros are kept (a resistance of 0 is real); the character page decides what to show.
    if (value === null) continue;
    const label = key === 'power' && nameOf(json.power_type) ? nameOf(json.power_type) : pretty(key);
    out.push({ key: key.slice(0, 60), label: label.slice(0, 60), value: Math.round(value * 100) / 100, percent });
    if (out.length >= 120) break;
  }
  return out;
}

const QUALITIES = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom']);

/**
 * What the stored equipment carries. 2 (0.4.1): the tooltip fields below. A character stored with an older version is
 * fetched in full once more even if it hasn't logged in (crawler/fetch.js), so every tooltip fills in.
 */
export const EQUIPMENT_VERSION = 2;

const isGreen = (c) => isObj(c) && c.r === 0 && c.g === 255 && c.b === 0;
const texts = (list, pick, max = 12) => (Array.isArray(list) ? list : []).map(pick).filter((x) => typeof x === 'string' && x.trim()).slice(0, max).map((x) => x.slice(0, 300));

/**
 * The tooltip lines Blizzard sent for one equipped item, as its own display strings, in the game's order. Only fields
 * the response has are kept; nothing is filled in. Seen in Forever's stored responses (runs 1–2, 29 items): binding,
 * unique_equipped, inventory_type, item_subclass (+ is_subclass_hidden), weapon damage / speed / dps, armor, stats
 * (white base stats; green is_equip_bonus stats and resistances), enchantments, spells ("Equip:" / "Use:"), set
 * (name with pieces worn, pieces, bonuses with is_active), durability, requirements (level, classes), sell_price.
 * Not seen in any Forever response: sockets/gems, skill or reputation requirements. Sockets are parsed if they ever
 * appear (by their own display_string), the rest not at all.
 */
function tooltipOf(i) {
  const t = {};
  if (typeof i.binding?.name === 'string') t.binding = i.binding.name.slice(0, 60);
  if (typeof i.unique_equipped === 'string') t.unique = i.unique_equipped.slice(0, 60);
  if (typeof i.inventory_type?.name === 'string') t.inventoryType = i.inventory_type.name.slice(0, 40);
  if (typeof i.item_subclass?.name === 'string' && i.is_subclass_hidden !== true) t.subclass = i.item_subclass.name.slice(0, 40);
  if (isObj(i.weapon)) {
    t.weapon = {
      damage: str(i.weapon.damage?.display_string, 60),
      speed: str(i.weapon.attack_speed?.display_string, 60),
      dps: str(i.weapon.dps?.display_string, 60),
    };
  }
  if (typeof i.armor?.display?.display_string === 'string') t.armor = i.armor.display.display_string.slice(0, 60);
  const stats = (Array.isArray(i.stats) ? i.stats : []).filter((s) => typeof s?.display?.display_string === 'string').slice(0, 20);
  if (stats.length) t.stats = stats.map((s) => ({ text: s.display.display_string.slice(0, 120), green: s.is_equip_bonus === true || isGreen(s.display.color) }));
  const ench = texts(i.enchantments, (e) => e?.display_string);
  if (ench.length) t.enchantments = ench;
  const sockets = texts(i.sockets, (s) => s?.display_string ?? s?.item?.name ?? s?.socket_type?.name);
  if (sockets.length) t.sockets = sockets;
  if (typeof i.durability?.display_string === 'string') t.durability = i.durability.display_string.slice(0, 60);
  const req = {};
  if (typeof i.requirements?.level?.display_string === 'string') req.level = i.requirements.level.display_string.slice(0, 60);
  if (typeof i.requirements?.playable_classes?.display_string === 'string') req.classes = i.requirements.playable_classes.display_string.slice(0, 120);
  if (Object.keys(req).length) t.requirements = req;
  const spells = texts(i.spells, (s) => s?.description);
  if (spells.length) t.spells = spells;
  if (isObj(i.set) && typeof i.set.display_string === 'string') {
    t.set = {
      name: i.set.display_string.slice(0, 120),
      items: (Array.isArray(i.set.items) ? i.set.items : []).slice(0, 12).filter((x) => typeof x?.item?.name === 'string').map((x) => ({ name: x.item.name.slice(0, 120), equipped: x.is_equipped === true })),
      effects: (Array.isArray(i.set.effects) ? i.set.effects : []).slice(0, 12).filter((x) => typeof x?.display_string === 'string').map((x) => ({ text: x.display_string.slice(0, 300), active: x.is_active === true })),
    };
  }
  const sp = i.sell_price?.display_strings;
  if (isObj(sp) && Number.isFinite(i.sell_price?.value) && i.sell_price.value > 0) t.sellPrice = { gold: Number(sp.gold) || 0, silver: Number(sp.silver) || 0, copper: Number(sp.copper) || 0 };
  return t;
}

/**
 * The transmog Blizzard reports on an equipped item (0.8.0; Forever sends it, Discovery run 3): the item whose
 * appearance is shown instead, as { itemId, name }, or null when the slot isn't transmogged. Read from transmog.item
 * (id and name) only; nothing else in it is kept. A malformed one is treated as none, never guessed.
 */
function transmogOf(i) {
  const t = i.transmog;
  if (!isObj(t) || !isObj(t.item)) return null;
  const itemId = int(t.item.id);
  const name = str(t.item.name, 120);
  if (!Number.isSafeInteger(itemId) || !name) return null;
  return { itemId, name };
}

export function parseEquipment(json) {
  const items = Array.isArray(json?.equipped_items) ? json.equipped_items : [];
  return items.slice(0, 30).filter(isObj).map((i) => {
    const q = String(i.quality?.type ?? '').toLowerCase();
    const mediaHref = typeof i.media?.key?.href === 'string' ? i.media.key.href.slice(0, 300) : null;
    return {
      slot: str(i.slot?.type, 30) ?? 'UNKNOWN',
      slotName: str(i.slot?.name, 40) ?? '',
      name: str(i.name, 120) ?? '',
      quality: QUALITIES.has(q) ? q : 'common',
      qualityName: str(i.quality?.name, 30),
      level: int(i.level?.value),
      itemId: int(i.item?.id),
      // Blizzard's own link to the item's media (static namespace). Only followed on the API host (sources/blizzard.js).
      mediaHref,
      tooltip: tooltipOf(i),
      // 0.8.0. Always written by this parser (null = not transmogged); an item stored before 0.8.0 has no key at
      // all, which the page reads as "not known yet" until the character's next full fetch. No version bump: that
      // would force an extra full fetch of every character.
      transmog: transmogOf(i),
    };
  });
}

/** Render URLs, only from Blizzard's render host over https (the CSP allows exactly that host for images). */
export const RENDER_ORIGIN = 'https://render.worldofwarcraft.com';
export function parseMedia(json) {
  const out = {};
  for (const a of Array.isArray(json?.assets) ? json.assets : []) {
    if (!isObj(a) || typeof a.key !== 'string' || typeof a.value !== 'string') continue;
    try {
      const u = new URL(a.value);
      if (u.origin === RENDER_ORIGIN) out[a.key.slice(0, 30)] = u.toString();
    } catch {
      /* not a URL */
    }
  }
  return out;
}

/** /profile/user/wow → every character on every WoW account of that Battle.net login. */
export function parseAccountCharacters(json) {
  const out = [];
  for (const acct of Array.isArray(json?.wow_accounts) ? json.wow_accounts : []) {
    for (const c of Array.isArray(acct?.characters) ? acct.characters : []) {
      if (!isObj(c) || !Number.isFinite(c.id)) continue;
      const slug = slugFromHref(c.character?.href);
      if (!slug || typeof c.name !== 'string') continue;
      out.push({
        id: c.id, slug, name: c.name.slice(0, 60), surname: str(c.surname, 60) ?? '', level: int(c.level),
        class: nameOf(c.playable_class), race: nameOf(c.playable_race), faction: nameOf(c.faction), gender: nameOf(c.gender),
        // 0.9.0: Blizzard's own protected-character link (realm id + character id), read once at sign-in for opt-in gold
        // (collections/gold.js) and never stored.
        protectedHref: typeof c.protected_character?.href === 'string' ? c.protected_character.href.slice(0, 300) : null,
      });
    }
  }
  return out.slice(0, 200);
}

/** A guild roster → its members, as Blizzard names them. */
export function parseRoster(json) {
  const out = [];
  for (const m of Array.isArray(json?.members) ? json.members : []) {
    const c = m?.character;
    if (!isObj(c) || !Number.isFinite(c.id) || typeof c.name !== 'string') continue;
    const slug = str(c.slug, 120)?.toLowerCase() ?? slugFromHref(c.key?.href);
    if (!slug) continue;
    // rank: Blizzard's rank NUMBER (0 = guild master). Forever's roster sends no rank names (runs 1–2), so none is kept.
    out.push({
      id: c.id, slug, name: c.name.slice(0, 60), surname: str(c.surname, 60) ?? '', level: int(c.level), faction: nameOf(c.faction),
      rank: Number.isInteger(m.rank) && m.rank >= 0 && m.rank < 100 ? m.rank : null,
    });
  }
  return out.slice(0, 1000);
}

/**
 * /data/wow/guild/{slug} (profile namespace) → what a guild page shows. Fields as runs 1–2 stored them: id, name,
 * slug, faction, ruleset { id, name }, member_count, created_timestamp. achievement_points (0 in every sample) and
 * name_search (the name again) aren't kept.
 */
export function parseGuildProfile(json) {
  if (!isObj(json) || !Number.isFinite(json.id) || typeof json.name !== 'string' || typeof json.slug !== 'string') return null;
  return {
    id: json.id,
    slug: json.slug.slice(0, 120).toLowerCase(),
    name: json.name.slice(0, 100),
    faction: nameOf(json.faction),
    ruleset: isObj(json.ruleset) && Number.isInteger(json.ruleset.id) ? { id: json.ruleset.id, name: nameOf(json.ruleset) ?? `Ruleset ${json.ruleset.id}` } : null,
    memberCount: Number.isInteger(json.member_count) && json.member_count >= 0 ? json.member_count : null,
    createdAt: ms(json.created_timestamp),
  };
}

/**
 * /data/wow/media/item/{id} (static namespace) → the icon URL, or null. Shape as Blizzard documents it for the item
 * media endpoint: { assets: [{ key: 'icon', value: url, file_data_id }] }. No Forever item-media response had been
 * stored before 0.4.1 (discovery never asked for one), so this is read defensively: only an https URL on Blizzard's
 * render host is kept (the CSP's only image host besides our own); anything else is "missing".
 */
export function parseItemMedia(json) {
  for (const a of Array.isArray(json?.assets) ? json.assets : []) {
    if (!isObj(a) || a.key !== 'icon' || typeof a.value !== 'string') continue;
    try {
      const u = new URL(a.value);
      if (u.origin === RENDER_ORIGIN && u.protocol === 'https:') return u.toString().slice(0, 300);
    } catch {
      /* not a URL */
    }
  }
  return null;
}
