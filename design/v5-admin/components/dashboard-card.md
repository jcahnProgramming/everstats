# Dashboard card and grid

**Card anatomy:**

- title and scope chip (the version, or "All versions")
- headline number, with its change since the last check
- a small trend (`.spark`) or breakdown (`.bdrow`, `.splitbar`)
- footer: "Since last check" and a link to the full section

**Grid:** `.dgrid` is a flex-wrap grid with grow, so rows always fill. Cards use basis `--es-adm-card-basis`; `.w` cards use `--es-adm-card-basis-wide`. On phones it's one column.

**Edit mode** (`.dgrid.is-editing`):

- dashed cards, each with a grip and an eye (hide)
- `.is-dragging` lifts the card
- `.drop` marks the target slot
- `.hiddentray` lists hidden cards with Show

This uses the site's live-drag component.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(var(--es-size-col-min-xs), 100%), 1fr)); gap: var(--es-space-10); }
.kpi { display: flex; flex-direction: column; gap: var(--es-space-4); padding: var(--es-space-10) var(--es-space-12); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-md); min-width: 0; }
.kpi .l { font-size: var(--es-fs-12); color: var(--es-text-2); }
.kpi .v { font: var(--es-weight-bold) var(--es-fs-20)/var(--es-lh-none) var(--es-font-body); font-variant-numeric: tabular-nums lining-nums; }
.kpi .d { font-size: var(--es-fs-11-5); color: var(--es-muted); }
.delta { font: var(--es-weight-semibold) var(--es-fs-12) var(--es-font-body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.delta.up { color: var(--es-success); } .delta.down { color: var(--es-danger); } .delta.flat { color: var(--es-muted); }
.spark { width: 100%; height: var(--es-adm-spark-h); display: block; }
.spark rect { fill: color-mix(in oklab, var(--es-accent) 65%, transparent); }
.spark rect.last { fill: var(--es-accent); }
.splitbar { display: flex; height: var(--es-space-20); border-radius: var(--es-radius-sm); overflow: hidden; border: var(--es-border-1) solid var(--es-line); }
.splitbar > span { display: flex; align-items: center; padding: 0 var(--es-space-6); font: var(--es-weight-bold) var(--es-fs-11)/var(--es-lh-none) var(--es-font-body); color: var(--es-bg); white-space: nowrap; overflow: hidden; }
.splitbar .al { background: var(--es-c2); } .splitbar .ho { background: var(--es-danger); } .splitbar .nn { background: var(--es-line-strong); color: var(--es-text); }
.splitbar .s1 { background: var(--es-accent); } .splitbar .s2 { background: var(--es-c2); } .splitbar .s3 { background: var(--es-c3); } .splitbar .s4 { background: var(--es-c4); } .splitbar .s5 { background: var(--es-line-strong); color: var(--es-text); }
.splitbar.sm { height: var(--es-space-10); } .splitbar.sm > span { padding: 0; }
.breakdown { display: flex; flex-direction: column; gap: var(--es-space-6); font-size: var(--es-fs-12-5); }
.bdrow { display: grid; grid-template-columns: minmax(0, 1fr) var(--es-space-96) auto; gap: var(--es-space-10); align-items: center; }
.bdrow .bar { height: var(--es-size-bar-h-sm); }
.bdrow .n { font-variant-numeric: tabular-nums; color: var(--es-text); text-align: right; min-width: var(--es-space-48); }
.dgrid { display: flex; flex-wrap: wrap; gap: var(--es-space-14); align-items: stretch; }
.dcard { flex: 1 1 var(--es-adm-card-basis); min-width: 0; min-height: var(--es-adm-card-min-h); display: flex; flex-direction: column; background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); position: relative; }
.dcard.w { flex-basis: var(--es-adm-card-basis-wide); }
.dcard > .hd { display: flex; align-items: center; gap: var(--es-space-8); padding: var(--es-space-12) var(--es-space-14) 0; }
.dcard > .hd h2 { font: var(--es-weight-bold) var(--es-fs-11-5)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-eyebrow); text-transform: uppercase; color: var(--es-text-2); }
.dcard > .hd .spacer { flex: 1; }
.dcard > .hd .edit { display: none; gap: var(--es-space-4); }
.dcard > .bd { flex: 1; padding: var(--es-space-10) var(--es-space-14) var(--es-space-12); display: flex; flex-direction: column; gap: var(--es-space-10); }
.dcard .head { display: flex; align-items: baseline; gap: var(--es-space-8); flex-wrap: wrap; }
.dcard .head .big { font: var(--es-weight-bold) var(--es-fs-30)/var(--es-lh-none) var(--es-font-body); font-variant-numeric: tabular-nums lining-nums; }
.dcard .head .lab { font-size: var(--es-fs-12-5); color: var(--es-text-2); }
.dcard > .ft { display: flex; align-items: center; gap: var(--es-space-8); padding: var(--es-space-8) var(--es-space-14); border-top: var(--es-border-1) solid var(--es-row-sep); font-size: var(--es-fs-12); }
.dcard > .ft a { text-decoration: none; font-weight: var(--es-weight-semibold); }
.dcard > .ft .spacer { flex: 1; }
.dcard .grip { cursor: grab; color: var(--es-muted); }
.dgrid.is-editing .dcard > .hd .edit { display: inline-flex; }
.dgrid.is-editing .dcard { border-style: dashed; border-color: var(--es-line-strong); }
.dcard.is-dragging { border-style: solid !important; border-color: var(--es-accent) !important; box-shadow: var(--es-shadow-modal); transform: rotate(-1deg) translateY(calc(var(--es-space-4) * -1)); z-index: var(--es-z-dropdown); }
.dcard.drop { border: var(--es-border-2) dashed var(--es-adm-drop) !important; background: color-mix(in oklab, var(--es-adm-drop) 7%, transparent); align-items: center; justify-content: center; color: var(--es-text-2); font-size: var(--es-fs-13); }
.hiddentray { display: flex; align-items: center; gap: var(--es-space-8); flex-wrap: wrap; padding: var(--es-space-10) var(--es-space-14); border-radius: var(--es-radius-lg); border: var(--es-border-1) dashed var(--es-line-strong); font-size: var(--es-fs-12-5); color: var(--es-text-2); }
  .dcard, .dcard.w { flex-basis: 100%; }
```
