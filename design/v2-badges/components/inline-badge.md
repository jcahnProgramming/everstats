# Inline badge

A single 18px badge after a username where space is tight. **At most one badge**: the player's **top featured** badge, which is the first badge in their profile row.

## Where it appears
- **Header account button.** The avatar, `@username`, then the badge (mockup: every v2 page header).
- **"Claimed by @username"** on character pages: `.claimed`.
- **Guild rosters,** in the "Claimed by" column.
- Not shown in leaderboard tables. Too dense; the character name is the subject there, not the account.

## Anatomy
`.name-badge` = `.handle` (Inter 600, ellipsis) + `.bdg.inline` (a `span role="img"`, not interactive; the handle link goes to the profile). Gap 6px. The badge never wraps away from the name.

## States
Inline badges are decorative, so they have no hover, focus or active state of their own. A player with no featured badge shows the handle only.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.name-badge { display: inline-flex; align-items: center; gap: var(--es-space-6); min-width: 0; }
.name-badge .handle { font-weight: var(--es-weight-semibold); color: var(--es-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.claimed { display: inline-flex; align-items: center; gap: var(--es-space-6); font-size: var(--es-fs-12-5); color: var(--es-muted); }
```
