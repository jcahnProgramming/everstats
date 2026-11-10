# Needs-you strip

A slim strip at the top of the Dashboard. Its title shows the item count. Each item is a link chip with a status icon pointing to where it's dealt with:

- unread feedback, open reports and appeals → Inbox
- a stuck or failed catalog → Data › Collections & catalogs
- a failed backup → Data › Backups
- crawler errors or near its budget (≥ 90%) → Data › Crawler
- retention outside its window → Data retention

`.clear` shows "All clear" with a one-line summary.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.needs { display: flex; align-items: center; gap: var(--es-space-8); flex-wrap: wrap; padding: var(--es-space-8) var(--es-space-10) var(--es-space-8) var(--es-space-14); border-radius: var(--es-radius-lg); background: var(--es-surface); border: var(--es-border-1) solid color-mix(in oklab, var(--es-warning) 45%, var(--es-line)); }
.needs > .t { font: var(--es-weight-bold) var(--es-fs-12)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-eyebrow); text-transform: uppercase; color: var(--es-warning); display: inline-flex; gap: var(--es-space-6); align-items: center; margin-right: var(--es-space-4); }
.needs > .t svg { width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.needs > .t { white-space: nowrap; }
.needs .it { display: inline-flex; align-items: center; gap: var(--es-space-6); height: var(--es-size-control-sm); padding: 0 var(--es-space-10); border-radius: var(--es-radius-md); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); color: var(--es-text); text-decoration: none; font-size: var(--es-fs-12-5); font-weight: var(--es-weight-medium); white-space: nowrap; }
.needs .it:hover { border-color: var(--es-line-strong); background: var(--es-raised); }
.needs .it svg { width: var(--es-size-icon-xs); height: var(--es-size-icon-xs); stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.needs .it.err svg { stroke: var(--es-danger); } .needs .it.warn svg { stroke: var(--es-warning); } .needs .it.info svg { stroke: var(--es-accent-2); }
.needs .it b { font-variant-numeric: tabular-nums; }
.needs.clear { border-color: color-mix(in oklab, var(--es-success) 45%, var(--es-line)); }
.needs.clear > .t { color: var(--es-success); }
.needs.clear .m { color: var(--es-text-2); font-size: var(--es-fs-13); }
```
