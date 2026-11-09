# Buttons

Four variants: **gold** (primary — one per view), **default** (secondary), **ghost** (tertiary / icon buttons), **danger** (destructive). Sizes sm / default / lg, plus `.icon` (square) and `.block` (full width).

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Optional leading icon (16–20px).
- Label — Inter 600 14px (13px for `.sm`).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Default | min-height 44px, padding 0 18px, radius 6px, gap 8px |  |
| Small `.sm` | min-height 34px, padding 0 12px, 13px | desktop toolbars only — use default on phone |
| Large `.lg` | min-height 52px, padding 0 16px | sign-in providers |
| Icon `.icon` | 44 × 44px, no padding | always add aria-label |

## States
| State | Treatment |
|---|---|
| Default | gold: `--es-gold-fill` gradient, `--es-accent-ink` text · default: `--es-raised` + `--es-line-strong` border · ghost: transparent · danger: transparent, `--es-danger` text. |
| Hover | Border → `--es-accent` (gold: brightness 1.06; ghost: `--es-raised` fill; danger: border `--es-danger`). |
| Focus | 2px `--es-focus` outline, 2px offset (`:focus-visible`). |
| Active | translateY(1px); default gets `--es-surface`, gold gets flat `--es-accent`. |
| Disabled | `[disabled]` — opacity `--es-opacity-disabled` (0.45), not-allowed cursor. |
| Loading | `.is-loading` — label hidden (transparent), centred 16px spinner; pointer-events none; keep width. |

## Tokens used
- `--es-gold-fill`, `--es-accent`, `--es-accent-2`, `--es-accent-ink`
- `--es-raised`, `--es-surface`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-danger`, `--es-focus`
- `--es-size-control`, `--es-size-control-sm`, `--es-size-control-lg`, `--es-radius-md`, `--es-motion-fast`, `--es-opacity-disabled`

## HTML reference
```html
<button class="btn gold">Open character sheet</button>
<button class="btn">Refresh</button>
<button class="btn ghost icon" aria-label="Menu"><svg class="ico md" …/></button>
<button class="btn danger sm">Unlink</button>
<button class="btn gold is-loading" aria-busy="true">Merge</button>
```

## CSS reference (from components.css)
```css
.btn.nav-icon { display: none; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--es-space-8); min-height: var(--es-size-control); padding: 0 var(--es-space-18);
  border-radius: var(--es-radius-md); border: var(--es-border-1) solid var(--es-line-strong); background: var(--es-raised); color: var(--es-text) !important;
  font: var(--es-weight-semibold) var(--es-fs-14)/var(--es-lh-none) var(--es-font-body); text-decoration: none; white-space: nowrap; cursor: pointer;
  transition: border-color var(--es-motion-fast) var(--es-motion-ease), background var(--es-motion-fast) var(--es-motion-ease), transform var(--es-motion-fast); }
.btn:hover, .btn.is-hover { border-color: var(--es-accent); }
.btn:active, .btn.is-active { transform: translateY(var(--es-border-1)); background: var(--es-surface); }
.btn.gold { background: var(--es-gold-fill); border-color: var(--es-accent); color: var(--es-accent-ink) !important; }
.btn.gold:hover, .btn.gold.is-hover { filter: brightness(1.06); }
.btn.gold:active, .btn.gold.is-active { background: var(--es-accent); }
.btn.ghost { background: transparent; border-color: transparent; color: var(--es-text-2) !important; }
.btn.ghost:hover, .btn.ghost.is-hover { background: var(--es-raised); color: var(--es-text) !important; }
.btn.danger { background: transparent; color: var(--es-danger) !important; border-color: color-mix(in oklab, var(--es-danger) 45%, var(--es-line)); }
.btn.danger:hover, .btn.danger.is-hover { border-color: var(--es-danger); }
.btn.sm { min-height: var(--es-size-control-sm); padding: 0 var(--es-space-12); font-size: var(--es-fs-13); }
.btn.lg { min-height: var(--es-size-control-lg); padding: 0 var(--es-space-16); }
.btn.block { width: 100%; }
.btn.left { justify-content: flex-start; }
.btn.icon { padding: 0; min-width: var(--es-size-control); }
.btn[disabled], .btn.is-disabled { opacity: var(--es-opacity-disabled); cursor: not-allowed; transform: none; filter: none; }
.btn.is-loading { color: transparent !important; position: relative; pointer-events: none; }
.btn.is-loading::after { content: ""; position: absolute; width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); border-radius: var(--es-radius-round); border: var(--es-border-2) solid currentColor; border-color: var(--es-line-strong); border-top-color: var(--es-text); animation: es-spin var(--es-motion-spin) linear infinite; }
.btn.gold.is-loading::after { border-color: color-mix(in oklab, var(--es-accent-ink) 30%, transparent); border-top-color: var(--es-accent-ink); }
.skel, .spin, .search.is-loading::after, .btn.is-loading::after { animation: none; }

@media (max-width: 719px) {
  .btn.nav-icon { display: inline-flex; }
}
```
