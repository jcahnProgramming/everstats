# Guild — spec

Simple guild page: identity, tier spread, roster with tiers, best leaderboard placements.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Banner | `.sheet` row: crest placeholder (guild crest art is not available from the API — keep the original placeholder crest) · name, ruleset + faction tags, member counts · “Members by tier” proportional bar (S/A/B/C/D/Unranked) | Counts per tier. |
| Roster (main) | Sort toggle (Tier / Level / Name); table: Member · Tier · Level · Race · class · Best category · Updated (freshness) | All tracked members; 14 shown then “Show all”. |
| On the boards (side) | List of best member placement per board (top 100 only), sorted by rank | Rank, statistic, member, category. |

## Behaviour & responsive notes
Phone: banner stacks; roster table scrolls horizontally inside its panel (acceptable for this secondary page — or reuse `.ranklist` pattern if preferred).

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
