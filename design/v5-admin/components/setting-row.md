# Setting row

Label, description and env name, then a value with its unit, then the default ("Default 20", or "Changed · default 12 h" in accent).

- `.is-hit`: the row reached from settings search.
- `.ro`: read-only.
- **Grouped** in panels, with an in-page index (`.inpage`).
- **Sticky `.savebar`:** shows the number of unsaved changes, with Discard, Preview and Save. Save asks for a reason when the change affects players.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.setgroup { display: flex; flex-direction: column; }
.srow { display: grid; grid-template-columns: var(--es-adm-setting-label-w) minmax(0, 1fr) auto; gap: var(--es-space-6) var(--es-space-20); align-items: center; padding: var(--es-space-12) var(--es-space-16); border-bottom: var(--es-border-1) solid var(--es-row-sep); }
.srow:last-child { border-bottom: 0; }
.srow .k { display: flex; flex-direction: column; gap: var(--es-space-2); min-width: 0; }
.srow .k b { font-size: var(--es-fs-13-5); font-weight: var(--es-weight-semibold); }
.srow .k span { font-size: var(--es-fs-12); color: var(--es-text-2); }
.srow .k code { font: var(--es-fs-11) var(--es-font-mono); color: var(--es-muted); }
.srow .v { display: flex; align-items: center; gap: var(--es-space-8); flex-wrap: wrap; min-width: 0; }
.srow .v .inp { width: var(--es-space-120); height: var(--es-size-control-sm); }
.srow .v .inp.wide { width: 100%; max-width: var(--es-size-col-min-lg); }
.srow .v .unit { font-size: var(--es-fs-12); color: var(--es-muted); }
.srow .d { font-size: var(--es-fs-12); color: var(--es-muted); white-space: nowrap; text-align: right; }
.srow .d.changed { color: var(--es-accent-2); }
.srow.is-hit { background: color-mix(in oklab, var(--es-accent) 10%, transparent); box-shadow: inset var(--es-border-3) 0 0 var(--es-accent); }
.srow.ro .v { color: var(--es-text-2); }
.savebar { position: sticky; top: calc(var(--es-adm-topbar-h) + var(--es-space-8)); z-index: var(--es-z-sticky); display: flex; align-items: center; gap: var(--es-space-10); padding: var(--es-space-10) var(--es-space-14); border-radius: var(--es-radius-lg); background: var(--es-raised); border: var(--es-border-1) solid var(--es-accent); box-shadow: var(--es-shadow-toast); flex-wrap: wrap; }
.savebar .spacer { flex: 1; }
.inpage { display: grid; grid-template-columns: var(--es-size-col-min-xs) minmax(0, 1fr); gap: var(--es-space-20); align-items: start; }
.inpage nav { position: sticky; top: calc(var(--es-adm-topbar-h) + var(--es-space-16)); display: flex; flex-direction: column; gap: var(--es-space-2); font-size: var(--es-fs-13); }
.inpage nav a { padding: var(--es-space-6) var(--es-space-10); border-radius: var(--es-radius-sm); color: var(--es-text-2); text-decoration: none; }
.inpage nav a[aria-current="true"] { color: var(--es-text); background: var(--es-raised); box-shadow: inset var(--es-border-2) 0 0 var(--es-accent); }
  .srow { grid-template-columns: minmax(0, 1fr); padding: var(--es-space-12); }
  .srow .d { text-align: left; }
  .inpage { grid-template-columns: minmax(0, 1fr); }
  .inpage nav { position: static; flex-direction: row; overflow-x: auto; }
  .inpage nav a { white-space: nowrap; }
  .savebar { position: static; }
```
