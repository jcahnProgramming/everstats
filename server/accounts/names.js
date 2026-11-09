import { readFileSync } from 'node:fs';

/**
 * Usernames and display names: the rules, in one place (CLAUDE.md "Usernames").
 *
 * USERNAME  identifies the account and builds its URL (/u/{username}). Unique, case-insensitive, stored lower case.
 *   3–20 characters; a–z, 0–9, '-' and '_'; starts with a letter; no '-'/'_' doubled ("a--b", "a-_b") or at the end.
 *   Not reserved (the admin-editable list, compared after lookalike normalization), containing none of the blocked
 *   stems, not profane, and not starting with "user-"/"user_" (the shape of a placeholder).
 * PLACEHOLDER  every new account gets "user-" + 6 random a–z0–9 (a database default, schema.js 010) until it claims
 *   a name. A placeholder is never shown publicly as a chosen name and has no profile.
 * DISPLAY NAME  free text, 1–32 characters, duplicates allowed. Same profanity filter. It may not normalize to a
 *   reserved name or contain a blocked stem, so nobody can display as "Blizzard Support" or "Everstats Staff".
 *
 * Rejections say why in plain words, and never name the list entry that matched.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_MAX = 32;
export const PLACEHOLDER = /^user-[a-z0-9]{6}$/;
const FORMAT = /^[a-z](?:[a-z0-9]|[-_](?=[a-z0-9]))*$/;

/** Stems refused ANYWHERE in a username (after normalization). Display names: the same minus "support". */
export const BLOCKED_STEMS = Object.freeze(['admin', 'staff', 'official', 'moderator', 'support', 'blizzard']);
const DISPLAY_STEMS = BLOCKED_STEMS.filter((s) => s !== 'support'); // "Support Main" is an ordinary healer's name

const profanity = JSON.parse(readFileSync(new URL('./profanity.json', import.meta.url), 'utf8'));

const SUBST = { 0: 'o', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
/**
 * Lookalike normalization: lower case, common substitutions (0→o, 3→e, 4→a, 5→s, 7→t, @→a, $→s), separators and
 * anything else that isn't a letter or digit removed. "1" can stand for "i" or "l", so every form is returned:
 *   normalForms('B1-izzard') → ['bizzard', 'blizzard'].
 */
export function normalForms(text) {
  let s = String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = [...s].map((c) => SUBST[c] ?? c).join('').replace(/[^a-z0-9]/g, '');
  const forms = new Set(['i', 'l'].map((r) => s.replace(/1/g, r)));
  return [...forms];
}

const isProfane = (forms, words = []) => forms.some((f) => profanity.contains.some((w) => f.includes(w)) || profanity.exact.includes(f))
  || words.some((w) => normalForms(w).some((f) => profanity.exact.includes(f)));

/** True when free text (a bio) has a refused word: each word on its own, and the text with separators removed. */
export const isProfaneText = (text) => {
  const words = String(text ?? '').split(/[\s\-_.,!?;:()"']+/u).filter(Boolean);
  return words.some((w) => isProfane(normalForms(w), [w]));
};

/**
 * Checks a username against every rule except "is it taken". `reserved` is a Set of NORMALIZED reserved names.
 *   → { ok: true, name } | { ok: false, reason, message }
 */
export function checkUsername(raw, reserved) {
  const name = String(raw ?? '').trim().toLowerCase();
  const no = (reason, message) => ({ ok: false, reason, message });
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return no('format', `Usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters.`);
  if (!/^[a-z0-9_-]+$/.test(name)) return no('format', 'Use only lower-case letters a–z, digits, hyphens and underscores.');
  if (!/^[a-z]/.test(name)) return no('format', 'Start with a letter.');
  if (!FORMAT.test(name)) return no('format', 'Hyphens and underscores can’t be doubled up or come last.');
  if (/^user[-_]/.test(name)) return no('placeholder', 'Names starting with “user-” are kept for accounts that haven’t chosen a username yet.');
  const forms = normalForms(name);
  if (forms.some((f) => reserved.has(f) || BLOCKED_STEMS.some((stem) => f.includes(stem)))) return no('reserved', 'That name is reserved.');
  if (isProfane(forms)) return no('not_allowed', 'That name isn’t allowed.');
  return { ok: true, name };
}

/** Checks a display name. → { ok: true, value } | { ok: false, reason, message } */
export function checkDisplayName(raw, reserved) {
  const value = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const no = (reason, message) => ({ ok: false, reason, message });
  if (!value.length) return no('format', 'A display name needs at least one character.');
  if ([...value].length > DISPLAY_MAX) return no('format', `Display names are up to ${DISPLAY_MAX} characters.`);
  // Control characters, zero-width and direction-changing characters: invisible tricks for impersonation.
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return no('format', 'That display name has invisible or control characters in it.');
  if (value.startsWith('@')) return no('format', 'Display names can’t start with “@”: that’s how usernames are shown.');
  const forms = normalForms(value);
  if (forms.some((f) => reserved.has(f) || DISPLAY_STEMS.some((stem) => f.includes(stem)))) {
    return no('reserved', 'That display name looks like it speaks for Everstats or another company, so it isn’t allowed.');
  }
  if (isProfane(forms, value.split(/[\s\-_.]+/))) return no('not_allowed', 'That display name isn’t allowed.');
  return { ok: true, value };
}

/**
 * The reserved list as a Set of normalized forms (from reserved_names). Display names are checked against everything
 * but the 'path' kind (a URL word like "home" or "me" is a fine thing to be called).
 */
export async function reservedSet(db, { forDisplay = false } = {}) {
  const rows = await db.query(`SELECT name FROM reserved_names ${forDisplay ? "WHERE kind <> 'path'" : ''} ORDER BY name LIMIT 5000`);
  return new Set(rows.flatMap((r) => normalForms(r.name)));
}

/**
 * The starter reserved list (seeded by schema.js 010; the admin edits it afterwards). Grouped as the owner listed,
 * plus additions marked "added".
 */
export const RESERVED_SEED = Object.freeze({
  everstats: ['everstats', 'admin', 'administrator', 'staff', 'support', 'help', 'mod', 'moderator', 'team', 'dev', 'developer',
    'official', 'system', 'root', 'owner', 'meownet', 'meownetstudios',
    // added
    'everstat', 'everstatsapp', 'moderation', 'mods', 'gm', 'gamemaster', 'operator', 'sysop', 'security', 'abuse', 'postmaster',
    'webmaster', 'hostmaster', 'noreply', 'contact', 'info', 'legal', 'press', 'billing', 'patreon', 'patron'],
  paths: ['api', 'u', 'user', 'users', 'beta', 'login', 'signin', 'signup', 'settings', 'account', 'leaderboards', 'guilds', 'changelog',
    'privacy', 'terms', 'about',
    // added: every other route or word a URL could be confused with
    'auth', 'oauth', 'callback', 'logout', 'signout', 'register', 'accounts', 'leaderboard', 'guild', 'g', 'c', 'character', 'characters',
    'profile', 'profiles', 'dashboard', 'home', 'search', 'status', 'health', 'assets', 'static', 'licenses', 'discovery', 'stats',
    'statistics', 'badges', 'badge', 'tiers', 'null', 'undefined', 'anonymous', 'deleted', 'unknown', 'everyone', 'here', 'me', 'you'],
  companies: ['blizzard', 'activision', 'activisionblizzard', 'microsoft', 'xbox', 'battlenet', 'bnet', 'wow', 'warcraft', 'worldofwarcraft',
    'forever', 'riot', 'valve', 'steam', 'epic', 'discord', 'twitch', 'youtube', 'reddit', 'twitter', 'x', 'google', 'apple', 'anthropic',
    'claude', 'curseforge', 'overwolf', 'wowup',
    // added: Blizzard's other games and names, and a few more platforms
    'blizz', 'blizzardentertainment', 'wowclassic', 'classic', 'hearthstone', 'overwatch', 'diablo', 'starcraft', 'heroesofthestorm',
    'facebook', 'meta', 'instagram', 'tiktok', 'bluesky', 'kick', 'patreon', 'paypal', 'nvidia', 'amd', 'openai'],
  community: ['raiderio', 'raider-io', 'warcraftlogs', 'wowhead', 'icyveins', 'wowprogress', 'method', 'liquid', 'echo',
    // added
    'mmochampion', 'mmo-champion', 'wowpedia', 'warcraftwiki', 'wowwiki', 'thottbot', 'allakhazam', 'weakauras', 'wago', 'details',
    'dbm', 'bigwigs', 'tradeskillmaster', 'tsm', 'murlocvillage', 'checkpwnt', 'subcreation', 'archon'],
});
