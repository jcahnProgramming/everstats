# Chart container

Progress chart for one chosen statistic, from daily snapshots. Header (title + statistic picker + range), KPI row, then the plot (y-axis labels + SVG area + x-axis labels). Single series uses `--es-c1`; comparisons use c1…c5 in order.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Header row: `h2`, `.seg` statistic picker (scrolls on phone), spacer, `.seg` range (7d/30d/90d/All).
- `.kpis` — today’s value (`.big` 32px), change (`.mid` 20px, `.up`/`.down`), board rank.
- `.plot` — `.yaxis` (3 labels, 64px column) + SVG `.area` (240px tall, `preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`).
- `.series` line 2.5px, `.series-fill` area at 12% opacity, `.grid-line` hairlines.
- Hover: dashed `.cursor` line, `.dot` marker, `.tip` tooltip (value + date).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Padding | 22px 24px (phone 14px) |  |
| Plot height | 240px (phone 120px; y-axis hidden on phone) |  |
| Tooltip | padding 6px 10px, radius 6px |  |

## States
| State | Treatment |
|---|---|
| Default | Line + area for the selected range. |
| Hover | Cursor line + dot + tooltip at nearest snapshot. |
| Focus | Plot is focusable; ←/→ step through snapshots and move the tooltip. |
| Active | Selected statistic/range segments pressed. |
| Disabled | Fewer than 2 snapshots: replace plot with an `.empty-box` “Not enough history yet — check back after tomorrow’s snapshot”. |
| Loading | KPI values `.skel`; plot area `.skel` block 240px. |

## Tokens used
- `--es-c1 … --es-c5`, `--es-line`, `--es-line-strong`, `--es-bg`, `--es-raised`, `--es-muted`
- `--es-size-chart-h`, `--es-size-chart-h-phone`, `--es-size-chart-axis-w`, `--es-shadow-toast`

## HTML reference
```html
<section class="panel chart">
  <div class="kpis">…</div>
  <div class="plot">
    <div class="yaxis"><span>max</span><span>mid</span><span>min</span></div>
    <div class="stack gap-6">
      <svg class="area" viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label="Hugs given, last 30 days">
        <path class="grid-line" d="M0 0.5H1000M0 120H1000M0 239.5H1000" vector-effect="non-scaling-stroke"/>
        <polygon class="series-fill" points="0,240 … 1000,240"/>
        <polyline class="series" points="…" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="xaxis"><span>[Date −30]</span><span>[Today]</span></div>
    </div>
  </div>
</section>
```

## CSS reference (from components.css)
```css
.chart { display: flex; flex-direction: column; gap: var(--es-space-18); padding: var(--es-space-22) var(--es-space-24); }
.chart .plot { display: grid; grid-template-columns: var(--es-size-chart-axis-w) minmax(0, 1fr); gap: var(--es-space-8); }
.chart .yaxis { display: flex; flex-direction: column; justify-content: space-between; text-align: right; height: var(--es-size-chart-h); font-size: var(--es-fs-11-5); color: var(--es-muted); font-variant-numeric: tabular-nums; }
.chart svg.area { width: 100%; height: var(--es-size-chart-h); display: block; }
.chart .grid-line { stroke: var(--es-line); stroke-width: 1; fill: none; }
.chart .series { fill: none; stroke: var(--es-c1); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.chart .series-fill { fill: var(--es-c1); opacity: 0.12; }
.chart .xaxis { display: flex; justify-content: space-between; font-size: var(--es-fs-11-5); color: var(--es-muted); }
.chart .kpis { display: flex; gap: var(--es-space-32); flex-wrap: wrap; align-items: baseline; }
.chart .kpi { display: flex; flex-direction: column; gap: var(--es-space-2); }
.chart .kpi .big { font-size: var(--es-fs-32); font-weight: var(--es-weight-semibold); font-variant-numeric: tabular-nums; }
.chart .kpi .mid { font-size: var(--es-fs-20); font-weight: var(--es-weight-semibold); font-variant-numeric: tabular-nums; }
.chart .tip { position: absolute; padding: var(--es-space-6) var(--es-space-10); background: var(--es-raised); border: var(--es-border-1) solid var(--es-line-strong); border-radius: var(--es-radius-md); font-size: var(--es-fs-12); box-shadow: var(--es-shadow-toast); white-space: nowrap; }
.chart .cursor { stroke: var(--es-line-strong); stroke-dasharray: 3 3; }
.chart .dot { fill: var(--es-c1); stroke: var(--es-bg); stroke-width: 2; }

@media (max-width: 719px) {
  .chart { padding: var(--es-space-14); }
  .chart .plot { grid-template-columns: minmax(0, 1fr); }
  .chart .yaxis { display: none; }
  .chart svg.area { height: var(--es-size-chart-h-phone); }
}
```
