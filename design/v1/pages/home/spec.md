# Home — spec

Logged-out landing: character search, short pitch, featured leaderboards.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Hero | 2-col auto-fit grid (min col 460px, gap 48px), 88px top padding | Left: eyebrow “World of Warcraft: Forever · US realms”, hero headline, lead pitch, search sheet (First name + Surname inputs, gold “Open character sheet”, helper “Characters appear from level 10, after their first log-out.”). Right (hidden on phone): emblem SVG (420px) with a floating “Overall tier” card. |
| Pillars | 3-col auto-fit (min 250px) | Three roman-numeral points: hundreds of statistics · a board for each one · daily snapshots kept. Static copy. |
| Featured leaderboards | Ornament heading + ruleset switcher; 4-col auto-fit grid of mini boards (min 250px) | Each mini board: statistic name, “N ranked”, top 5 (rank, name, value), “Full board →”. Data: top 5 of 4 curated statistics for the selected ruleset. |

## Behaviour & responsive notes
Search submits to `/c/{first}-{surname}` (lookup). Empty field submit = inline error on the input. Ruleset switcher here is local to the featured block.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
