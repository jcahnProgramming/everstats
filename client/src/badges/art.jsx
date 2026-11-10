import { createElement, memo } from 'react';
import { FRAME_D, logoBox, logoSizeFor } from '../../../server/badges/logoBox.js';

/**
 * Badge art (0.7.0). The SVGs in ./art/ are the design export's files COPIED VERBATIM (design/v2-badges/badges/), so
 * the next handoff diffs cleanly. They colour themselves with style="--bf:var(--es-badge-…)" attributes, and our CSP
 * forbids inline style ATTRIBUTES (and an <img>-loaded SVG can't see the page's theme tokens). So each file is parsed
 * once, here, and drawn as React elements, whose styles go through the CSSOM (allowed): the art follows the page's
 * theme, and the letters (S, PT, B, D, ?) render in the site's self-hosted Cinzel.
 *
 * Templates: a platform-employee monogram replaces the template's "?" letter. Nothing else in a drawing is ever changed,
 * except by a logo (below: an <image> from our own origin, CSP 'self').
 *
 * 0.10.4: a badge with a saved LOGO (Pro Team, Platform Employee, Community Partner) keeps only its frame and draws the
 * logo in the box server/badges/logoBox.js gives (the same numbers as share cards). The name stays a text pill.
 *
 * A standalone SVG served on its own (a share image, later) would NOT have Cinzel: convert its text to outlines first.
 */
const FILES = import.meta.glob('./art/**/*.svg', { query: '?raw', import: 'default', eager: true });

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleObject(text) {
  const out = {};
  for (const part of String(text).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k.startsWith('--') ? k : camel(k)] = v;
  }
  return out;
}

/** An element as plain data: { tag, props, slot, children[] | text }. */
function toNode(el) {
  const props = {};
  let slot = null;
  for (const a of el.attributes) {
    const n = a.name;
    if (n === 'style' || n === 'data-es-style') props.style = styleObject(a.value);
    else if (n === 'data-slot') slot = a.value;
    else if (n === 'id' || n === 'xmlns' || n === 'role' || n === 'aria-label' || n === 'width' || n === 'height') continue; // ids would repeat on a page
    else if (n === 'class') props.className = a.value;
    else props[n.startsWith('data-') || n === 'viewBox' ? n : camel(n)] = a.value;
  }
  const kids = [...el.childNodes];
  const elements = kids.filter((k) => k.nodeType === 1);
  const text = elements.length ? null : kids.map((k) => k.textContent).join('').trim();
  return { tag: el.tagName, props, slot, text, children: elements.map(toNode) };
}

const cache = new Map();
function parsed(path) {
  if (cache.has(path)) return cache.get(path);
  const raw = FILES[`./art/${path}.svg`];
  let node = null;
  if (raw && typeof DOMParser !== 'undefined') {
    // The export's template files open with a comment that contains "var(--bi)": "--" inside an XML comment is not
    // well-formed, so a strict parser rejects the whole file. The files stay verbatim; comments are dropped here.
    // 0.9.1: style="…" is renamed before parsing: Chrome reported every one against the CSP while DOMParser built the
    // (inert) document, though React then draws them through the CSSOM. toNode reads it back as the style.
    const doc = new DOMParser().parseFromString(raw.replace(/<!--[\s\S]*?-->/g, '').replace(/(\s)style="/g, '$1data-es-style="'), 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg && !doc.querySelector('parsererror')) node = toNode(svg);
  }
  cache.set(path, node);
  return node;
}

export const hasArt = (path) => Boolean(FILES[`./art/${path}.svg`]);

function render(node, ctx, key, extra = null) {
  if (node.tag === 'text' && ctx.monogram && (node.text === '?' || ctx.inMonogramSlot)) {
    return createElement('text', { key, ...node.props }, ctx.monogram);
  }
  const inner = { ...ctx, inMonogramSlot: ctx.inMonogramSlot || node.slot === 'platform-monogram' };
  const children = node.children.length ? node.children.map((c, i) => render(c, inner, i)) : node.text || undefined;
  return createElement(node.tag, { key, ...node.props, ...extra }, children);
}

/** The frame alone, plus the logo (and its plate) in the shared box. Nothing else from the drawing. */
function renderLogo(node, logo, inline, size) {
  const box = logoBox(inline, logo.backing);
  const frame = node.children.filter((c) => c.tag === 'path' && c.props.d === FRAME_D).map((c, i) => render(c, {}, `f${i}`));
  const plate = box.plate ? createElement('rect', { key: 'plate', x: box.plate.x, y: box.plate.y, width: box.plate.size, height: box.plate.size, rx: box.plate.r, style: { fill: 'var(--bi)' } }) : null;
  const href = logo.srcs?.[logoSizeFor(size)] ?? logo.srcs?.[256] ?? null;
  const image = href ? createElement('image', { key: 'logo', href, x: box.x, y: box.y, width: box.size, height: box.size, preserveAspectRatio: 'xMidYMid meet' }) : null;
  return createElement(node.tag, { key: 'root', ...node.props, 'aria-hidden': 'true', focusable: 'false' }, [...frame, plate, image].filter(Boolean));
}

/**
 * <BadgeArt badge inline size /> → the badge's <svg>, aria-hidden (the wrapper carries the name). inline uses the
 * simplified *-inline.svg drawing; size ('inline' | 'std' | 'lg' | 'xl') picks the logo's re-encoded size.
 */
export const BadgeArt = memo(function BadgeArt({ badge, inline = false, size = null }) {
  const path = inline && hasArt(`${badge.art}-inline`) ? `${badge.art}-inline` : badge.art;
  const node = parsed(path);
  if (!node) return <svg viewBox="-3 -3 70 70" aria-hidden="true" focusable="false" />;
  if (badge.logo) return renderLogo(node, badge.logo, inline, size ?? (inline ? 'inline' : 'std'));
  return render(node, { monogram: badge.monogram ?? null }, 'root', { 'aria-hidden': 'true', focusable: 'false' });
});
