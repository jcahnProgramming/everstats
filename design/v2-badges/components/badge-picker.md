# Badge picker (Settings → Badges)

Where the player chooses and orders their featured badges.

## Parts
- **Featured slots** (`.slots`): 6 slots of 64px each, numbered.
  - Filled slots hold a standard badge and can be dragged.
  - Pinned slots (staff and partner) show a pin icon, have a gold-tinted border, and can't be dragged.
  - Empty slots are dashed.
  - **Drag states:** `.dragging` (lifted, rotated −3°, focus-coloured border) and `.drop` (dashed focus border on the target).
  - **Keyboard:** focus a slot, Space to pick it up, arrow keys to move, Space to drop, Esc to cancel. Announce moves with `aria-live`.
  - **Phone:** 3 columns × 2 rows.
- **"Where your top badge shows"** preview row: the inline badge in the header and in "Claimed by".
- **Earned** (`.bcards` of `.bcard`): each card has the badge, name, family (plus "Verified"), "Earned [Date]" and a v1 toggle labelled **Feature**.
  - Pinned cards show a "Pinned" tag instead of the toggle.
  - Featured cards have a gold-tinted border.
  - Turning on a 7th shows an inline note: "You can feature up to 6. Turn one off first."
- **Badges you can earn** (`.bcard.locked`): a locked badge plus how to earn it. Shows automatic badges only; staff and partner badges are granted, so they're never listed as earnable.
- **No longer available:** retired badges whose window has closed. They are **never** shown in the earnable list.

## Sizes
- Cards: grid with min column 270px, gap 10px, padding 10px 12px, radius 8px.
- Card layout: badge 44px | text | control.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.slots { display: grid; grid-template-columns: repeat(6, minmax(0, var(--es-size-badge-slot))); gap: var(--es-space-12); }
.slot-b { position: relative; aspect-ratio: 1; border-radius: var(--es-radius-lg); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line-strong); display: grid; place-items: center; cursor: grab; }
.slot-b.empty { border-style: dashed; cursor: default; color: var(--es-muted); font: var(--es-fs-11) var(--es-font-mono); }
.slot-b.pinned { cursor: default; border-color: color-mix(in oklab, var(--es-accent) 55%, var(--es-line)); }
.slot-b.dragging { border-color: var(--es-focus); box-shadow: var(--es-shadow-toast); transform: rotate(-3deg); }
.slot-b.drop { border: var(--es-border-2) dashed var(--es-focus); background: color-mix(in oklab, var(--es-focus) 10%, var(--es-sunken)); }
.slot-b .n { position: absolute; top: var(--es-space-3); left: var(--es-space-5); font: var(--es-weight-semibold) var(--es-fs-10) var(--es-font-mono); color: var(--es-muted); }
.slot-b .pin { position: absolute; top: var(--es-space-3); right: var(--es-space-3); color: var(--es-accent); }
.slot-b .pin svg { width: var(--es-space-12); height: var(--es-space-12); stroke: currentColor; fill: none; stroke-width: 2.4; }
.bcards { display: grid; gap: var(--es-space-10); grid-template-columns: repeat(auto-fill, minmax(min(var(--es-size-col-min-md), 100%), 1fr)); }
.bcard { display: grid; grid-template-columns: var(--es-size-badge) minmax(0, 1fr) auto; gap: var(--es-space-12); align-items: center; padding: var(--es-space-10) var(--es-space-12); background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); }
.bcard.is-featured { border-color: color-mix(in oklab, var(--es-accent) 60%, var(--es-line)); }
.bcard .nm { font-weight: var(--es-weight-semibold); }
.bcard .sub { font-size: var(--es-fs-12); color: var(--es-muted); }
.bcard.locked { background: transparent; border-style: dashed; }
.bcard.locked .nm { color: var(--es-text-2); }
.fam { font-size: var(--es-fs-11); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; color: var(--es-muted); font-weight: var(--es-weight-semibold); }

@media (max-width: 719px) {
  .slots { grid-template-columns: repeat(3, minmax(0, var(--es-size-badge-slot))); }
}
```
