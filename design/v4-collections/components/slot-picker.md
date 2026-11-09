# Slot picker

- **Desktop:** a sticky left column grouped into Armour and Weapons. Each row has the slot glyph, the name, "have / total" and a mini bar (count only, no bar, without the catalog). The current slot is `aria-current="true"`, with an accent inset edge.
- **Phone:** a horizontally scrolling chip row with an accent underline on the current chip.
- **`.tracker` layout:** picker | grid | detail pane on desktop (`.no-detail` drops the third column); a single column on phone.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.slotpick { display: flex; flex-direction: column; gap: var(--es-space-2); padding: var(--es-space-8); }
.slotpick .grp { font: var(--es-weight-semibold) var(--es-fs-11) var(--es-font-body); letter-spacing: var(--es-tracking-eyebrow); text-transform: uppercase; color: var(--es-muted); padding: var(--es-space-10) var(--es-space-8) var(--es-space-4); }
.spi { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: auto auto; gap: var(--es-space-2) var(--es-space-10); align-items: center; padding: var(--es-space-8) var(--es-space-10); border-radius: var(--es-radius-md); border: var(--es-border-1) solid transparent; background: none; color: var(--es-text-2); text-align: left; font: inherit; cursor: pointer; text-decoration: none; }
.spi .cg { grid-row: span 2; width: var(--es-size-icon-md); height: var(--es-size-icon-md); }
.spi .n { font-size: var(--es-fs-13-5); font-weight: var(--es-weight-semibold); color: var(--es-text); }
.spi .c { font: var(--es-fs-12) var(--es-font-mono); color: var(--es-muted); white-space: nowrap; }
.spi .bar { grid-column: 2 / -1; height: var(--es-size-bar-h-sm); }
.spi:hover { background: var(--es-raised); }
.spi[aria-current="true"] { background: var(--es-raised); border-color: var(--es-line-strong); color: var(--es-text); box-shadow: inset var(--es-border-3) 0 0 var(--es-accent); }
.spi[aria-current="true"] .cg { color: var(--es-accent-2); }
.spi.done .c::after { content: " ✓"; color: var(--es-success); }
.tracker { display: grid; grid-template-columns: var(--es-coll-slotpick-w) minmax(0, 1fr) var(--es-coll-detail-w); gap: var(--es-space-20); align-items: start; }
.tracker > .picker { position: sticky; top: var(--es-space-16); max-height: none; }
.tracker > .center { display: flex; flex-direction: column; gap: var(--es-space-16); min-width: 0; }
.tracker.no-detail { grid-template-columns: var(--es-coll-slotpick-w) minmax(0, 1fr); }
  .tracker, .tracker.no-detail { grid-template-columns: minmax(0, 1fr); }
  .tracker > .picker { position: static; }
  .slotpick { flex-direction: row; overflow-x: auto; padding: var(--es-space-6); gap: var(--es-space-6); }
  .slotpick .grp { display: none; }
  .spi { flex: none; grid-template-columns: auto auto; grid-template-rows: auto; padding: var(--es-space-6) var(--es-space-10); border-color: var(--es-line); }
  .spi .cg { grid-row: auto; width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); }
  .spi .bar { display: none; }
  .spi .n { font-size: var(--es-fs-13); }
  .spi[aria-current="true"] { box-shadow: inset 0 calc(var(--es-border-3) * -1) 0 var(--es-accent); }
  .spi .c { grid-column: 2; }
```
