# Share button

- **Character sheet** and **guild header:** a `.btn.sm.gold` button with the share icon and the text "Share" or "Share guild card". It replaces v1's ghost Share button on the sheet, because sharing is the growth loop.
- **Board rows:** an icon-only `.btn.ghost.sm.icon` in the last column. It shows on row hover and focus, and is always visible on touch. Its `aria-label` names the placement, e.g. "Share #1 Times camped".
- **Tier panel:** a `.btn.sm` button labelled "Share tier".
- **Hidden characters:** the button isn't rendered at all.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `card-maker.css` (only `var(--es-*)`).
