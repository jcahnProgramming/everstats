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

export const clearImageCache = () => cache.clear();
