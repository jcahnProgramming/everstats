# Count card

Glyph, count, label, pin button (`aria-pressed`, "Pin {count} to your profile"), and a footer with the board rank pill (links to the board) and the account marker.

| Variant | Treatment |
|---|---|
| `.is-pinned` | Accent edge |
| `.is-off` | Dashed edge, "—", "Loads on the next refresh" |

**Phone:** a 2-column grid.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.ccounts { display: grid; gap: var(--es-space-12); grid-template-columns: repeat(auto-fill, minmax(min(var(--es-coll-count-min), 100%), 1fr)); }
.ccount { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto auto; gap: var(--es-space-2) var(--es-space-10); align-items: center; padding: var(--es-space-12) var(--es-space-12) var(--es-space-10) var(--es-space-14); background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); }
.ccount > .cg { grid-row: span 2; color: var(--es-accent-2); }
.ccount .n { font: var(--es-weight-bold) var(--es-fs-24)/var(--es-lh-none) var(--es-font-body); font-variant-numeric: tabular-nums lining-nums; }
.ccount .n small { font-size: var(--es-fs-13); color: var(--es-muted); font-weight: var(--es-weight-medium); }
.ccount .l { font-size: var(--es-fs-12-5); color: var(--es-text-2); grid-column: 2; }
.ccount .pinbtn { grid-column: 3; grid-row: 1; }
.ccount .ft { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--es-space-4) var(--es-space-10); margin-top: var(--es-space-8); padding-top: var(--es-space-8); border-top: var(--es-border-1) solid var(--es-row-sep); font-size: var(--es-fs-12); }
.ccount .ft a { text-decoration: none; }
.ccount.is-pinned { border-color: color-mix(in oklab, var(--es-accent) 60%, var(--es-line)); }
.ccount.is-off { background: none; border-style: dashed; }
.ccount.is-off .n { color: var(--es-muted); font-size: var(--es-fs-18); }
.pinbtn { display: inline-grid; place-items: center; width: var(--es-size-control-sm); height: var(--es-size-control-sm); border-radius: var(--es-radius-md); border: var(--es-border-1) solid transparent; background: none; color: var(--es-muted); cursor: pointer; }
.pinbtn svg { width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pinbtn:hover { color: var(--es-text); border-color: var(--es-line-strong); }
.pinbtn[aria-pressed="true"] { color: var(--es-accent-2); border-color: color-mix(in oklab, var(--es-accent) 50%, var(--es-line)); background: color-mix(in oklab, var(--es-accent) 12%, transparent); }
.pinbtn[aria-pressed="true"] svg { fill: currentColor; }
  .ccounts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--es-space-8); }
  .ccount { padding: var(--es-space-10) var(--es-space-8) var(--es-space-8) var(--es-space-10); gap: var(--es-space-2) var(--es-space-8); }
  .ccount .n { font-size: var(--es-fs-20); }
  .ccount .ft { gap: var(--es-space-2) var(--es-space-8); }
  .ccount .ft .acct span { display: none; }
```
