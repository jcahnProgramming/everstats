# Badge popover / tooltip

Opens from any interactive badge.

## Content, top to bottom
1. The standard badge.
2. Name: Cinzel 700, 17px.
3. Family tag, plus **"✓ Verified"** (`.verified`, `--es-success`) on staff and partner badges, plus a "Time-limited" tag on membership badges.
4. How it was earned, e.g. "Owns a level 10+ Mage." or "Joined during the open beta."
5. A meta line: "Earned [Date]" and "Held by N players". On someone else's profile it reads "Earned [Date]" for that player.
6. A "Badge details →" link.

## Behaviour
- **Opening:** on desktop hover (300ms delay), on keyboard focus, and on tap.
- **Closing:** Esc, clicking outside, or moving focus out.
- `role="dialog"` with an `aria-label`.
- Positioned under the badge (`.anchored`, with an arrow). It flips above if there's no room, and stays clamped 16px inside the viewport on phone.

## Sizes
Width 320px (`--es-size-badge-popover`), padding 16px, gap 12px, `--es-raised` background, `--es-line-strong` border, `--es-shadow-toast` shadow.

## Light panels
`.on-light` (`--es-badge-light-panel`) shows that badges themselves keep working on a light surface, for exports, emails and any future light theme. The popover itself always uses the active theme's raised surface.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.bdg-pop { width: var(--es-size-badge-popover); max-width: calc(100vw - var(--es-space-32)); display: flex; flex-direction: column; gap: var(--es-space-12); padding: var(--es-space-16); background: var(--es-raised); border: var(--es-border-1) solid var(--es-line-strong); border-radius: var(--es-radius-lg); box-shadow: var(--es-shadow-toast); color: var(--es-text); z-index: var(--es-z-dropdown); }
.bdg-pop .hd { display: flex; gap: var(--es-space-12); align-items: center; }
.bdg-pop .nm { font: var(--es-weight-bold) var(--es-fs-17)/var(--es-lh-snug) var(--es-font-display); letter-spacing: var(--es-tracking-heading); }
.bdg-pop .how { font-size: var(--es-fs-13-5); color: var(--es-text-2); }
.bdg-pop .meta { display: flex; justify-content: space-between; gap: var(--es-space-10); font-size: var(--es-fs-12); color: var(--es-muted); border-top: var(--es-border-1) solid var(--es-line); padding-top: var(--es-space-10); }
.bdg-pop.anchored { position: absolute; top: calc(100% + var(--es-space-8)); left: 0; }
.bdg-pop.anchored::before { content: ""; position: absolute; top: calc(var(--es-space-6) * -1); left: var(--es-space-16); width: var(--es-space-10); height: var(--es-space-10); background: var(--es-raised); border-left: var(--es-border-1) solid var(--es-line-strong); border-top: var(--es-border-1) solid var(--es-line-strong); transform: rotate(45deg); }
.verified { display: inline-flex; align-items: center; gap: var(--es-space-4); color: var(--es-success); font: var(--es-weight-semibold) var(--es-fs-11) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; }
.verified svg { width: var(--es-space-14); height: var(--es-space-14); stroke: currentColor; fill: none; stroke-width: 2.6; }
.on-light { background: var(--es-badge-light-panel); color: var(--es-badge-light-panel-text); border: var(--es-border-1) solid var(--es-badge-light-panel-line); border-radius: var(--es-radius-lg); }
.on-light .muted { color: var(--es-badge-light-panel-text); opacity: 0.75; }

@media (max-width: 719px) {
  .bdg-pop.anchored { left: calc(var(--es-space-8) * -1); }
}
```
