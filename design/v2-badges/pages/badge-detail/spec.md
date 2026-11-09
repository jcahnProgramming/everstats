# Badge detail — /badges/{id}

## Regions

| Region | Content |
|---|---|
| Breadcrumb | Profile / Badges / Name. |
| Sheet | xl badge plus the frame name; tags (family, Verified, Time-limited, Automatic/Granted); name (H1); description; status note (earned on [Date] from which character / not earned yet / no longer available); feature toggle when earned; key–values: how it's earned, window (time-limited only), "Held by N players", the badge at all three sizes. |
| Other <family> badges | Siblings, each locked/retired/earned as appropriate, linking to their detail. |

## Notes
Works as a page or as the body of a modal opened from the popover. The mockup shows Mage, earned. Locked: `../../states/locked`. Retired: `../../states/no-longer-available`.

## Responsive
Phone (≤719px): profile header stacks (avatar 64px); badge row wraps; settings slots become 3×2; cards go single-column; admin sections stack and tables scroll inside their panels.

Mockup `index.html` (`?theme=alliance|horde`). Built on v1: the same top bar (logged in, with the inline badge after the username), bottom bar, `.mapbg`, container and breakpoint. Placeholder data only: "Placeholder Player", `@placeholder_user`, `@example_*`, repeated-digit numbers, `[Date]`.

Screenshots: `screenshots/` — desktop 1440px and phone 390px × Forever / Alliance / Horde.
