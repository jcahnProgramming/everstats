# Category header

Top of a statistics category panel: medium tier badge, category name, summary line, and a link/collapse control. Collapsed categories render as a full-width `button.cathead`.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.tier.md` (or `.sm` when collapsed).
- `.title` — `h3` Cinzel 700 18px + summary (`Top 15% · 34 statistics`, or `Not graded · leaderboards only`).
- Spacer, then “All boards” link or a chevron icon button (aria-expanded).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Padding | 14px 18px (phone 12px 14px), gap 14px |  |
| Collapsed button | min-height 56px, radius 8px, 1px border |  |

## States
| State | Treatment |
|---|---|
| Default | Background `--es-raised` at 60%, bottom border `--es-line`. |
| Hover | Collapsed button: border `--es-line-strong`. |
| Focus | Focus ring on the button / link. |
| Active | Expanded: chevron-up, `aria-expanded="true"`. |
| Disabled | n/a. |
| Loading | Badge `.is-loading`, title and summary as `.skel` lines. |

## Tokens used
- `--es-raised`, `--es-line`, `--es-line-strong`
- `--es-font-display`, `--es-fs-18`, `--es-tracking-heading`

## HTML reference
```html
<div class="cathead">
  <span class="tier md a" role="img" aria-label="Tier A"><b aria-hidden="true">A</b></span>
  <div class="title"><h3>Combat</h3><span class="muted xsmall">Top 15% · 34 statistics</span></div>
  <span class="spacer"></span>
  <a class="xsmall" href="#">All boards</a>
</div>

<button class="cathead is-collapsed" aria-expanded="false">…<svg class="ico sm">chevron-down</svg></button>
```

## CSS reference (from components.css)
```css
.cathead { display: flex; align-items: center; gap: var(--es-space-14); flex-wrap: wrap; padding: var(--es-space-14) var(--es-space-18); border-bottom: var(--es-border-1) solid var(--es-line); background: color-mix(in oklab, var(--es-raised) 60%, transparent); }
.cathead .title { display: flex; flex-direction: column; gap: var(--es-space-2); }
.cathead h3 { font: var(--es-weight-bold) var(--es-fs-18) var(--es-font-display); letter-spacing: var(--es-tracking-heading); }
.cathead.is-collapsed { border-bottom: 0; }
button.cathead { width: 100%; text-align: left; color: var(--es-text); font: inherit; cursor: pointer; border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); min-height: var(--es-size-control-xl); }
button.cathead:hover { border-color: var(--es-line-strong); }

@media (max-width: 719px) {
  .cathead { padding: var(--es-space-12) var(--es-space-14); }
}
```
