# Guild badge popover

Reuses v2's `.bdg-pop` container (320px, raised). The content is guild-specific.

## Content
1. The standard badge, with the held or lost mark where it applies.
2. Name with level: "Muster IV".
3. Eyebrow: **"Guild badge · <Family> · Level IV (Gold)"**. The word "Guild" always appears here, so it can't be confused with a player badge popover.
4. What it took: "Reached 100 tracked members." Badges without levels show how they're earned instead.
5. **Levelled badges:** the next level, its threshold, a small bar, and "222 / 250 · 28 to go". Hidden at V.
6. **Standing badges:** the **board(s)**, e.g. "#1 · Quests completed · total · Normal", then "Held since [Date]" and "Kept while held". When lost: "Lost [Date] · held [Date] – [Date]" and "Returns if regained".
7. A meta line: "Unlocked [Date]" and "Held by N guilds".
8. A "Badge details →" link.

Behaviour matches v2: 300ms hover delay, opens on focus and tap, Esc closes, flips above when there's no room below.

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css

```
