# Wowhead text link

A plain text link, "View item on Wowhead", with the v1 external-link icon. It opens in a new tab with `rel="noopener"`.

- Used **only** when an item has no Blizzard source.
- No logo, no tooltip script, no embedded data. This is the only third-party element.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.wh { display: inline-flex; align-items: center; gap: var(--es-space-4); font-size: var(--es-fs-13); }
.wh svg { width: var(--es-size-icon-xs); height: var(--es-size-icon-xs); stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
```
