# Ruleset switcher

Segmented control choosing Normal / PvP / Roleplay / Roleplay PvP, with Hardcore shown disabled (“soon”). The same `.seg` component is reused for small view toggles (Grouped / All, 7d/30d/90d, faction filter, roster sort). Ruleset is per-board context (nav option A), so it sits on leaderboard pages, not in the top bar.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.seg[role=group]` track with 3px padding.
- `button[aria-pressed]` segments.
- Disabled Hardcore segment with a `.soon` micro-label.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Segment | min-height 38px (44px on phone; `.lg` 44px), padding 0 14px (16px lg), radius 6px |  |
| Track | padding 3px, gap 2px, radius 8px |  |
| Phone | `.phone-scroll` — single row, horizontal scroll |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-text-2` on transparent. |
| Hover | `--es-text`, background `--es-raised` at 60%. |
| Focus | 2px focus ring on the segment. |
| Active (selected) | `aria-pressed="true"` → `--es-raised` fill, `--es-text`, 1px `--es-line-strong` ring. |
| Disabled | `[disabled]` — `--es-muted`, not-allowed (Hardcore until launched). |
| Loading | Keep selection; the board below shows skeleton rows. |

## Tokens used
- `--es-sunken`, `--es-line`, `--es-raised`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`
- `--es-size-control-md`, `--es-size-control`, `--es-radius-lg`, `--es-radius-md`, `--es-tracking-tag`

## HTML reference
```html
<div class="seg phone-scroll" role="group" aria-label="Ruleset">
  <button aria-pressed="true">Normal</button>
  <button aria-pressed="false">PvP</button>
  <button aria-pressed="false">Roleplay</button>
  <button aria-pressed="false">Roleplay PvP</button>
  <button disabled>Hardcore <span class="soon">soon</span></button>
</div>
```

## CSS reference (from components.css)
```css
.seg { display: inline-flex; flex-wrap: wrap; gap: var(--es-space-2); padding: var(--es-space-3); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); }
.seg button { min-height: var(--es-size-control-md); padding: 0 var(--es-space-14); border: 0; border-radius: var(--es-radius-md); background: none; color: var(--es-text-2); font: var(--es-weight-medium) var(--es-fs-13) var(--es-font-body); cursor: pointer; display: inline-flex; align-items: center; gap: var(--es-space-6); white-space: nowrap; }
.seg button:hover, .seg .is-hover { color: var(--es-text); background: color-mix(in oklab, var(--es-raised) 60%, transparent); }
.seg [aria-pressed="true"], .seg [aria-checked="true"] { background: var(--es-raised); color: var(--es-text); box-shadow: 0 0 0 var(--es-border-1) var(--es-line-strong); }
.seg button[disabled] { color: var(--es-muted); cursor: not-allowed; background: none; }
.seg .soon { font-size: var(--es-fs-11); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; color: var(--es-muted); }
.seg.lg button { min-height: var(--es-size-control); padding: 0 var(--es-space-16); font-size: var(--es-fs-14); }
.seg.scroll { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; }

@media (max-width: 719px) {
  .seg { max-width: 100%; }
  .seg button { min-height: var(--es-size-control); }
  .seg.phone-scroll { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; }
}
```
