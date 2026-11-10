import sharp from 'sharp';
import { HttpError } from '../core/errors.js';
import { sniff } from './marks.js';

/**
 * Badge logos (0.10.4): a partner's own branding on its badge, uploaded by the admin WITH the partner's permission.
 * Three kinds take one (catalog.js LOGO_TEMPLATES): each Pro Team badge, each Platform Employee badge (one per company)
 * and each Community Partner badge (one per partner). Guild partner emblems keep their own rules (marks.js).
 *
 *   - PNG or WebP ONLY, decided by the file's magic bytes AND by what the decoder finds (never a name or a header). SVG
 *     is refused (it can carry scripts and external references), JPEG and everything else too.
 *   - At most MAX_BYTES uploaded, at least MIN_SIDE pixels on the shorter side, MAX_SIDE a side (a decompression bomb
 *     stops at the decoder: limitInputPixels).
 *   - Decoded to pixels, transparent margins trimmed, and RE-ENCODED as fresh square PNGs at every SIZES entry (fitted,
 *     centred on transparency). Nothing from the original survives but its pixels: no EXIF, XMP, ICC, text chunks or
 *     animation frames (sharp writes none unless asked, and we never ask). The original bytes are never stored or served.
 */
export const MAX_BYTES = 512 * 1024;
export const MIN_SIDE = 128;
export const MAX_SIDE = 4096;
export const MAX_PIXELS = MAX_SIDE * MAX_SIDE;
/** Output sizes (px, square PNG): 64 = inline (18px) badges, 128 = pills (32–44px), 256 = large badges and share cards. */
export const SIZES = Object.freeze([64, 128, 256]);

const OPTS = { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false, sequentialRead: true };
const unreadable = () => new HttpError(400, 'That file couldn’t be read as an image.', 'unreadable');

/** Pixels → { 64: Buffer, 128: Buffer, 256: Buffer }. Used for uploads and for carrying 0.7.0 marks over (migration 031). */
export async function encodeSizes(buf) {
  let base = await sharp(buf, OPTS).ensureAlpha().png().toBuffer();
  try {
    // Trim fully transparent margins so the logo uses the whole box (a uniform image is left as it is by sharp).
    const trimmed = await sharp(base).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer();
    const m = await sharp(trimmed).metadata();
    if (m.width >= 8 && m.height >= 8) base = trimmed;
  } catch { /* keep the untrimmed pixels */ }
  const out = {};
  for (const px of SIZES) {
    out[px] = await sharp(base)
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  }
  return out;
}

/** An upload → { 64, 128, 256 } re-encoded PNGs. Throws HttpError 400/413/415 with a plain reason for anything refused. */
export async function processLogo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'Choose a PNG or WebP file.', 'invalid');
  if (buf.length > MAX_BYTES) throw new HttpError(413, `That file is over ${MAX_BYTES / 1024} KB.`, 'too_large');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'Only PNG or WebP files are accepted (no SVG, JPEG or anything else).', 'wrong_type');
  let meta;
  try {
    meta = await sharp(buf, OPTS).metadata();
  } catch {
    throw unreadable();
  }
  if (meta.format !== kind) throw new HttpError(415, 'That file isn’t the PNG or WebP it claims to be.', 'wrong_type');
  if (!meta.width || !meta.height) throw unreadable();
  if (meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new HttpError(400, `At most ${MAX_SIDE}×${MAX_SIDE} pixels.`, 'too_big');
  if (Math.min(meta.width, meta.height) < MIN_SIDE) throw new HttpError(400, `At least ${MIN_SIDE}×${MIN_SIDE} pixels, so it stays sharp at large size.`, 'too_small');
  try {
    return await encodeSizes(buf);
  } catch {
    throw unreadable();
  }
}

/**
 * The permission note: who granted it, when, and how. All three required (a 400 otherwise), plain text, no control
 * characters. `at` is a calendar date (YYYY-MM-DD), not in the future.
 */
const NOTE_MAX = { by: 120, how: 200 };
export function permissionNote(src, now = Date.now()) {
  const clean = (v) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  const by = clean(src?.grantedBy);
  const at = clean(src?.grantedAt);
  const how = clean(src?.how);
  if (!by || !at || !how) {
    throw new HttpError(400, 'Record the partner’s permission first: who granted it, when, and how (all three).', 'permission_required');
  }
  if (by.length > NOTE_MAX.by) throw new HttpError(400, `Who granted it: up to ${NOTE_MAX.by} characters.`, 'invalid');
  if (how.length > NOTE_MAX.how) throw new HttpError(400, `How it was granted: up to ${NOTE_MAX.how} characters.`, 'invalid');
  if ([by, how].some((v) => /[\p{Cc}\p{Cf}]/u.test(v))) throw new HttpError(400, 'The permission note has invisible or control characters in it.', 'invalid');
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  const ms = d ? Date.parse(`${at}T00:00:00Z`) : NaN;
  if (!d || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== at || Number(d[1]) < 2000) {
    throw new HttpError(400, 'When it was granted: a date (YYYY-MM-DD).', 'invalid');
  }
  if (ms > now + 14 * 3600 * 1000) throw new HttpError(400, 'When it was granted can’t be in the future.', 'invalid');
  return { by, at, how };
}

export const BACKINGS = Object.freeze(['none', 'plate']);
export const backingOf = (v) => (BACKINGS.includes(v) ? v : 'none');
