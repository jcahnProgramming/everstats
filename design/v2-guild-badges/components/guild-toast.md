# Guild badge toast

A v1 toast with a guild badge in place of the gem.

## When it shows
**Only to the GM and officers**, the next time they view the guild page or Manage after the event.

## Variants
- **Unlocked** (`.ok`): "Guild badge unlocked: Muster IV", what happened, and a "Manage badges" link.
- **Lost** (`.warn`): "Top Ten lost", which board, and that it returns automatically if regained.

## Rules
- Several unlocks since the last visit collapse into one toast: "N guild badges unlocked".
- Public visitors never see toasts. They see the 7-day **Unlocked** ribbon instead (`unlocked-ribbon.md`).

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.toast.gbadge-toast { align-items: center; }
```
