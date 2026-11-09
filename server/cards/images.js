import { RENDER_ORIGIN } from '../crawler/parse.js';

/**
 * Blizzard's images for a share card (0.8.0): the character render and the item icons. The server fetches them (the
 * README: "The renderer fetches Blizzard's render and item icons server-side"; a browser couldn't, the render host
 * doesn't allow it) and hands them to Chromium as data: URIs, so the card page itself makes NO network request at all
 * (render.js refuses every one).
 *
 *   only https://render.worldofwarcraft.com (the one image host the parser keeps), image/* answers, ≤ MAX_BYTES,
 *   FETCH_TIMEOUT_MS each. A failure is null: the card shows the crest version for a render, an empty quality frame
 *   for an icon. Never a stand-in picture.
 *
 * A small in-memory cache (MAX_CACHED images, CACHE_MS) spares Blizzard when one card is rendered in several formats.
 * It lives in memory only, for minutes: well inside the 30-day rule, and never in a backup.
 */
export const FETCH_TIMEOUT_MS = 6000;
export const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CACHED = 200;
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map(); // url → { at, value }

export function isRenderUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === RENDER_ORIGIN && u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** One image → a data: URI, or null. */
export async function fetchImage(url, { fetch = globalThis.fetch, now = Date.now } = {}) {
  if (!url || !isRenderUrl(url)) return null;
  const hit = cache.get(url);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  let value = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' });
    const type = String(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (res.ok && /^image\/(png|jpeg|webp|gif)$/.test(type)) {
      const length = Number(res.headers.get('content-length') ?? 0);
      if (!(length > MAX_BYTES)) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= MAX_BYTES) value = `data:${type};base64,${buf.toString('base64')}`;
      }
    }
  } catch {
    value = null;
  }
  cache.delete(url);
  cache.set(url, { at: now(), value });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return value;
}

/**
 * The character render, cropped to the figure (0.8.1). Blizzard's main-raw is a 1600×1200 landscape PNG with the figure
 * in the middle and most of the picture transparent: a dwarf fills less than half its height. The card's render panel
 * sizes the figure from the panel (layout/cards-layout.js), so the image handed to Chromium is cut to the figure's own
 * outline (every pixel more than ALPHA_MIN opaque) plus a little air. Measured on live renders (2026-11-09): figures
 * span 46–56% of the height, feet at ~82%. An image with no transparency, or nothing opaque, is passed on uncropped.
 */
export const ALPHA_MIN = 24;
const PAD = { top: 0.04, side: 0.03, bottom: 0.015 };
const figureCache = new Map(); // url → { at, value }

export async function figureCrop(dataUri) {
  if (!dataUri) return null;
  const comma = dataUri.indexOf(',');
  const buf = Buffer.from(dataUri.slice(comma + 1), 'base64');
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(buf).metadata();
    if (!meta.hasAlpha || !meta.width || !meta.height) return dataUri;
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * channels;
      for (let x = 0; x < w; x++) {
        if (data[row + x * channels + 3] > ALPHA_MIN) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return dataUri;
    const fh = y1 - y0 + 1;
    const left = Math.max(0, Math.floor(x0 - fh * PAD.side));
    const top = Math.max(0, Math.floor(y0 - fh * PAD.top));
    const right = Math.min(w, Math.ceil(x1 + 1 + fh * PAD.side));
    const bottom = Math.min(h, Math.ceil(y1 + 1 + fh * PAD.bottom));
    const out = await sharp(buf).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
    return `data:image/png;base64,${out.toString('base64')}`;
  } catch {
    return dataUri;
  }
}

/** fetchImage + figureCrop, cached like fetchImage. */
export async function fetchRender(url, opts = {}) {
  const now = opts.now ?? Date.now;
  const hit = figureCache.get(url);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  const value = await figureCrop(await fetchImage(url, opts));
  figureCache.delete(url);
  figureCache.set(url, { at: now(), value });
  while (figureCache.size > MAX_CACHED / 4) figureCache.delete(figureCache.keys().next().value);
  return value;
}

/** Many at once (a gear strip), at most 6 in flight. → Map(url → data URI | null) */
export async function fetchImages(urls, opts) {
  const list = [...new Set(urls.filter(Boolean))];
  const out = new Map();
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const url = list[i++];
      out.set(url, await fetchImage(url, opts));
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  return out;
}

export const clearImageCache = () => {
  cache.clear();
  figureCache.clear();
};
