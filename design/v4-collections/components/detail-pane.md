# Detail pane

Opens when a tile is selected. It sits in the right column on desktop and becomes a **bottom sheet** on phones (grab handle, top radius, modal shadow, focus trapped, Esc closes).

**Missing appearance:**

- big missing tile, name, a "Missing" status (dashed, ring)
- slot and armour tags
- "Granted by N items": one card per item with its quality-coloured name, then a Blizzard source line, or the Wowhead text link when there's no source

**Collected appearance:**

- a "Collected" status (check) and the item name(s)
- optional "First seen by Everstats on [Date]"

**Pets:** health, power and speed.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.cdetail { display: flex; flex-direction: column; gap: var(--es-space-14); padding: var(--es-space-18); }
.cdetail .top { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--es-space-14); align-items: start; }
.cdetail .top .ctile { padding: 0; }
.cdetail .top .h3 { font-size: var(--es-fs-18); overflow-wrap: anywhere; }
.cdetail .grab { display: none; }
.cdetail .items { display: flex; flex-direction: column; gap: var(--es-space-10); }
.cdetail .item { display: flex; flex-direction: column; gap: var(--es-space-6); padding: var(--es-space-12); border-radius: var(--es-radius-md); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); }
.cdetail .item .nm { font-weight: var(--es-weight-semibold); font-size: var(--es-fs-14); }
.status { display: inline-flex; align-items: center; gap: var(--es-space-6); font: var(--es-weight-bold) var(--es-fs-11)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; padding: var(--es-space-5) var(--es-space-8); border-radius: var(--es-radius-sm); border: var(--es-border-1) solid var(--es-line-strong); color: var(--es-text-2); white-space: nowrap; }
.status svg { width: var(--es-size-icon-xs); height: var(--es-size-icon-xs); stroke: currentColor; fill: none; stroke-width: 3; }
.status.got { color: var(--es-success); border-color: color-mix(in oklab, var(--es-success) 55%, var(--es-line)); }
.status.miss { border-style: dashed; }
.status.miss::before { content: ""; width: var(--es-space-8); height: var(--es-space-8); border-radius: var(--es-radius-round); box-shadow: inset 0 0 0 var(--es-border-1-5) currentColor; }
  .cdetail { border-radius: var(--es-radius-xl) var(--es-radius-xl) 0 0; box-shadow: var(--es-shadow-modal); }
  .cdetail .grab { display: block; align-self: center; width: var(--es-space-40); height: var(--es-space-4); border-radius: var(--es-radius-pill); background: var(--es-line-strong); }
```
