/**
 * Character slugs (shared with the client: client/src/stats/slug.js imports this file).
 *
 * WoW Forever characters are realmless; a character is `{name}-{surname}`, lower case (community probing, Nov 2026,
 * to be confirmed by the discovery pass). Lower-casing uses the locale-independent Unicode rules, because names can
 * carry accented letters. A hyphen is the separator, so neither part may contain one; whether real surnames can is a
 * discovery-pass question (CLAUDE.md, "Open questions").
 */
const PART = /^[\p{L}\p{M}']{1,24}$/u;

export function normalizePart(value) {
  return String(value ?? '').normalize('NFC').trim();
}

/** { ok: true, slug } or { ok: false, problem }. */
export function characterSlug(name, surname) {
  const n = normalizePart(name);
  const s = normalizePart(surname);
  if (!n) return { ok: false, problem: 'Enter the character’s name.' };
  if (!s) return { ok: false, problem: 'Enter the character’s surname.' };
  if (!PART.test(n)) return { ok: false, problem: 'A name is letters only.' };
  if (!PART.test(s)) return { ok: false, problem: 'A surname is letters only.' };
  return { ok: true, slug: `${n.toLowerCase()}-${s.toLowerCase()}` };
}

/** Splits a slug back into its two parts, or null when it isn't one. */
export function parseSlug(slug) {
  const value = normalizePart(decodeURIComponent(String(slug ?? '')));
  const i = value.indexOf('-');
  if (i < 1 || i !== value.lastIndexOf('-')) return null;
  const r = characterSlug(value.slice(0, i), value.slice(i + 1));
  return r.ok && r.slug === value.toLowerCase() ? { name: value.slice(0, i), surname: value.slice(i + 1), slug: r.slug } : null;
}

/**
 * Guild slugs (0.5.0). Blizzard addresses a Forever guild by its slug alone, region-wide, with no realm or ruleset in
 * the path (/data/wow/guild/post-nerf-clarity, discovery runs 1–2), and its profile answers with that slug. Lower case
 * letters (accents included), digits, apostrophes and hyphens. → the normalized slug, or null.
 */
const GUILD_SLUG = /^[\p{L}\p{M}\p{N}'][\p{L}\p{M}\p{N}'-]{0,119}$/u;
export function parseGuildSlug(slug) {
  let value;
  try {
    value = decodeURIComponent(String(slug ?? ''));
  } catch {
    return null;
  }
  value = value.normalize('NFC').trim().toLowerCase();
  return GUILD_SLUG.test(value) ? value : null;
}

/**
 * Realm versions (0.11.1: World of Warcraft). A character is addressed by its realm's slug and its name, lower case:
 * /profile/wow/character/{realmSlug}/{name} (probe #7), so the page is /{version}/{region}/c/{realm}/{name}. A name is
 * letters only, 2–12 of them; a realm slug is what Blizzard's realm index lists (letters, digits, hyphens, and on some
 * regions apostrophes and accented letters: never typed in here, only checked for shape).
 */
const REALM_SLUG = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}'-]{0,59}$/u;
const REALM_NAME = /^[\p{L}\p{M}]{2,12}$/u;

export function parseRealmSlug(value) {
  let v;
  try {
    v = decodeURIComponent(String(value ?? ''));
  } catch {
    return null;
  }
  v = v.normalize('NFC').trim().toLowerCase();
  return REALM_SLUG.test(v) ? v : null;
}

/** A realm's NAME as someone types it ("Area 52", "Mal'Ganis") → the slug Blizzard gives it ("area-52", "malganis"). */
export function realmSlugFromName(name) {
  const v = String(name ?? '').normalize('NFC').trim().toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return REALM_SLUG.test(v) ? v : null;
}

/** { ok: true, realmSlug, slug, name } or { ok: false, problem }. */
export function realmCharacter(realm, name) {
  const n = normalizePart(name);
  const r = parseRealmSlug(realm);
  if (!n) return { ok: false, problem: 'Enter the character’s name.' };
  if (!REALM_NAME.test(n)) return { ok: false, problem: 'A name is 2 to 12 letters.' };
  if (!r) return { ok: false, problem: 'Choose the character’s realm.' };
  return { ok: true, realmSlug: r, slug: n.toLowerCase(), name: n };
}

/**
 * A guild's address as URLs write it (0.11.1): "guild-slug" (WoW Forever), or "realm-slug/guild-slug" on a version
 * with realms. → the normalized address, or null.
 */
export function parseGuildAddress(value) {
  const text = String(value ?? '');
  const i = text.indexOf('/');
  if (i < 0) return parseGuildSlug(text);
  const realm = parseRealmSlug(text.slice(0, i));
  const slug = parseGuildSlug(text.slice(i + 1));
  return realm && slug ? `${realm}/${slug}` : null;
}
