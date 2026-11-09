import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Badge SVG for share cards (0.8.0). The card templates take a badge as SVG markup (fill.js data-slot-html: "ONLY for
 * server-generated badge/emblem SVG, never user text"). The art is the SAME verbatim export files the site draws
 * (client/src/badges/art, client/src/guildBadges/art; the Dockerfile copies both into the image). The card page is
 * rendered by our own headless Chromium with no CSP, so the files' style="--bf:…" attributes work as designed, and the
 * letters render in the card's own self-hosted Cinzel.
 *
 * Only two things in a drawing are ever changed, exactly as on the site (badges/art.jsx, guildBadges/art.jsx): a
 * partner's uploaded mark fills the partner-mark slot (as a data: URI of our own re-encoded PNG), and a platform
 * employee's monogram replaces the template's "?". Ids are prefixed per badge so two badges on one card can't clash.
 * A file that can't be read gives null: the card leaves the badge out rather than draw a wrong one.
 */
const ROOTS = {
  player: resolve(import.meta.dirname, '../../client/src/badges/art'),
  guild: resolve(import.meta.dirname, '../../client/src/guildBadges/art'),
};
const cache = new Map();

function raw(kind, art) {
  if (typeof art !== 'string' || !/^[a-z]+\/[a-z0-9-]+$/.test(art)) return null;
  const key = `${kind}:${art}`;
  if (cache.has(key)) return cache.get(key);
  let text = null;
  try {
    text = readFileSync(resolve(ROOTS[kind], `${art}.svg`), 'utf8')
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<\?xml-stylesheet[^>]*\?>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    if (!text.startsWith('<svg')) text = null;
  } catch {
    text = null;
  }
  cache.set(key, text);
  return text;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The element carrying data-slot="name", start to its matching end tag (nested <g>s counted) → [start, end] or null. */
function slotRange(svg, name) {
  const open = svg.search(new RegExp(`<([a-zA-Z]+)[^>]*data-slot="${name}"[^>]*>`));
  if (open < 0) return null;
  const tag = /<([a-zA-Z]+)/.exec(svg.slice(open))[1];
  const head = svg.indexOf('>', open);
  if (svg[head - 1] === '/') return [open, head + 1];
  let depth = 1;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'g');
  re.lastIndex = head + 1;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    if (m[2] === '/') continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return [open, m.index + m[0].length];
  }
  return null;
}

function replaceSlot(svg, name, replacement) {
  const r = slotRange(svg, name);
  return r ? svg.slice(0, r[0]) + replacement + svg.slice(r[1]) : svg;
}

let seq = 0;
function uniqueIds(svg) {
  const p = `b${(seq = (seq + 1) % 1e9)}-`;
  return svg
    .replace(/\sid="([^"]+)"/g, (_, id) => ` id="${p}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${p}${id})`)
    .replace(/(xlink:)?href="#([^"]+)"/g, (_, x, id) => `${x ?? ''}href="#${p}${id}"`);
}

const dataUri = (png) => (png ? `data:image/png;base64,${Buffer.from(png).toString('base64')}` : null);

/** A player badge (publicBadge shape: art, monogram) → SVG markup or null. `mark` is the partner mark's PNG bytes. */
export function playerBadgeSvg(badge, { mark = null } = {}) {
  let svg = raw('player', badge?.art);
  if (!svg) return null;
  if (mark) svg = replaceSlot(svg, 'partner-mark', `<image href="${dataUri(mark)}" x="17" y="17" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>`);
  if (badge.monogram) {
    const r = slotRange(svg, 'platform-monogram');
    // As on the site (badges/art.jsx): the text inside the monogram slot becomes the monogram.
    if (r) svg = svg.slice(0, r[0]) + svg.slice(r[0], r[1]).replace(new RegExp('(<text[^>]*>)[^<]*(</text>)'), (_, a, b) => `${a}${esc(badge.monogram)}${b}`) + svg.slice(r[1]);
  }
  return uniqueIds(svg);
}

/** A guild badge (publicGuildBadge shape: art for its level) → SVG markup or null. `mark`: the partner emblem PNG. */
export function guildBadgeSvg(badge, { mark = null } = {}) {
  let svg = raw('guild', badge?.art);
  if (!svg) return null;
  if (mark) {
    svg = replaceSlot(svg, 'partner-guild-mark', '<g><clipPath id="pm"><circle cx="32" cy="25" r="10.5"/></clipPath>'
      + `<image href="${dataUri(mark)}" x="21.5" y="14.5" width="21" height="21" clip-path="url(#pm)" preserveAspectRatio="xMidYMid slice"/></g>`);
  }
  return uniqueIds(svg);
}
