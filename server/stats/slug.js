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
