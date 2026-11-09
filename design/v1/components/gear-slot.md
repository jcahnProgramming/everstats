# Gear slot

One equipped item: icon square with quality-coloured border, item name in quality colour, slot + item level. Left column aligns icon-left; right column `.slot.right` mirrors it. On phone the columns become a horizontal icon strip (names hidden; tap opens a tooltip/sheet).

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.icon` — 38px square, 1.5px border in `--qc` (quality colour). Real item icons come from the Blizzard media API at runtime; mockups show a generic outline.
- `.txt` — `.nm` item name in `.q-*` colour, `.meta` “Slot · ilvl N”.
- Empty slot: `.slot.empty` — dashed border, “Empty”.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Row | padding 6px 10px 6px 6px, gap 10px, radius 8px |  |
| Icon | 38px desktop, 52px phone |  |
| Column gap | 6px |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-surface` with `--es-line` border. |
| Hover | `--es-raised`, border `--es-line-strong`; shows item tooltip. |
| Focus | Focus ring (the slot is a link/button that opens the tooltip). |
| Active | Same as hover; tooltip pinned. |
| Disabled / empty | `.slot.empty` — dashed icon border, muted text, not focusable. |
| Loading | Icon `.skel` + two `.skel-line`s. |

## Tokens used
- `--es-q-poor`, `--es-q-common`, `--es-q-uncommon`, `--es-q-rare`, `--es-q-epic`, `--es-q-legendary`
- `--es-surface`, `--es-raised`, `--es-line`, `--es-line-strong`, `--es-sunken`, `--es-muted`
- `--es-size-gear-slot`, `--es-size-gear-slot-phone`

## HTML reference
```html
<a class="slot qc-epic" href="#">
  <span class="icon"><img src="{icon}" alt=""></span>
  <span class="txt stack ellipsis"><span class="nm q-epic ellipsis">Placeholder epic item</span><span class="meta">Head · ilvl 00</span></span>
</a>
```

## CSS reference (from components.css)
```css
.gear { display: flex; flex-direction: column; gap: var(--es-space-6); }
.slot { display: grid; grid-template-columns: var(--es-size-gear-slot) minmax(0, 1fr); gap: var(--es-space-10); align-items: center; padding: var(--es-space-6) var(--es-space-10) var(--es-space-6) var(--es-space-6); background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); color: var(--es-text); text-decoration: none; }
.slot:hover, .slot.is-hover { border-color: var(--es-line-strong); background: var(--es-raised); }
.slot .icon { width: var(--es-size-gear-slot); height: var(--es-size-gear-slot); border-radius: var(--es-radius-sm); background: var(--es-sunken); border: var(--es-border-1-5) solid var(--qc, var(--es-line-strong)); display: grid; place-items: center; color: var(--es-muted); }
.slot .nm { font-weight: var(--es-weight-semibold); font-size: var(--es-fs-13-5); }
.slot .meta { font-size: var(--es-fs-11-5); color: var(--es-muted); }
.slot.right { grid-template-columns: minmax(0, 1fr) var(--es-size-gear-slot); padding: var(--es-space-6) var(--es-space-6) var(--es-space-6) var(--es-space-10); text-align: right; }
.slot.right .icon { order: 2; }
.slot.empty .icon { border-style: dashed; border-color: var(--es-line-strong); }
.slot.empty .nm { color: var(--es-muted); font-weight: var(--es-weight-medium); }
.slot.qc-poor { --qc: var(--es-q-poor); }
.slot.qc-common { --qc: var(--es-line-strong); }
.slot.qc-uncommon { --qc: var(--es-q-uncommon); }
.slot.qc-rare { --qc: var(--es-q-rare); }
.slot.qc-epic { --qc: var(--es-q-epic); }
.slot.qc-legendary { --qc: var(--es-q-legendary); }

@media (max-width: 719px) {
  .gear { flex-direction: row; overflow-x: auto; gap: var(--es-space-8); padding-bottom: var(--es-space-4); }
  .gear .eyebrow { display: none; }
  .slot, .slot.right { grid-template-columns: var(--es-size-gear-slot-phone); padding: 0; background: none; border: 0; flex: none; }
  .slot .icon { width: var(--es-size-gear-slot-phone); height: var(--es-size-gear-slot-phone); order: 0 !important; }
  .slot .txt { display: none; }
}
```
