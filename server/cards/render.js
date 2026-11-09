import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { CARD_TYPES, FORMATS } from './catalog.js';

/**
 * The share-card renderer (0.8.0): headless Chromium (playwright-core + Playwright's chromium headless shell) at
 * exactly the card size, following design/v3-share-cards/cards/render-example.mjs: load the template, swap the example
 * data script for the real CARD_DATA, wait for html[data-ready="1"] (fill.js: data bound, images loaded, fonts ready,
 * long names shrunk), screenshot [data-card] as PNG.
 *
 * Safety: the page is loaded from a made-up origin (CARD_ORIGIN) and EVERY request is intercepted: the kit's own files
 * are served from disk (server/cards/kit, the design's files copied verbatim), the data script is ours, and anything
 * else (including Blizzard's host) is aborted. Blizzard's images arrive as data: URIs (images.js), so the card page
 * never reaches the network. Text is bound by fill.js with textContent (escaped); only server-made badge SVG goes in
 * as markup.
 *
 * Cost control (a viral link must not take the server down):
 *   - ONE browser, shared, launched on first use and closed after IDLE_CLOSE_MS without a render (frees its memory).
 *   - at most `maxConcurrent` renders at once (admin setting cards.maxConcurrent, default 2), each in its own
 *     short-lived browser context; at most `maxQueue` waiting. A full queue answers "busy" at once (the route turns it
 *     into a 503 with Retry-After) instead of piling up work.
 *   - RENDER_TIMEOUT_MS per card; a crashed browser is relaunched on the next render.
 * Every render's time is kept (last RECENT_KEPT) for the admin page and scripts/measure-cards.js.
 */
export const KIT = resolve(import.meta.dirname, 'kit');
const CARDS_DIR = resolve(KIT, 'v3-share-cards', 'cards');
export const CARD_ORIGIN = 'https://card.everstats.invalid';
export const RENDER_TIMEOUT_MS = 20_000;
export const IDLE_CLOSE_MS = 5 * 60 * 1000;
const RECENT_KEPT = 50;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

export class RendererBusy extends Error {
  constructor() {
    super('The card renderer is busy');
    this.code = 'renderer_busy';
  }
}

/** A kit file for a request path, or null (never anything outside the kit). */
async function kitFile(pathname) {
  const file = resolve(KIT, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(KIT + sep)) return null;
  const type = TYPES[extname(file)];
  if (!type) return null;
  try {
    return { body: await readFile(file), type };
  } catch {
    return null;
  }
}

/** The script that replaces ../data/<type>.example.js: CARD_DATA as JSON, safe inside a <script>. */
// Written without backslash escapes on purpose: "<", U+2028 and U+2029 become JSON unicode escapes (backslash + u + hex).
const BACKSLASH = String.fromCharCode(92);
const UNSAFE = new RegExp(`[<${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');
const escapeChar = (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
export const dataScript = (data) => `window.CARD_DATA = ${JSON.stringify(data).replace(UNSAFE, escapeChar)};`;

export function createCardRenderer({ maxConcurrent = () => 2, maxQueue = 8, launch = null, log = console, now = Date.now } = {}) {
  let browser = null;
  let launching = null;
  let idleTimer = null;
  let running = 0;
  const waiting = [];
  const recent = [];
  let launches = 0;

  const getBrowser = async () => {
    if (browser?.isConnected()) return browser;
    if (!launching) {
      launching = (async () => {
        const start = launch ?? (async () => (await import('playwright-core')).chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] }));
        const b = await start();
        launches += 1;
        b.on('disconnected', () => {
          if (browser === b) browser = null;
        });
        browser = b;
        return b;
      })().finally(() => {
        launching = null;
      });
    }
    return launching;
  };

  const scheduleIdleClose = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (running === 0 && !waiting.length && browser) {
        const b = browser;
        browser = null;
        b.close().catch(() => {});
      }
    }, IDLE_CLOSE_MS);
    idleTimer.unref?.();
  };

  const acquire = async () => {
    const limit = Math.max(1, Number(await maxConcurrent()) || 1);
    if (running < limit) {
      running += 1;
      return;
    }
    if (waiting.length >= maxQueue) throw new RendererBusy();
    await new Promise((res) => waiting.push(res));
    running += 1;
  };
  const release = () => {
    running -= 1;
    const next = waiting.shift();
    if (next) next();
    else scheduleIdleClose();
  };

  /**
   * Renders one card → { png: Buffer, ms }. type: a CARD_TYPES key; format/layout from the options; subject 'guild'
   * picks a board's guild template. data: CARD_DATA (images already data: URIs).
   */
  async function render({ type, format, layout, subject = null, data }) {
    const size = FORMATS[format];
    const template = CARD_TYPES[type]?.template(format, layout, subject);
    if (!size || !template) throw new Error('unknown card');
    await acquire();
    const t0 = now();
    let context = null;
    try {
      const b = await getBrowser();
      context = await b.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, javaScriptEnabled: true, offline: false });
      const page = await context.newPage();
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== CARD_ORIGIN) return route.abort('blockedbyclient');
        if (/\/cards\/data\/[a-z-]+\.example\.js$/.test(url.pathname)) {
          return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: dataScript(data) });
        }
        const f = await kitFile(url.pathname);
        return f ? route.fulfill({ status: 200, contentType: f.type, body: f.body }) : route.abort('blockedbyclient');
      });
      await page.goto(`${CARD_ORIGIN}/v3-share-cards/cards/${template}`, { timeout: RENDER_TIMEOUT_MS, waitUntil: 'load' });
      await page.waitForSelector('html[data-ready="1"]', { timeout: RENDER_TIMEOUT_MS, state: 'attached' });
      // The card's own box, as a page screenshot: no scrolling or 'stable element' waits (fill.js has finished by now).
      const box = await page.locator('[data-card]').boundingBox({ timeout: RENDER_TIMEOUT_MS });
      if (!box) throw new Error('the card has no box');
      const png = await page.screenshot({ type: 'png', clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }, timeout: RENDER_TIMEOUT_MS, animations: 'disabled' });
      const ms = now() - t0;
      recent.push({ at: now(), ms, type, format });
      if (recent.length > RECENT_KEPT) recent.shift();
      return { png, ms };
    } catch (err) {
      if (err instanceof RendererBusy) throw err;
      log.error?.(`[cards] render failed: ${err.name}${err.code ? ` ${err.code}` : ''}`);
      throw err;
    } finally {
      if (context) await context.close().catch(() => {});
      release();
    }
  }

  return {
    render,
    stats: () => ({ running, waiting: waiting.length, launches, browser: Boolean(browser?.isConnected()), recent: [...recent] }),
    async close() {
      clearTimeout(idleTimer);
      const b = browser;
      browser = null;
      if (b) await b.close().catch(() => {});
    },
  };
}

export { CARDS_DIR };
