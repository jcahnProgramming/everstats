# Badge

One badge, as a `<button>` (opens the popover) wherever it's interactive, or a `<span role="img">` where it's decoration (inline next to names, inside the popover itself).

## Anatomy
- `.bdg.<size>` wrapper. Sizes: `.inline` 18px, `.std` 44px, `.lg` 112px, `.xl` 128px (detail page).
- An inline `<svg viewBox="-3 -3 70 70">`. Copy it from `badges/<family>/<id>.svg`, or `<id>-inline.svg` for `.inline`. The SVG sets its own colours on its root with `style="--bf:…; --bm:…; --bi:…; --bf2:…"`.
- Drawing layers, back to front:
  1. rim: `--es-badge-rim`, a dark outer stroke, so the badge reads on light panels
  2. body: `--bf`
  3. Envoy only: the second half, `--bf2`
  4. metal ring: `--bm`, so the badge reads on dark panels
  5. inset line: standard and large only
  6. motif: `--bi`
- Optional `.state-ico`: a lock (locked) or clock (no longer available) in the corner. Hidden at inline size.

## Sizes
| Size | px | Token | Drawing | Used for |
|---|---|---|---|---|
| inline | 18 | `--es-size-badge-inline` | `*-inline.svg` (simplified: thicker strokes, no inset, motif reduced to its silhouette) | Next to usernames: header, Claimed by, rosters |
| standard | 44 | `--es-size-badge` | `*.svg` | Profile row, settings cards, popover, toast |
| large | 112 | `--es-size-badge-lg` | `*.svg` | Detail page, admin preview |
| xl | 128 | `--es-size-badge-xl` | `*.svg` | Detail page hero |

The 16–20px brief range is met with 18px. The inline drawings are made to read at 16–20px.

## States
| State | Treatment |
|---|---|
| Default (earned) | Full colour. |
| Hover | SVG lifts 1px with `brightness(1.08)`. Buttons and links only. |
| Focus | v1 focus ring: 2px `--es-focus`, offset 2px, radius 6px. |
| Active | No lift, `brightness(0.96)`. |
| New | `.is-new`: soft `--es-badge-new` drop-shadow glow plus an 8px dot top-right, ringed in `--es-bg`. Cards add a `.newtag` "New" chip. Cleared once the popover or detail page has been opened. |
| Locked (earnable) | `.is-locked`: colours swap to `--es-badge-locked-fill/metal/ink` (greyed silhouette, motif still faintly visible) plus a lock `.state-ico`. Still a button that opens the detail page. There is no separate "disabled" badge. |
| No longer available | `.is-retired`: the locked colours at 70% opacity plus a clock `.state-ico`, always next to the text "No longer available · <window>". |
| Loading | `.is-loading`: the SVG is hidden and a shimmering rounded block is shown (v1 `es-shimmer`). |

## Accessibility
- `aria-label="<Name> badge"`, plus " (not earned)", " (no longer available)" or " (new)" where relevant.
- Buttons get `aria-haspopup="dialog"`.
- The meaning never depends on colour. Frame shape gives the family, the motif gives the meaning, and every surface that shows a badge also shows its name: popover, card, detail page, toast.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.bdg { position: relative; display: inline-grid; place-items: center; flex: none; padding: 0; margin: 0; border: 0; background: none; color: inherit; cursor: pointer; border-radius: var(--es-radius-md); vertical-align: middle; text-decoration: none; }
.bdg svg { width: 100%; height: 100%; display: block; overflow: visible; transition: transform var(--es-motion-fast) var(--es-motion-ease), filter var(--es-motion-fast); }
.bdg.inline { width: var(--es-size-badge-inline); height: var(--es-size-badge-inline); border-radius: var(--es-radius-xs); }
.bdg.std { width: var(--es-size-badge); height: var(--es-size-badge); }
.bdg.lg { width: var(--es-size-badge-lg); height: var(--es-size-badge-lg); }
.bdg.xl { width: var(--es-size-badge-xl); height: var(--es-size-badge-xl); }
button.bdg:hover svg, a.bdg:hover svg, .bdg.is-hover svg { transform: translateY(calc(var(--es-border-1) * -1)); filter: brightness(1.08); }
button.bdg:active svg, a.bdg:active svg, .bdg.is-active svg { transform: none; filter: brightness(0.96); }
.bdg.is-focus { outline: var(--es-border-2) solid var(--es-focus); outline-offset: var(--es-space-2); }
.bdg.is-new svg { filter: drop-shadow(0 0 var(--es-space-6) color-mix(in oklab, var(--es-badge-new) 70%, transparent)); }
.bdg.is-new::after { content: ""; position: absolute; top: 0; right: 0; width: var(--es-size-badge-pip); height: var(--es-size-badge-pip); border-radius: var(--es-radius-round); background: var(--es-badge-new); box-shadow: 0 0 0 var(--es-border-2) var(--es-bg); }
.bdg.lg.is-new::after, .bdg.xl.is-new::after { width: var(--es-space-14); height: var(--es-space-14); top: var(--es-space-6); right: var(--es-space-6); }
.newtag { display: inline-flex; align-items: center; padding: var(--es-space-3) var(--es-space-6); border-radius: var(--es-radius-pill); background: var(--es-badge-new); color: var(--es-accent-ink); font: var(--es-weight-bold) var(--es-fs-10)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; }
.bdg.is-locked svg, .bdg.is-retired svg {
  --bf: var(--es-badge-locked-fill) !important; --bf2: var(--es-badge-locked-fill) !important;
  --bm: var(--es-badge-locked-metal) !important; --bi: var(--es-badge-locked-ink) !important; }
.bdg.is-retired svg { opacity: 0.7; }
.bdg .state-ico { position: absolute; right: calc(var(--es-space-4) * -1); bottom: calc(var(--es-space-2) * -1); width: 40%; height: 40%; min-width: var(--es-space-16); min-height: var(--es-space-16); border-radius: var(--es-radius-round); background: var(--es-raised); border: var(--es-border-1) solid var(--es-line-strong); display: grid; place-items: center; color: var(--es-muted); }
.bdg .state-ico svg { width: 60%; height: 60%; stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.bdg.inline .state-ico { display: none; }
.bdg.is-loading { background: none; }
.bdg.is-loading svg { visibility: hidden; }
.bdg.is-loading::before { content: ""; position: absolute; inset: 8%; border-radius: var(--es-radius-md); background: linear-gradient(90deg, var(--es-raised) 0%, color-mix(in oklab, var(--es-raised) 55%, var(--es-line-strong)) 50%, var(--es-raised) 100%); background-size: 200% 100%; animation: es-shimmer var(--es-motion-shimmer) linear infinite; }
.toast.badge-toast .bdg { margin: calc(var(--es-space-4) * -1) 0; }
```
