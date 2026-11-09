# Settings → Badges

## Regions

| Region | Content |
|---|---|
| Settings nav (v1) | Adds a **Badges** item between Two-factor and Merge accounts. |
| Featured on your profile | 6 drag-sortable slots, pinned staff/partner first, keyboard help, "where your top badge shows" preview. |
| Earned | Every earned badge as a card with a Feature toggle (pinned ones show "Pinned"). |
| Badges you can earn | Locked automatic badges with how to earn each. |
| No longer available | Retired time-limited badges with their closed window. |

## Notes
New badge: `../../states/new`. New player: `../../states/empty-settings`.

## Responsive
Phone (≤719px): profile header stacks (avatar 64px); badge row wraps; settings slots become 3×2; cards go single-column; admin sections stack and tables scroll inside their panels.

Mockup `index.html` (`?theme=alliance|horde`). Built on v1: the same top bar (logged in, with the inline badge after the username), bottom bar, `.mapbg`, container and breakpoint. Placeholder data only: "Placeholder Player", `@placeholder_user`, `@example_*`, repeated-digit numbers, `[Date]`.

Screenshots: `screenshots/` — desktop 1440px and phone 390px × Forever / Alliance / Horde.
