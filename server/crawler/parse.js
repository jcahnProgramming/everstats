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
 * numbers, { effective } stats and { value } ratings. Zeros are left out (a level 15 rogue has no spell haste).
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
    if (value === null || (value === 0 && key !== 'health')) continue;
    const label = key === 'power' && nameOf(json.power_type) ? nameOf(json.power_type) : pretty(key);
    out.push({ key: key.slice(0, 60), label: label.slice(0, 60), value: Math.round(value * 100) / 100, percent });
    if (out.length >= 80) break;
  }
  return out;
}

const QUALITIES = new Set(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'artifact', 'heirloom']);

export function parseEquipment(json) {
  const items = Array.isArray(json?.equipped_items) ? json.equipped_items : [];
  return items.slice(0, 30).filter(isObj).map((i) => {
    const q = String(i.quality?.type ?? '').toLowerCase();
    return {
      slot: str(i.slot?.type, 30) ?? 'UNKNOWN',
      slotName: str(i.slot?.name, 40) ?? '',
      name: str(i.name, 120) ?? '',
      quality: QUALITIES.has(q) ? q : 'common',
      level: int(i.level?.value),
      itemId: int(i.item?.id),
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
    out.push({ id: c.id, slug, name: c.name.slice(0, 60), surname: str(c.surname, 60) ?? '', level: int(c.level), faction: nameOf(c.faction) });
  }
  return out.slice(0, 1000);
}
