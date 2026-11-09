import { createHash } from 'node:crypto';
import { cleanOptions, defaultOptions } from './catalog.js';
import { LAYOUT_VERSION } from './render.js';

/**
 * Share cards in the database (0.8.0).
 *
 *   share_card_defaults  (ours) the card a character's owner, or a guild's Guild Master or officer, saved with "Save as
 *                        my default": it becomes the card everyone sees first and the link preview. One per (kind,
 *                        subject). Nobody else's choices are ever stored: a visitor's maker choices live in their
 *                        address bar only.
 *   share_card_images    (Blizzard data: the image shows Blizzard values) the rendered PNGs, keyed by a hash of the
 *                        template + the exact CARD_DATA + images. Same data and settings → same key → served from
 *                        here; anything changes (a new fetch, a rank moving, a new "as of" date) → a new key → a new
 *                        render. Rows live at most CACHE_HOURS and never past the Blizzard data window (data_at = the
 *                        oldest Blizzard fetch behind the image; retention/registry.js sweeps it). The table is
 *                        Blizzard-classified, so backups never contain its rows. A hidden character's (or hidden
 *                        render's) images are deleted at once (forgetCharacter). The total is capped (pruneCache).
 */
export const CACHE_HOURS = 6;
export const CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_KINDS = Object.freeze(['character', 'tier', 'guild']);

export async function savedDefault(db, kind, subjectId) {
  if (!DEFAULT_KINDS.includes(kind) || subjectId === null || subjectId === undefined) return null;
  // 0.8.2: a default saved by a banned account isn't used while the ban lasts (the generic card instead). It isn't deleted:
  // lifting the ban brings it back.
  const row = await db.one('SELECT options, saved_at FROM share_card_defaults WHERE kind = $1 AND subject_id = $2 AND NOT everstats_banned(saved_by)', [kind, subjectId]);
  return row ? { options: cleanOptions(kind, row.options), savedAt: row.saved_at } : null;
}

/** The options a link preview uses: the saved default in the wide format, else the README's defaults. */
export async function previewOptions(db, kind, subjectId) {
  const saved = DEFAULT_KINDS.includes(kind) ? await savedDefault(db, kind, subjectId) : null;
  return cleanOptions(kind, { ...(saved?.options ?? defaultOptions(kind)), format: 'wide' });
}

export async function saveDefault(q, { kind, subjectId, options, accountId }) {
  const clean = cleanOptions(kind, options);
  await q.query(
    `INSERT INTO share_card_defaults (kind, subject_id, options, saved_by, saved_at) VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (kind, subject_id) DO UPDATE SET options = EXCLUDED.options, saved_by = EXCLUDED.saved_by, saved_at = now()`,
    [kind, subjectId, JSON.stringify(clean), accountId],
  );
  return clean;
}

/** The cache key: everything that decides the pixels. */
export function cacheKey({ type, template, data }) {
  return createHash('sha256').update(JSON.stringify([2, LAYOUT_VERSION, type, template, data])).digest('base64url');
}

export async function cachedImage(db, key) {
  const row = await db.one(
    `UPDATE share_card_images SET last_used_at = now() WHERE key = $1 AND created_at > now() - ($2 || ' hours')::interval RETURNING png, render_ms`,
    [key, String(CACHE_HOURS)],
  );
  return row ? { png: row.png, ms: row.render_ms } : null;
}

let inserts = 0;
export async function storeImage(db, { key, subject, characterIds, guildIds, png, ms, dataAt }) {
  await db.query(
    `INSERT INTO share_card_images (key, subject, character_ids, guild_ids, png, bytes, render_ms, data_at) VALUES ($1, $2, $3::bigint[], $4::bigint[], $5, $6, $7, $8)
     ON CONFLICT (key) DO UPDATE SET last_used_at = now()`,
    [key, subject, characterIds, guildIds, png, png.length, ms, dataAt],
  );
  inserts += 1;
  if (inserts % 25 === 0) await pruneCache(db);
}

/** Keeps the cache under CACHE_MAX_BYTES: least recently used first. Also drops anything past CACHE_HOURS. */
export async function pruneCache(db, maxBytes = CACHE_MAX_BYTES) {
  await db.query(`DELETE FROM share_card_images WHERE created_at < now() - ($1 || ' hours')::interval`, [String(CACHE_HOURS)]);
  const total = (await db.one('SELECT coalesce(sum(bytes), 0)::bigint AS n FROM share_card_images')).n;
  if (Number(total) <= maxBytes) return 0;
  const rows = await db.query(
    `DELETE FROM share_card_images WHERE key IN (
       SELECT key FROM (SELECT key, sum(bytes) OVER (ORDER BY last_used_at DESC, key) AS running FROM share_card_images) x WHERE running > $1 LIMIT 10000)
     RETURNING 1`,
    [maxBytes],
  );
  return rows.length;
}

/** A character was hidden, or its render hidden: every cached image showing it goes now. */
export async function forgetCharacter(q, characterId) {
  await q.query('DELETE FROM share_card_images WHERE $1::bigint = ANY(character_ids)', [characterId]);
}
