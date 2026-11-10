import { createElement, memo, useId } from 'react';

/**
 * Guild badge art (0.7.1). The SVGs in ./art/ are design/v2-guild-badges/badges/ COPIED VERBATIM (so the next handoff
 * diffs cleanly). Like the player badges (badges/art.jsx), they colour themselves with style="--gc:…;--gm:…;--gi:…"
 * attributes, which the CSP forbids, so each file is parsed once here and drawn as React elements (styles go through
 * the CSSOM). The art follows the page's theme tokens, and the numerals render in the self-hosted Cinzel.
 *
 * Templates: a partner guild's emblem (the admin's re-encoded PNG, served from our own origin) replaces the
 * partner-guild-mark slot, inside the circle the template draws (21px at 32,25; inline 26px at 32,28). The Deeds
 * template's stat-motif slot keeps its own neutral motif. Nothing else in a drawing is ever changed.
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

function toNode(el) {
  const props = {};
  let slot = null;
  for (const a of el.attributes) {
    const n = a.name;
    if (n === 'style' || n === 'data-es-style') props.style = styleObject(a.value);
    else if (n === 'data-slot') slot = a.value;
    else if (n === 'id' || n === 'xmlns' || n === 'role' || n === 'aria-label' || n === 'width' || n === 'height') continue;
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
    // The template files open with a comment containing "--" (not well-formed XML): comments are dropped here.
    // 0.9.1: style="…" is renamed before parsing: Chrome reported every one against the CSP while DOMParser built the
    // (inert) document, though React then draws them through the CSSOM. toNode reads it back as the style.
    const doc = new DOMParser().parseFromString(raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml-stylesheet[^>]*\?>/g, '').replace(/(\s)style="/g, '$1data-es-style="'), 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg && !doc.querySelector('parsererror')) node = toNode(svg);
  }
  cache.set(path, node);
  return node;
}

export const hasGuildArt = (path) => Boolean(FILES[`./art/${path}.svg`]);

function render(node, ctx, key, extra = null) {
  if (node.slot === 'partner-guild-mark' && ctx.mark) {
    const r = ctx.inline ? 13 : 10.5;
    const cy = ctx.inline ? 28 : 25;
    return createElement('g', { key }, [
      createElement('clipPath', { key: 'c', id: ctx.clipId }, createElement('circle', { cx: 32, cy, r })),
      createElement('image', { key: 'i', href: ctx.mark, x: 32 - r, y: cy - r, width: r * 2, height: r * 2, clipPath: `url(#${ctx.clipId})`, preserveAspectRatio: 'xMidYMid slice' }),
    ]);
  }
  const children = node.children.length ? node.children.map((c, i) => render(c, ctx, i)) : node.text || undefined;
  return createElement(node.tag, { key, ...node.props, ...extra }, children);
}

/** <GuildBadgeArt badge inline /> → the badge's <svg>, aria-hidden (the wrapper carries the name). */
export const GuildBadgeArt = memo(function GuildBadgeArt({ badge, inline = false }) {
  const clipId = `gpm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const path = inline && hasGuildArt(`${badge.art}-inline`) ? `${badge.art}-inline` : badge.art;
  const node = parsed(path);
  if (!node) return <svg viewBox="-3 -5 70 70" aria-hidden="true" focusable="false" />;
  return render(node, { mark: badge.mark ?? null, inline, clipId }, 'root', { 'aria-hidden': 'true', focusable: 'false' });
});
