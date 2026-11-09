# Admin → Badges (owner only)

## Regions

| Region | Content |
|---|---|
| Account | Find by @username; account summary; badge table with Revoke on manual badges. |
| Grant a badge | Manual-badge select, required reason (error state shown), notify checkbox, Grant. |
| Partner mark | Partner, dropzone, three-theme preview at three sizes, confirmation checkbox, Save. |
| Log | Append-only history of grants, revokes and mark updates. |

## Notes
See `../../components/admin-grant-form.md`.

## Responsive
Phone (≤719px): profile header stacks (avatar 64px); badge row wraps; settings slots become 3×2; cards go single-column; admin sections stack and tables scroll inside their panels.

Mockup `index.html` (`?theme=alliance|horde`). Built on v1: the same top bar (logged in, with the inline badge after the username), bottom bar, `.mapbg`, container and breakpoint. Placeholder data only: "Placeholder Player", `@placeholder_user`, `@example_*`, repeated-digit numbers, `[Date]`.

Screenshots: `screenshots/` — desktop 1440px and phone 390px × Forever / Alliance / Horde.
