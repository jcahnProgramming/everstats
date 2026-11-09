import { characterSlug } from '../../server/stats/slug.js';

/**
 * The one-box character search in the top bar: "Name Surname" (or "name-surname", the shape of a character's
 * address). Splits at the first space or hyphen and hands both parts to the shared slug rules, so the top bar and the
 * home page's two-field form accept exactly the same characters.
 *
 * → { ok: true, slug } or { ok: false, problem }
 */
export function parseCharacterSearch(text) {
  const value = String(text ?? '').trim();
  if (!value) return { ok: false, problem: 'Type a character’s name and surname.' };
  const m = /^(\S+?)(?:\s+|-)(.+)$/u.exec(value);
  if (!m) return { ok: false, problem: 'Add the surname too: Forever characters have a name and a surname.' };
  return characterSlug(m[1], m[2].trim());
}
