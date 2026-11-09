# Collection tile

A square icon slot (v1's quality-bordered gear slot language), with the name under it.

- **Collected:** solid edge in the item's quality colour (`--qc` from `.qc-*`), full icon, green check disc in the corner.
- **Missing:** dashed neutral edge, hollow background, icon faded to `--es-coll-missing-opacity` and greyscale, hollow ring in the corner, and the word "Missing".
- **Selected** (its detail pane is open): `aria-pressed="true"`, focus-coloured outline.
- **Pets:** a level chip at top left; quality is written in words under the name.
- **Loading:** `.skel-tile`.
- **Accessible name:** "{name}, collected" / "{name}, missing".
- **Sizes:** default 64, `.sm` 52, `.lg` 88. Phone uses 52.
- **Icon:** Blizzard's media image goes in `.ic > img`. The mockups use original placeholder glyphs.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.cgrid { display: grid; gap: var(--es-coll-tile-gap); grid-template-columns: repeat(auto-fill, minmax(var(--es-coll-tile-col), 1fr)); }
.cgrid.dense { grid-template-columns: repeat(auto-fill, minmax(var(--es-coll-tile), 1fr)); }
.ctile { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--es-space-6); padding: var(--es-space-8) var(--es-space-4) var(--es-space-10); border-radius: var(--es-radius-lg); border: var(--es-border-1) solid transparent; background: none; color: var(--es-text); text-align: center; text-decoration: none; font: inherit; cursor: pointer; min-width: 0; }
.ctile:hover, .ctile.is-hover { background: var(--es-raised); border-color: var(--es-line); }
.ctile:focus-visible { outline: var(--es-border-2) solid var(--es-focus); outline-offset: var(--es-space-2); }
.ctile .ic { position: relative; width: var(--es-coll-tile); height: var(--es-coll-tile); border-radius: var(--es-radius-md); background: var(--es-sunken); border: var(--es-border-2-5) solid var(--qc, var(--es-coll-collected-edge)); display: grid; place-items: center; color: var(--es-muted); }
.ctile .ic img { width: 100%; height: 100%; border-radius: var(--es-radius-sm); object-fit: cover; }
.ctile .ic > .ico, .ctile .ic > .cg { width: 46%; height: 46%; stroke-width: 1.6; }
.ctile .nm { font-size: var(--es-fs-12); font-weight: var(--es-weight-semibold); line-height: var(--es-lh-snug); max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.ctile .sub { font-size: var(--es-fs-11); color: var(--es-muted); white-space: nowrap; }
.ctile .mk { position: absolute; right: calc(var(--es-space-6) * -1); bottom: calc(var(--es-space-6) * -1); width: var(--es-coll-mark); height: var(--es-coll-mark); border-radius: var(--es-radius-round); display: grid; place-items: center; background: var(--es-coll-mark-collected); color: var(--es-coll-mark-ink); box-shadow: 0 0 0 var(--es-border-2) var(--es-bg); }
.ctile .mk svg { width: 72%; height: 72%; stroke: currentColor; fill: none; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
.ctile .lvl { position: absolute; left: calc(var(--es-space-4) * -1); top: calc(var(--es-space-4) * -1); min-width: var(--es-coll-mark); padding: 0 var(--es-space-4); border-radius: var(--es-radius-pill); background: var(--es-bg); border: var(--es-border-1) solid var(--es-line-strong); font: var(--es-weight-bold) var(--es-fs-10)/var(--es-coll-mark) var(--es-font-mono); color: var(--es-text); }
.ctile.qc-poor { --qc: var(--es-q-poor); } .ctile.qc-common { --qc: var(--es-line-strong); } .ctile.qc-uncommon { --qc: var(--es-q-uncommon); }
.ctile.qc-rare { --qc: var(--es-q-rare); } .ctile.qc-epic { --qc: var(--es-q-epic); } .ctile.qc-legendary { --qc: var(--es-q-legendary); }
.ctile.is-missing .ic { border-style: dashed; border-color: var(--es-coll-missing-edge); background: var(--es-coll-missing-bg); }
.ctile.is-missing .ic > * { opacity: var(--es-coll-missing-opacity); filter: grayscale(1); }
.ctile.is-missing .mk { background: var(--es-bg); box-shadow: inset 0 0 0 var(--es-border-2) var(--es-line-strong), 0 0 0 var(--es-border-2) var(--es-bg); }
.ctile.is-missing .mk svg { display: none; }
.ctile.is-missing .nm { color: var(--es-text-2); font-weight: var(--es-weight-medium); }
.ctile.is-selected, .ctile[aria-pressed="true"] { background: var(--es-raised); border-color: var(--es-coll-selected); box-shadow: inset 0 0 0 var(--es-border-1) var(--es-coll-selected); }
.ctile.is-loading .ic { border-color: var(--es-line); }
.ctile.sm .ic { width: var(--es-coll-tile-phone); height: var(--es-coll-tile-phone); }
.ctile.lg .ic { width: var(--es-coll-tile-lg); height: var(--es-coll-tile-lg); }
.ctile.static { cursor: default; padding: 0; }
.ctile.static:hover { background: none; border-color: transparent; }
.legend { display: flex; flex-wrap: wrap; gap: var(--es-space-8) var(--es-space-20); align-items: center; font-size: var(--es-fs-12); color: var(--es-text-2); }
.legend .ctile { flex-direction: row; padding: 0; gap: var(--es-space-8); }
.legend .ctile .ic { width: var(--es-space-28); height: var(--es-space-28); }
.legend .ctile .mk { width: var(--es-space-12); height: var(--es-space-12); right: calc(var(--es-space-4) * -1); bottom: calc(var(--es-space-4) * -1); }
.ctile.skel-tile .ic { border-color: var(--es-line); background: var(--es-raised); }
.ctile.skel-tile .nm { width: 70%; height: var(--es-space-10); border-radius: var(--es-radius-pill); background: var(--es-raised); }
  .cgrid { grid-template-columns: repeat(auto-fill, minmax(var(--es-coll-tile-col-phone), 1fr)); gap: var(--es-space-8); }
  .ctile .ic { width: var(--es-coll-tile-phone); height: var(--es-coll-tile-phone); }
  .ctile.lg .ic { width: var(--es-coll-tile); height: var(--es-coll-tile); }
```
