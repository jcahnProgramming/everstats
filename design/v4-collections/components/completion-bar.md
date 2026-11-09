# Completion bar

A label plus "**have** / total · pct%", above a v1 `.bar`.

- `.lg` for the overall tracker figure; `.done` (success fill) at 100%.
- `.cbig` is the big figure, e.g. "412 / 2,140".
- **Only with the catalog module.** Without it, show `.cbig` with the plain count and no bar.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.cbar { display: flex; flex-direction: column; gap: var(--es-space-6); min-width: 0; }
.cbar .hd { display: flex; align-items: baseline; gap: var(--es-space-8); flex-wrap: wrap; }
.cbar .hd .lbl { font-weight: var(--es-weight-semibold); font-size: var(--es-fs-13-5); }
.cbar .hd .num { margin-left: auto; font-size: var(--es-fs-13); color: var(--es-text-2); white-space: nowrap; }
.cbar .hd .num b { color: var(--es-text); }
.cbar .bar > span { background: var(--es-accent); }
.cbar.lg .hd .num { font-size: var(--es-fs-15); }
.cbar.lg .bar { height: calc(var(--es-size-bar-h) * 1.6); }
.cbar.done .bar > span { background: var(--es-success); }
.cbig { display: flex; align-items: baseline; gap: var(--es-space-8); flex-wrap: wrap; }
.cbig b { font: var(--es-weight-bold) var(--es-fs-32)/var(--es-lh-none) var(--es-font-display); }
.cbig span { color: var(--es-text-2); }
```
