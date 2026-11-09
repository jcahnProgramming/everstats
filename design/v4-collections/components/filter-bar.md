# Filter bar

Search, then the All / Collected / Missing segment (Missing only with the catalog), then selects: armour type, quality, and source (Raid / Dungeon / Other, only with the sources module).

- Active filters show as removable chips, with "Clear all".
- **Phone:** search takes the full width; the selects share rows.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.fbar { display: flex; flex-wrap: wrap; gap: var(--es-space-10); align-items: center; }
.fbar .search { max-width: var(--es-size-col-min-md); }
.fbar select.inp { width: auto; min-height: var(--es-size-control-md); height: var(--es-size-control-md); padding: 0 var(--es-space-10); font-size: var(--es-fs-13); }
.fbar .spacer { flex: 1; }
.fchips { display: flex; flex-wrap: wrap; gap: var(--es-space-6); align-items: center; }
.fchip { display: inline-flex; align-items: center; gap: var(--es-space-4); padding: var(--es-space-2) var(--es-space-4) var(--es-space-2) var(--es-space-10); border-radius: var(--es-radius-pill); border: var(--es-border-1) solid var(--es-line-strong); background: var(--es-sunken); font-size: var(--es-fs-12); color: var(--es-text); }
.fchip button { display: inline-grid; place-items: center; width: var(--es-space-22); height: var(--es-space-22); border: 0; border-radius: var(--es-radius-round); background: none; color: var(--es-muted); cursor: pointer; }
.fchip button:hover { color: var(--es-text); background: var(--es-raised); }
  .fbar .search { max-width: none; flex-basis: 100%; }
  .fbar select.inp { flex: 1 1 var(--es-size-col-min-xs); }
```
