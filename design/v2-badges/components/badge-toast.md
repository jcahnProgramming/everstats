# "Badge earned" toast

A variant of the v1 toast. The standard badge, shown with the "new" glow, replaces the gem.

## Variants
- **Earned**, `.ok`: "Badge earned: <Name>", how it was earned, and a "View badge" link.
- **Granted**, default: "Badge granted: <Name>", "Granted by Everstats staff."
- **Removed**, `.warn`, for badges kept only while held such as S-Tier: "<Name> badge removed", the reason, and that it comes back automatically.

## Behaviour
- Same placement, stacking and dismissal as v1 toasts: bottom-right on desktop, full width on phone, `role="status"`.
- Auto-dismiss after 8s, longer than v1's 5s because the player will want to look at it.
- Several badges earned at once, for example on first import: show one toast reading "You earned N badges" with a link to Settings → Badges, not N separate toasts.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.toast.badge-toast { align-items: center; }
.toast.badge-toast .bdg { margin: calc(var(--es-space-4) * -1) 0; }
```
