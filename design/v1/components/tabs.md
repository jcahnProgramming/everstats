# Tabs

Underline tabs for switching views within a page section (WAI-ARIA tabs pattern). Not used for the ruleset — that is the segmented ruleset switcher.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.tabs[role=tablist]` with bottom border.
- Each `button[role=tab]` — Inter 600 14px, optional `.count`.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Tab height | 44px, padding 0 16px |  |
| Underline | 2px inset shadow |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-text-2`, no underline. |
| Hover | `--es-text` + `--es-line-strong` underline. |
| Focus | Focus ring on the tab; arrow keys move between tabs. |
| Active (selected) | `aria-selected="true"` → `--es-text` + `--es-accent` underline. |
| Disabled | `--es-muted`, no underline, not-allowed. |
| Loading | Tab panel shows skeletons; tabs stay interactive. |

## Tokens used
- `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-accent`
- `--es-size-control`, `--es-border-2`

## HTML reference
```html
<div class="tabs" role="tablist" aria-label="Character views">
  <button role="tab" aria-selected="true">Overview</button>
  <button role="tab" aria-selected="false">Statistics <span class="count">000</span></button>
  <button role="tab" disabled>Compare</button>
</div>
```

## CSS reference (from components.css)
```css
.tabs { display: flex; gap: var(--es-space-4); border-bottom: var(--es-border-1) solid var(--es-line); overflow-x: auto; }
.tabs [role="tab"] { display: inline-flex; align-items: center; gap: var(--es-space-6); min-height: var(--es-size-control); padding: 0 var(--es-space-16); background: none; border: 0; color: var(--es-text-2); font: var(--es-weight-semibold) var(--es-fs-14) var(--es-font-body); cursor: pointer; white-space: nowrap; box-shadow: inset 0 calc(var(--es-border-2) * -1) 0 transparent; }
.tabs [role="tab"]:hover, .tabs .is-hover { color: var(--es-text); box-shadow: inset 0 calc(var(--es-border-2) * -1) 0 var(--es-line-strong); }
.tabs [aria-selected="true"] { color: var(--es-text); box-shadow: inset 0 calc(var(--es-border-2) * -1) 0 var(--es-accent); }
.tabs [role="tab"][disabled] { color: var(--es-muted); cursor: not-allowed; box-shadow: none; }
.tabs .count { font-size: var(--es-fs-12); color: var(--es-muted); font-weight: var(--es-weight-medium); }
```
