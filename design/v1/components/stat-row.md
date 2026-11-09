# Stat row

One statistic inside a category panel: name, value, rank on that statistic’s leaderboard, and data freshness.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.nm` — statistic label (`--es-text-2`); may contain a `.ng` “not graded” chip.
- `.v` — value, Inter 600 16px, tabular figures, right-aligned.
- `.rankpill` — link to the leaderboard: “#N of POP”. Dashed variant `.rankpill.pending` when the board has not opened.
- `.fresh` — dot + age. Green dot ≤ 24 h, amber `.stale`, hollow `.old` = never crawled.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Desktop grid | `minmax(0,1fr) 96px 152px 96px`, gap 12px, padding 10px 18px | row height ≈ 44px |
| Header row `.statrow.head` | padding 8px 18px, eyebrow labels | hidden on phone |
| Phone (≤719px) | 2 columns: name | value on line 1, rank | freshness on line 2; padding 11px 14px | rank pill loses its pill chrome |

## States
| State | Treatment |
|---|---|
| Default | Transparent; 1px `--es-row-sep` bottom border. |
| Hover | Background `--es-raised` at 70% (`.is-hover` in mockups). |
| Focus | Focus ring on the rank-pill link (2px `--es-focus`, offset 2px). |
| Active | Rank pill border turns `--es-accent` on hover/press. |
| Disabled | Board not open yet: `.rankpill.pending` (dashed) reading “– board opens at N”. |
| Loading | `.statrow.is-loading` + `.skel` on each cell; text transparent. |

## Tokens used
- `--es-row-sep`, `--es-raised`, `--es-text-2`, `--es-text`
- `--es-sunken`, `--es-line (rank pill)`, `--es-accent (pill hover)`
- `--es-success / --es-warning / --es-muted (freshness)`
- `--es-space-10/12/18`, `--es-fs-16`, `--es-weight-semibold`

## HTML reference
```html
<div class="statrow">
  <span class="nm">Times camped</span>
  <span class="v">88,888</span>
  <a class="rankpill" href="/leaderboards/normal/times-camped"><b>#22</b> of 9,999</a>
  <span class="fresh"><i></i>00 min ago</span>
</div>
<div class="statrow">
  <span class="nm">Total deaths<span class="ng">not graded</span></span>
  <span class="v">99,999</span>
  <a class="rankpill" href="#"><b>#11</b> of 9,999</a>
  <span class="fresh stale"><i></i>0 days ago</span>
</div>
```

## CSS reference (from components.css)
```css
.statrow { display: grid; grid-template-columns: minmax(0, 1fr) var(--es-space-96) calc(var(--es-space-120) + var(--es-space-32)) var(--es-space-96); gap: var(--es-space-12); align-items: center; padding: var(--es-space-10) var(--es-space-18); border-bottom: var(--es-border-1) solid var(--es-row-sep); color: var(--es-text); text-decoration: none; }
.statrow:last-child { border-bottom: 0; }
.statrow.head { padding-top: var(--es-space-8); padding-bottom: var(--es-space-8); }
.statrow:not(.head):hover, .statrow.is-hover { background: color-mix(in oklab, var(--es-raised) 70%, transparent); }
.statrow .nm { color: var(--es-text-2); min-width: 0; display: flex; align-items: center; gap: var(--es-space-8); flex-wrap: wrap; }
.statrow .v { font: var(--es-weight-semibold) var(--es-fs-16) var(--es-font-body); text-align: right; }
.statrow .ng { font-size: var(--es-fs-11); color: var(--es-muted); border: var(--es-border-1) dashed var(--es-line-strong); border-radius: var(--es-radius-xs); padding: 0 var(--es-space-5); }
.statrow.is-loading .v, .statrow.is-loading .nm { color: transparent; }
.showall { display: flex; align-items: center; min-height: var(--es-size-control); padding: 0 var(--es-space-18); border-top: var(--es-border-1) solid var(--es-line); font-size: var(--es-fs-13); font-weight: var(--es-weight-semibold); text-decoration: none; }

@media (max-width: 719px) {
  .statrow { grid-template-columns: minmax(0, 1fr) auto; gap: var(--es-space-4) var(--es-space-10); padding: var(--es-space-11) var(--es-space-14); }
  .statrow.head { display: none; }
  .statrow .fresh { justify-content: flex-end; }
  .statrow .rankpill { background: none; border: 0; padding: 0; color: var(--es-muted) !important; font-size: var(--es-fs-12); }
}
```
