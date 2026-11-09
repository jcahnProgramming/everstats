import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { isProfaneText } from '../accounts/names.js';
import { checkHandle } from '../accounts/socials.js';

/**
 * What a Guild Master or officer can put on a guild page (0.7.0). The ONLY free URLs anywhere on Everstats are guild
 * links, and only under these rules. Everything is refused with a plain reason.
 *
 *   label        1–40 characters, plain text, the same profanity list as names
 *   url          https only; no user name or password in it; no port; a real domain name (never an IP address,
 *                never a single-label or local host); not a URL shortener (shorteners.json, plus subdomains); not on the
 *                admin's blocklist (link_blocklist, plus subdomains). The page shows the label AND the domain, opens it
 *                in a new tab with rel="noopener noreferrer nofollow", and only after a "You're leaving Everstats for
 *                {domain}" notice.
 *   description  up to 280 characters, plain text (never linkified), profanity-checked
 *   Discord      an invite CODE only, the same rule as the profile's Discord field; Everstats builds the link
 */
export const MAX_LINKS = 5;
export const LABEL_MAX = 40;
export const URL_MAX = 400;
export const DESCRIPTION_MAX = 280;

const SHORTENERS = JSON.parse(readFileSync(new URL('./shorteners.json', import.meta.url), 'utf8')).hosts;
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'test', 'invalid', 'example', 'onion'];

const matches = (host, list) => list.some((b) => host === b || host.endsWith(`.${b}`));

function plain(raw, { label, max, min = 1 }) {
  const v = String(raw ?? '').normalize('NFC').trim().replace(/[ \t]+/g, ' ');
  if ([...v].length < min) return { ok: false, message: `${label} can’t be empty.` };
  if ([...v].length > max) return { ok: false, message: `${label} is up to ${max} characters.` };
  if (/[\p{Cc}\p{Cf}]/u.test(v.replace(/\n/g, ''))) return { ok: false, message: `${label} has invisible or control characters in it.` };
  if (isProfaneText(v)) return { ok: false, message: `${label} has a word in it that isn’t allowed.` };
  return { ok: true, value: v };
}

/** → { ok: true, url, host } | { ok: false, message } */
export function checkUrl(raw, blocklist = []) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, message: 'Type the link’s address.' };
  if (s.length > URL_MAX) return { ok: false, message: `A link is up to ${URL_MAX} characters.` };
  let u;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, message: 'That isn’t a web address. Start it with https://' };
  }
  if (u.protocol !== 'https:') return { ok: false, message: 'Only https:// links are allowed.' };
  if (u.username || u.password) return { ok: false, message: 'A link can’t have a user name or password in it.' };
  if (u.port) return { ok: false, message: 'A link can’t name a port.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return { ok: false, message: 'Links must use a domain name, not an IP address.' };
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9-]{1,63}$/.test(l) || l.startsWith('-') || l.endsWith('-')) || /^\d+$/.test(labels[labels.length - 1])) {
    return { ok: false, message: 'That address doesn’t have a real domain name.' };
  }
  if (LOCAL_SUFFIXES.includes(labels[labels.length - 1])) return { ok: false, message: 'That address isn’t on the public internet.' };
  if (matches(host, SHORTENERS)) return { ok: false, message: 'Link shorteners aren’t allowed: link to the real page.' };
  if (matches(host, blocklist)) return { ok: false, message: 'Links to that site aren’t allowed on Everstats.' };
  return { ok: true, url: u.href, host };
}

export const checkLabel = (raw) => plain(raw, { label: 'A link’s label', max: LABEL_MAX });

export function checkDescription(raw) {
  const value = String(raw ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!value) return { ok: true, value: null };
  const r = plain(value, { label: 'The description', max: DESCRIPTION_MAX });
  return r.ok ? { ok: true, value: r.value } : r;
}

export function checkInvite(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: null };
  const h = checkHandle('discord', v);
  return h.ok ? { ok: true, value: h.handle } : { ok: false, message: h.message };
}

export const inviteUrl = (code) => (code ? `https://discord.gg/${encodeURIComponent(code)}` : null);
