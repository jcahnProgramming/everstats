# Search box

Character lookup (first name + surname) in the top bar, and filter boxes on index/character pages. The home page uses two separate inputs (`First name`, `Surname`) inside a sheet instead.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Leading icon (search 16px, or filter icon for “Filter statistics”).
- `<input>` — inherits font; placeholder `--es-muted`.
- Optional `.kbd` hint “/” (keyboard shortcut to focus).
- Trailing spinner while loading (`.is-loading` adds it via ::after).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Height | 44px |  |
| Padding | 0 12px, gap 8px |  |
| Width | flex 1 1 250px, max 460px (`.full` removes max) |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-sunken` fill, `--es-line` border, radius 6px. |
| Hover | Border `--es-line-strong`. |
| Focus | `:focus-within` — border + 2px outline `--es-focus`, offset 2px. |
| Active | Typing: same as focus. |
| Disabled | `.is-disabled` — 45% opacity. |
| Loading | `.is-loading` — 16px ring spinner (`--es-line-strong` with `--es-accent` arc) at the right. |

## Tokens used
- `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-focus`, `--es-muted`, `--es-text`, `--es-accent`
- `--es-size-control`, `--es-radius-md`

## HTML reference
```html
<label class="search">
  <svg class="ico sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
  <input placeholder="Character name + surname" aria-label="Search characters">
  <span class="kbd">/</span>
</label>
```

## CSS reference (from components.css)
```css
.search { display: flex; align-items: center; gap: var(--es-space-8); height: var(--es-size-control); padding: 0 var(--es-space-12); flex: 1 1 var(--es-size-col-min); max-width: var(--es-size-col-min-xl);
  background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-md); color: var(--es-muted); }
.search:hover { border-color: var(--es-line-strong); }
.search:focus-within { border-color: var(--es-focus); outline: var(--es-border-2) solid var(--es-focus); outline-offset: var(--es-space-2); }
.search input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: var(--es-text); font: inherit; }
.search input::placeholder { color: var(--es-muted); }
.search .kbd { font: var(--es-fs-11) var(--es-font-mono); color: var(--es-muted); border: var(--es-border-1) solid var(--es-line-strong); border-radius: var(--es-radius-xs); padding: 0 var(--es-space-4); }
.search.is-loading::after { content: ""; width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); border-radius: var(--es-radius-round); border: var(--es-border-2) solid var(--es-line-strong); border-top-color: var(--es-accent); animation: es-spin var(--es-motion-spin) linear infinite; }
.search.is-disabled { opacity: var(--es-opacity-disabled); }
.search.full { max-width: none; }
.skel, .spin, .search.is-loading::after, .btn.is-loading::after { animation: none; }

@media (max-width: 719px) {
  .topbar .navlinks, .topbar .search, .topbar .signin { display: none; }
}
```
