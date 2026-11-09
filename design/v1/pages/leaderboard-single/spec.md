# Single-statistic leaderboard — spec

Dense ranked table for one statistic in one ruleset.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Header | Breadcrumb (Leaderboards / Category / Statistic); title + one-line description; ruleset switcher right | Statistic name + description + whether it counts toward a tier. |
| Main (flex 999 1 580px) | Toolbar: “POP ranked in Ruleset”, freshness, jump-to-character search, faction filter (All/Alliance/Horde). Table: Rank · Character (avatar, name, race/class/level) · Tier · Guild · 7-day movement · Value (sortable). Pagination 20 per page. | When logged in: the viewer’s own characters are tinted rows with a “You” tag — inline if on the page, otherwise appended after a “· · ·” separator row. |
| Side (flex 1 1 300px) | Stacks under main on narrow screens | “Your characters on this board” (logged in only, `.sheet`), “Climbers this week” (top 5 by rank gained: name, ▲n, #from → #to, +value gained), “About this board” key/values. |

## Behaviour & responsive notes
Screenshots show the **logged-in** variant. Logged out: no “Your characters” card, no own rows, top bar shows Sign in. Phone: the table switches to the stacked `.ranklist`; side cards follow the list. Empty board → `states/no-data-yet`; no coverage → `states/no-coverage-here`.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
