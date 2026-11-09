# Guild page — big guild (/g/{slug})

## Regions
Header (v1 guild sheet + Verified status mark + Discord invite and up to 5 labelled links) · **Guild badges** row (6 pills, pinned first, held markers, one Unlocked ribbon, “+4 more”) · **Next unlocks** (3 cards + Copy sign-up link) · v1 roster (shortened; “Claimed by” shows player inline badges).

## Notes
Variants: `?variant=popover` (Board Champion popover: boards + held since) and `?variant=all` (all shown badges dialog). GM view adds a “Manage badges” button (`../../states/new`).

## Responsive
Phone (≤719px): header stacks; pills wrap; Next unlocks become one column; Manage rows go two-line; tables scroll in their panels.

Mockup `index.html` (`?theme=alliance|horde`), built on v1 (top bar, guild sheet, roster, toasts, modal, `.mapbg`) and v2-badges (popover container, player inline badges in the header and roster). Fictional data only: “The Placeholder Company”, “Order of Example”, “Unclaimed Example Guild”, “Example Guild NN”, repeated-digit numbers, `[Date]`.

Screenshots: `screenshots/` — desktop 1440px and phone 390px × Forever / Alliance / Horde.
