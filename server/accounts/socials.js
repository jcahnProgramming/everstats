import { readFileSync } from 'node:fs';
import { isProfaneText } from './names.js';

/**
 * Social links and the bio on public profiles (0.4.2). The platform list lives in socials.json.
 *
 * HANDLE ONLY, never a URL: the player types a handle, it is checked against that platform's handle format, and the
 * link is built here from the platform's own URL. A pasted link ("https://…", anything with a slash) is refused with a
 * plain reason. Nothing here marks a handle verified: since 0.8.1 only staff can, for a Verified Content Creator, by hand
 * (badges/creators.js).
 */
const data = JSON.parse(readFileSync(new URL('./socials.json', import.meta.url), 'utf8'));
export const PLATFORMS = data.platforms.map((p) => ({ ...p, re: new RegExp(p.pattern) }));
const byId = new Map(PLATFORMS.map((p) => [p.id, p]));
export const getPlatform = (id) => byId.get(id) ?? null;

/** → { ok: true, handle } | { ok: false, message } */
export function checkHandle(platformId, raw) {
  const p = byId.get(platformId);
  if (!p) return { ok: false, message: 'That isn’t one of the platforms Everstats links to.' };
  let h = String(raw ?? '').trim();
  if (p.stripAt) h = h.replace(/^@/, '');
  if (!h) return { ok: false, message: 'Type your handle.' };
  if (/[/\\:?#]/.test(h)) return { ok: false, message: `Type just your ${p.label} handle, not a link.` };
  if (p.lower) h = h.toLowerCase();
  if (!p.re.test(h)) return { ok: false, message: p.help };
  return { ok: true, handle: h };
}

/** The link a handle stands for, built from the platform's own URL. */
export const linkFor = (platformId, handle) => {
  const p = byId.get(platformId);
  return p ? p.url.replace('{handle}', encodeURIComponent(handle)) : null;
};

export const BIO_MAX = 280;
/**
 * A bio: plain text, up to 280 characters, line breaks kept (at most 4 in a row of empty lines collapse), no links made
 * clickable (the page renders text only), and the same profanity list as names, word by word.
 */
export function checkBio(raw) {
  const value = String(raw ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!value) return { ok: true, value: null };
  if ([...value].length > BIO_MAX) return { ok: false, message: `A bio is up to ${BIO_MAX} characters.` };
  if (/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g, ''))) return { ok: false, message: 'Your bio has invisible or control characters in it.' };
  if (isProfaneText(value)) return { ok: false, message: 'Your bio has a word in it that isn’t allowed.' };
  return { ok: true, value };
}
