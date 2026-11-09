# Next unlocks (progress strip)

The "rally your guildies" moment: 2–3 cards showing the badges **closest to their next level**, measured by percentage complete.

## Card anatomy
- The next level's badge in the **in progress** state.
- Name, numeral, level name (Iron, Bronze, Silver, Gold or Forever) and the measure.
- A progress bar (`.gprog`, fill `--es-gbadge-progress`).
- "**222 / 250** tracked members" on the left and "28 to go" on the right.

## Rally line
A **Copy sign-up link** button (`.btn.gold.sm`): every guildie who signs in with Battle.net is tracked, which moves Muster and the Deeds totals. This button is beyond the brief. Leave room here for the post-1.0 Discord webhook.

## Rules
- Pick the 3 levelled badges with the highest percentage toward their next level. Never pick a level that's already maxed.
- Shown to everyone, including logged-out visitors, on every guild page, and it stays even when the guild has no badges yet.
- Grid: auto-fit with a minimum card width of 300px (`--es-size-gbadge-unlock-card`).

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.unlocks { display: grid; gap: var(--es-space-14); grid-template-columns: repeat(auto-fit, minmax(min(var(--es-size-gbadge-unlock-card), 100%), 1fr)); }
.ucard { display: grid; grid-template-columns: var(--es-size-badge) minmax(0, 1fr); gap: var(--es-space-6) var(--es-space-14); align-items: center; padding: var(--es-space-14) var(--es-space-16); background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); }
.ucard .gbdg { grid-row: span 2; }
.ucard .ttl { display: flex; align-items: baseline; gap: var(--es-space-6); flex-wrap: wrap; }
.ucard .ttl b { font-weight: var(--es-weight-semibold); }
.ucard .ttl .lvl { font-family: var(--es-font-display); font-weight: var(--es-weight-black); color: var(--es-accent-2); }
.ucard .bar, .gprog { grid-column: 1 / -1; }
.gprog { height: var(--es-size-bar-h); border-radius: var(--es-radius-pill); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); overflow: hidden; }
.gprog > span { display: block; height: 100%; background: var(--es-gbadge-progress); }
.gprog.sm { height: var(--es-size-bar-h-sm); }
.ucard .nums { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: var(--es-space-10); font-size: var(--es-fs-12); color: var(--es-muted); font-variant-numeric: tabular-nums; }
.ucard .nums b { color: var(--es-text); font-weight: var(--es-weight-semibold); }
.rally { display: flex; align-items: center; gap: var(--es-space-12); flex-wrap: wrap; }
```
