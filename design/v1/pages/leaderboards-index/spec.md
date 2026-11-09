# Leaderboards index — spec

Pick a ruleset, browse categories, see the top 3 of many boards at a glance.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Header | Title; row: ruleset switcher (`.lg`) + population line (“POP tracked characters · grading open · crawled daily 06:00 UTC”); row: statistic search + category jump tags (name + board count) | Population and grading status per ruleset; grading status reads “Unranked — grading opens at N” when below minimum. |
| Category sections | Ornament heading (name, “N boards · graded/not graded”, “All boards →”) + auto-fit grid (min 270px) of mini boards | Mini board: title, “N ranked”, top 3 rows, “Full board →”. Two special cards: **No data yet** (dashed box) and **No coverage** (hatched, crossed-circle) — must look different. |

## Behaviour & responsive notes
Ruleset choice is kept in the URL (`/leaderboards?ruleset=pvp`) and remembered per visitor (localStorage).

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
