# Collection section

A collapsible section on the Collections tab. It behaves like the statistics categories since 0.6.0: collapsed by default, with a one-line summary.

- **Header button** (`aria-expanded`): glyph, title, summary, account marker, and on desktop a mini completion bar when the catalog exists.
- `.is-open` shows the body. Mounts, pets, toys and heirlooms show the first 12 tiles and "Open {collection}".
- `.is-optional` has a dashed edge, for optional modules.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.csec { background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); overflow: hidden; }
.csec > .hd { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--es-space-4) var(--es-space-14); padding: var(--es-space-14) var(--es-space-18); background: color-mix(in oklab, var(--es-raised) 60%, transparent); border: 0; color: var(--es-text); text-align: left; font: inherit; cursor: pointer; }
.csec > .hd .cg { color: var(--es-accent-2); }
.csec > .hd .tt { display: flex; flex-direction: column; gap: var(--es-space-2); min-width: 0; }
.csec > .hd .tt .h3 { font-size: var(--es-fs-17); }
.csec > .hd .tt .meta { display: flex; flex-wrap: wrap; gap: var(--es-space-2) var(--es-space-10); align-items: center; font-size: var(--es-fs-12-5); color: var(--es-text-2); }
.csec > .hd .side { display: flex; align-items: center; gap: var(--es-space-12); }
.csec > .hd .side .bar { width: var(--es-space-120); }
.csec > .hd .chev { color: var(--es-muted); transition: transform var(--es-motion-fast) var(--es-motion-ease); }
.csec > .hd:hover { background: var(--es-raised); }
.csec.is-open > .hd { border-bottom: var(--es-border-1) solid var(--es-line); }
.csec.is-open > .hd .chev { transform: rotate(180deg); }
.csec > .bd { padding: var(--es-space-18); display: flex; flex-direction: column; gap: var(--es-space-16); }
.csec.is-optional { border-style: dashed; }
  .csec > .hd { grid-template-columns: auto minmax(0, 1fr) auto; padding: var(--es-space-12) var(--es-space-14); }
  .csec > .hd .side { display: none; }
  .csec > .bd { padding: var(--es-space-14); }
```
