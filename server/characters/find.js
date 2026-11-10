import { scopeSql } from '../core/config.js';
import { versionById } from '../core/gameVersions.js';
import { currentScope, pathSlug, splitKey } from '../core/scope.js';
import { parseGuildSlug, parseSlug, realmCharacter, parseRealmSlug } from '../stats/slug.js';

/**
 * Finding a character or a guild from the key in a URL, in the REQUEST's scope (0.11.1, core/scope.js).
 *
 *   realmless version (WoW Forever)   "name-surname"            a guild: "guild-slug"
 *   realm version (World of Warcraft) "realm~name" (the API; pages write realm/name)   a guild: "realm~guild-slug"
 *
 * characterKey / guildKey → { slug, realmSlug, crawlKey (the crawl queue's key), path (how URLs and API answers write
 * it) } or null when the text isn't one. findCharacter / findGuild read the row in the current scope.
 */
export function characterKey(raw, scope = currentScope()) {
  if (!versionById(scope.version)?.realms) {
    const p = parseSlug(raw);
    return p ? { slug: p.slug, realmSlug: null, crawlKey: p.slug, path: p.slug, name: p.name, surname: p.surname } : null;
  }
  let text;
  try {
    text = decodeURIComponent(String(raw ?? ''));
  } catch {
    return null;
  }
  const { realmSlug, slug } = splitKey(text, scope);
  const c = realmSlug ? realmCharacter(realmSlug, slug) : null;
  return c?.ok ? { slug: c.slug, realmSlug: c.realmSlug, crawlKey: `${c.realmSlug}/${c.slug}`, path: `${c.realmSlug}/${c.slug}`, name: c.name, surname: '' } : null;
}

export function guildKey(raw, scope = currentScope()) {
  if (!versionById(scope.version)?.realms) {
    const slug = parseGuildSlug(raw);
    return slug ? { slug, realmSlug: null, crawlKey: slug, path: slug } : null;
  }
  let text;
  try {
    text = decodeURIComponent(String(raw ?? ''));
  } catch {
    return null;
  }
  const parts = splitKey(text, scope);
  const realmSlug = parts.realmSlug ? parseRealmSlug(parts.realmSlug) : null;
  const slug = parseGuildSlug(parts.slug);
  return realmSlug && slug ? { slug, realmSlug, crawlKey: `${realmSlug}/${slug}`, path: `${realmSlug}/${slug}` } : null;
}

const realmMatch = (alias = '') => `coalesce(${alias ? `${alias}.` : ''}realm_slug, '') = coalesce($2, '')`;

/** The character row (every column, or `cols`) for a key in the current scope, or null. */
export function findCharacter(db, key, { cols = '*', extra = '' } = {}) {
  return db.one(`SELECT ${cols} FROM characters WHERE slug = $1 AND ${realmMatch()} AND ${scopeSql()} ${extra}`, [key.slug, key.realmSlug]);
}

/** The guild row for a key in the current scope (the newest when a slug was reused), or null. */
export function findGuild(db, key, { cols = '*' } = {}) {
  return db.one(`SELECT ${cols} FROM guilds WHERE slug = $1 AND ${realmMatch()} AND ${scopeSql()} ORDER BY updated_at DESC LIMIT 1`, [key.slug, key.realmSlug]);
}

export { pathSlug };
