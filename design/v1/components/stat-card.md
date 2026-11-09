# Stat card

A single highlighted statistic (headline number + rank + change). Used for featured stats and in the component gallery; the character page uses the same anatomy for the chart KPIs.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Container `.panel.statcard` (or `.sheet.statcard` for the featured/ornate variant).
- `.eyebrow` label.
- `.big` value — Inter 600 28px tabular.
- Footer row: `.rankpill` and either a change (`.up`/`.down`) or a `.tag.gold` (e.g. “Top 5%”).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Padding | 16px all sides, internal gap 6px |  |
| Min column | 150px (`--es-size-col-min-sm`) in an auto-fit grid |  |
| Featured | `.sheet.statcard` spans the full row, badge md + heading |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-surface` panel, `--es-line` border. |
| Hover | When it is a link (`a.statcard`): border `--es-line-strong`, background `--es-raised`. |
| Focus | 2px `--es-focus` outline on the link. |
| Active | Same as hover. |
| Disabled | n/a. |
| Loading | Replace value and footer with `.skel` blocks (28px tall value, 14px line). |

## Tokens used
- `--es-surface`, `--es-line`, `--es-raised`, `--es-line-strong`
- `--es-fs-28`, `--es-lh-snug`, `--es-weight-semibold`
- `--es-success / --es-danger for change`

## HTML reference
```html
<a class="panel statcard" href="#">
  <span class="eyebrow">Creatures killed</span>
  <span class="big">99,999</span>
  <span class="row gap-8"><span class="rankpill"><b>#1</b></span><span class="up xsmall">+9,999 / 7d</span></span>
</a>
```

## CSS reference (from components.css)
```css
.statcard { display: flex; flex-direction: column; gap: var(--es-space-6); padding: var(--es-space-16); }
.statcard .big { font: var(--es-weight-semibold) var(--es-fs-28)/var(--es-lh-snug) var(--es-font-body); font-variant-numeric: tabular-nums; }
```
