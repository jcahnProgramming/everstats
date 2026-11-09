# Unlocked ribbon

A small tag in `--es-gbadge-ribbon` hanging off the top-right of a pill: "UNLOCKED [DATE]".

## Rules
- Shown to **everyone** for **7 days** after the unlock (`--es-gbadge-ribbon-days`).
- Only when the badge is shown on the guild page.
- One ribbon per pill, for its newest level.
- Text: Inter 700 at 10px, uppercase, `--es-gbadge-ribbon-ink`, at least 4.5:1 contrast.

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.ribbon { position: absolute; top: calc(var(--es-space-10) * -1); right: calc(var(--es-space-6) * -1); padding: var(--es-space-2) var(--es-space-6); border-radius: var(--es-radius-xs); background: var(--es-gbadge-ribbon); color: var(--es-gbadge-ribbon-ink); font: var(--es-weight-bold) var(--es-fs-10)/var(--es-lh-snug) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; box-shadow: var(--es-shadow-raise); }
```
