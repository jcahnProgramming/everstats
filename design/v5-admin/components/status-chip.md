# Status chip

Icon plus text plus colour, always all three.

| Variant | Use |
|---|---|
| `ok` | check |
| `warn` | triangle |
| `err` | cross |
| `off` | dashed, minus |
| `info` | dot |
| `run` | spinner |
| `vis` | "Visible to players", eye |
| `scope` | version scope, globe |

On phones chips can wrap to two lines.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.chip { display: inline-flex; align-items: center; gap: var(--es-space-5); height: var(--es-space-22); padding: 0 var(--es-space-8); border-radius: var(--es-radius-pill); border: var(--es-border-1) solid var(--es-line-strong); color: var(--es-text-2); background: var(--es-sunken); font: var(--es-weight-semibold) var(--es-fs-11-5)/var(--es-lh-none) var(--es-font-body); white-space: nowrap; }
.chip svg { width: var(--es-size-icon-xs); height: var(--es-size-icon-xs); stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.chip.ok { color: var(--es-success); border-color: color-mix(in oklab, var(--es-success) 50%, var(--es-line)); }
.chip.warn { color: var(--es-warning); border-color: color-mix(in oklab, var(--es-warning) 50%, var(--es-line)); }
.chip.err { color: var(--es-danger); border-color: color-mix(in oklab, var(--es-danger) 50%, var(--es-line)); }
.chip.info { color: var(--es-accent-2); border-color: color-mix(in oklab, var(--es-accent) 45%, var(--es-line)); }
.chip.off { color: var(--es-muted); border-style: dashed; background: none; }
.chip.run svg { animation: es-spin var(--es-motion-spin) linear infinite; }
.chip.vis { color: var(--es-text); border-color: color-mix(in oklab, var(--es-adm-player-visible) 55%, var(--es-line)); }
.chip.vis svg { stroke: var(--es-adm-player-visible); }
.chip.scope { background: none; color: var(--es-muted); font-weight: var(--es-weight-medium); }
```
