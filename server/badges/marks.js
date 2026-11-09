import sharp from 'sharp';
import { HttpError } from '../core/errors.js';

/**
 * Partner marks (0.7.0): the only image anyone can upload to Everstats, and only the admin can. A mark goes into the
 * Pro Team Partner template's slot (design/v2-badges/badges/templates/partner-pro.svg).
 *
 *   - PNG or WebP ONLY. SVG is refused (it can carry scripts and external references), and so is everything else. The
 *     type is decided from the file's own magic bytes AND from what the decoder finds, never from a name or a header.
 *   - At most MAX_BYTES uploaded, MAX_SIDE pixels a side, MAX_PIXELS decoded (a decompression bomb stops at the
 *     decoder), at least MIN_SIDE pixels on its shorter side.
 *   - Decoded to pixels and RE-ENCODED server-side as a fresh OUT_SIDE×OUT_SIDE PNG (fitted, centred on a transparent
 *     square): nothing from the original file survives but its pixels. No metadata is copied (EXIF, XMP, ICC text,
 *     comments, animation frames: sharp writes none unless asked, and we never ask).
 */
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_SIDE = 4096;
export const MAX_PIXELS = MAX_SIDE * MAX_SIDE;
export const MIN_SIDE = 256;
export const OUT_SIDE = 256;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 'png' | 'webp' | null, from the bytes alone. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** → Buffer (the re-encoded PNG). Throws HttpError 400 with a plain reason for anything it refuses. */
export async function processMark(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, 'Choose a PNG or WebP file.', 'invalid');
  if (buf.length > MAX_BYTES) throw new HttpError(413, `That file is over ${MAX_BYTES / 1024 / 1024} MB.`, 'too_large');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'Only PNG or WebP files are accepted (no SVG, JPEG or anything else).', 'wrong_type');
  const opts = { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false, sequentialRead: true };
  let meta;
  try {
    meta = await sharp(buf, opts).metadata();
  } catch {
    throw new HttpError(400, 'That file couldn’t be read as an image.', 'unreadable');
  }
  if (meta.format !== kind) throw new HttpError(415, 'That file isn’t the PNG or WebP it claims to be.', 'wrong_type');
  if (!meta.width || !meta.height) throw new HttpError(400, 'That file couldn’t be read as an image.', 'unreadable');
  if (meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new HttpError(400, `At most ${MAX_SIDE}×${MAX_SIDE} pixels.`, 'too_big');
  if (Math.min(meta.width, meta.height) < MIN_SIDE) throw new HttpError(400, `At least ${MIN_SIDE}×${MIN_SIDE} pixels, so it stays sharp at large size.`, 'too_small');
  try {
    return await sharp(buf, opts)
      .ensureAlpha()
      .resize(OUT_SIDE, OUT_SIDE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch {
    throw new HttpError(400, 'That file couldn’t be read as an image.', 'unreadable');
  }
}
