# Nav item with count

Icon, label and an optional count. The current item has `aria-current="page"`, an accent edge and a tinted background.

| `.ncount` style | Meaning |
|---|---|
| default (accent) | waiting for you |
| `.quiet` | pending |
| `.warn` | attention |
| `.err` | failing |

The count's `aria-label` spells out its meaning ("5 unread or open"). Group labels use `.grp`.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.anav { flex: 1; overflow-y: auto; padding: var(--es-space-10) var(--es-space-8); display: flex; flex-direction: column; gap: var(--es-space-1); }
.anav .grp { font: var(--es-weight-semibold) var(--es-fs-10)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-eyebrow); text-transform: uppercase; color: var(--es-muted); padding: var(--es-space-14) var(--es-space-10) var(--es-space-6); }
.nitem { display: flex; align-items: center; gap: var(--es-space-10); min-height: var(--es-adm-nav-item-h); padding: 0 var(--es-space-10); border-radius: var(--es-radius-md); color: var(--es-text-2); text-decoration: none; font-weight: var(--es-weight-medium); font-size: var(--es-fs-13-5); white-space: nowrap; border: var(--es-border-1) solid transparent; }
.nitem:hover { background: var(--es-raised); color: var(--es-text); }
.nitem[aria-current="page"] { background: var(--es-adm-nav-active); color: var(--es-text); border-color: color-mix(in oklab, var(--es-accent) 35%, transparent); box-shadow: inset var(--es-border-3) 0 0 var(--es-accent); }
.nitem[aria-current="page"] .ico { color: var(--es-accent-2); }
.nitem .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.nitem .sub { padding-left: var(--es-space-28); }
.ncount { display: inline-flex; align-items: center; justify-content: center; min-width: var(--es-adm-badge-h); height: var(--es-adm-badge-h); padding: 0 var(--es-space-6); border-radius: var(--es-radius-pill); background: var(--es-adm-count-bg); color: var(--es-adm-count-ink); font: var(--es-weight-bold) var(--es-fs-11)/var(--es-lh-none) var(--es-font-body); font-variant-numeric: tabular-nums; }
.ncount.warn { background: var(--es-warning); color: var(--es-bg); }
.ncount.err { background: var(--es-danger); color: var(--es-bg); }
.ncount.quiet { background: var(--es-raised); color: var(--es-text-2); border: var(--es-border-1) solid var(--es-line-strong); }
```
