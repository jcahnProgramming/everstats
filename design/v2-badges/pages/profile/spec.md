# Public profile — /u/{username}

## Regions

| Region | Content |
|---|---|
| Profile sheet (v1 `.sheet`) | Avatar (initials placeholder, 88px), display name (`.h-display`), `@username · Joined [Date]`, **badge row**, short bio (plain text, ≤160 chars), tags (main ruleset, faction, guild), social handles (fixed platforms, handle only, no free URLs). |
| Pinned stats | v1 stat cards, chosen by the player. |
| Characters | Claimed characters with tier badge, level, race/class, ruleset. |

## Notes
Variants: `?variant=popover` (Dev Team popover open) and `?variant=all` (the "+3 more" All badges dialog). Screenshots: `screenshots/{default|popover-|all-}{desktop|phone}-{theme}.png`. Empty badges: `../../states/empty-profile`.

## Responsive
Phone (≤719px): profile header stacks (avatar 64px); badge row wraps; settings slots become 3×2; cards go single-column; admin sections stack and tables scroll inside their panels.

Mockup `index.html` (`?theme=alliance|horde`). Built on v1: the same top bar (logged in, with the inline badge after the username), bottom bar, `.mapbg`, container and breakpoint. Placeholder data only: "Placeholder Player", `@placeholder_user`, `@example_*`, repeated-digit numbers, `[Date]`.

Screenshots: `screenshots/` — desktop 1440px and phone 390px × Forever / Alliance / Horde.
