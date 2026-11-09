# Badge row

The row of featured badges under the display name on a public profile.

## Rules
- Shows up to **6** featured badges (`--es-badge-row-max`), in the player's chosen order.
- **Staff and partner badges always come first** and can't be moved behind other badges. If a player has more than 6 pinned badges, the pinned ones fill the row.
- If the player has more than they feature, a `.bdg-more` pill reading "+N more" opens the **All badges** dialog: a v1 `.modal` grid of every earned badge with names, featured ones marked. Mockup: `pages/profile/?variant=all`.
- Each badge is a button. Selecting one opens its popover (`badge-popover.md`). Mockup: `pages/profile/?variant=popover`.
- **No badges at all: render nothing.** No empty box, no heading (`states/empty-profile`).

## Sizes
Standard 44px badges, gap 10px, wraps on narrow screens. The "+N more" pill is 44px tall with min-width 44px, a dashed `--es-line-strong` border and a `--es-sunken` fill.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.bdg-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--es-space-10); }
.bdg-more { display: inline-flex; align-items: center; justify-content: center; min-width: var(--es-size-badge); height: var(--es-size-badge); padding: 0 var(--es-space-12); border-radius: var(--es-radius-pill); background: var(--es-sunken); border: var(--es-border-1) dashed var(--es-line-strong); color: var(--es-text-2); font: var(--es-weight-semibold) var(--es-fs-13) var(--es-font-body); cursor: pointer; }
.bdg-more:hover { border-color: var(--es-accent); color: var(--es-text); }
```
