# Data table

Compact rows. The `th` is sticky under the top bar. Column widths come from content. No horizontal scrolling at 1440.

**Row and cell types:**

- `.is-fail` rows: tinted, with a danger edge
- `.act` cells: a right-aligned action group
- `.chg` cells: before → after (`del`/`ins`)
- `.ratio` cells: a value plus a mini bar

**Around the table:** `.tbar` holds search, filters and a count; `.pager` sits below.

**Phone:** each row becomes a card. Cells show their column name from `data-label`; the first cell (`.dtl`) is the card title.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.dt-wrap { overflow: visible; }
.dt { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--es-fs-13); table-layout: auto; }
.dt th { position: sticky; top: var(--es-adm-topbar-h); z-index: 1; background: var(--es-surface); text-align: left; padding: var(--es-space-8) var(--es-adm-row-pad-x); border-bottom: var(--es-border-1) solid var(--es-line); color: var(--es-muted); font: var(--es-weight-semibold) var(--es-fs-11)/var(--es-lh-snug) var(--es-font-body); letter-spacing: var(--es-tracking-th); text-transform: uppercase; white-space: nowrap; }
.dt th button { all: unset; cursor: pointer; display: inline-flex; gap: var(--es-space-4); align-items: center; }
.dt td { padding: var(--es-adm-row-pad-y) var(--es-adm-row-pad-x); border-bottom: var(--es-border-1) solid var(--es-row-sep); vertical-align: middle; }
.dt tr:last-child td { border-bottom: 0; }
.dt tbody tr:hover td { background: color-mix(in oklab, var(--es-raised) 60%, transparent); }
.dt tr.is-sel td { background: var(--es-adm-nav-active); }
.dt tr.is-fail td { background: color-mix(in oklab, var(--es-danger) 8%, transparent); }
.dt tr.is-fail td:first-child { box-shadow: inset var(--es-border-3) 0 0 var(--es-danger); }
.dt .seg { flex-wrap: nowrap; }
.dt .r { text-align: right; } .dt .c { text-align: center; }
.dt .nw { white-space: nowrap; }
.dt .num { font-variant-numeric: tabular-nums; }
.dt .mono, .mono2 { font-family: var(--es-font-mono); font-size: var(--es-fs-12); }
.dt .t2 { color: var(--es-text-2); }
.dt .act { display: flex; gap: var(--es-space-4); justify-content: flex-end; flex-wrap: nowrap; }
.dt a.tgt { color: var(--es-text); font-weight: var(--es-weight-semibold); text-decoration: none; }
.dt a.tgt:hover { text-decoration: underline; }
.dt .sub { display: block; font-size: var(--es-fs-11-5); color: var(--es-muted); }
.dt .chg { font-family: var(--es-font-mono); font-size: var(--es-fs-12); color: var(--es-text-2); }
.dt .chg del { color: var(--es-muted); text-decoration: line-through; }
.dt .chg ins { color: var(--es-text); text-decoration: none; }
.dt .ratio { display: flex; flex-direction: column; gap: var(--es-space-4); min-width: var(--es-space-96); }
.dt .ratio .bar { height: var(--es-size-bar-h-sm); }
.tbar { display: flex; align-items: center; gap: var(--es-space-8); flex-wrap: wrap; padding: var(--es-space-10) var(--es-space-12); border-bottom: var(--es-border-1) solid var(--es-line); }
.tbar .search { max-width: var(--es-size-col-min-md); height: var(--es-size-control-sm); }
.tbar select.inp { width: auto; height: var(--es-size-control-sm); padding: 0 var(--es-space-8); font-size: var(--es-fs-12-5); }
.tbar .spacer { flex: 1; }
.tbar .cnt { font-size: var(--es-fs-12); color: var(--es-muted); }
.pager { display: flex; align-items: center; gap: var(--es-space-8); padding: var(--es-space-10) var(--es-space-12); font-size: var(--es-fs-12); color: var(--es-muted); border-top: var(--es-border-1) solid var(--es-line); }
.pager .spacer { flex: 1; }
.expires { display: flex; height: var(--es-space-10); border-radius: var(--es-radius-xs); overflow: hidden; min-width: var(--es-space-120); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); }
.expires > span { height: 100%; }
.expires .e1 { background: var(--es-danger); } .expires .e2 { background: var(--es-warning); } .expires .e3 { background: var(--es-c3); } .expires .e4 { background: var(--es-line-strong); }
.redact { display: inline-flex; align-items: center; gap: var(--es-space-6); font-family: var(--es-font-mono); font-size: var(--es-fs-12); color: var(--es-muted); }
.redact .dots { letter-spacing: var(--es-tracking-code); }
  .tbar .search { max-width: none; flex: 1 1 100%; }
  .dt .seg { flex-wrap: wrap; }
  .dt, .dt tbody, .dt tr, .dt td { display: block; width: 100%; }
  .dt thead { display: none; }
  .dt tr { padding: var(--es-space-10) var(--es-space-12); border-bottom: var(--es-border-1) solid var(--es-line); }
  .dt tr:last-child { border-bottom: 0; }
  .dt td { display: grid; grid-template-columns: minmax(0, 38%) minmax(0, 1fr); gap: var(--es-space-10); padding: var(--es-space-3) 0; border: 0; text-align: left !important; }
  .dt td::before { content: attr(data-label); font-size: var(--es-fs-11-5); color: var(--es-muted); font-weight: var(--es-weight-semibold); }
  .dt td > .chip, .dt td > .tier { justify-self: start; }
  .dt td.dtl { grid-template-columns: minmax(0, 1fr); padding-bottom: var(--es-space-6); font-size: var(--es-fs-14); }
  .dt td.dtl::before { display: none; }
  .dt td[data-label=""]::before { display: none; }
  .dt td[data-label=""] { grid-template-columns: minmax(0, 1fr); padding-top: var(--es-space-6); }
  .dt .act { justify-content: flex-start; flex-wrap: wrap; }
  .dt tbody tr:hover td { background: none; }
  .dt tr.is-fail { box-shadow: inset var(--es-border-3) 0 0 var(--es-danger); }
  .dt tr.is-fail td { background: none; box-shadow: none !important; }
```
