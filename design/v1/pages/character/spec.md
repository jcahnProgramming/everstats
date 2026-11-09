# Character — spec

The main event: character sheet (game-flavoured) followed by statistics (clean, dense).

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Character sheet | `.sheet` frame, 28px padding | Tags: ruleset, faction, guild. Name (first + surname in `--es-accent-2`). “Level · Race · Class · <Guild>”. Freshness line + Refresh + Share. Right: “Overall tier / Top N% / of POP tracked · ruleset / How it’s graded” + large tier badge (S gets glow + pips). |
| Sheet body | 4-col auto-fit grid (min 250px): gear left · render frame · gear right · core stats | Gear: 8 slots per side (Head, Neck, Shoulders, Back, Chest, Shirt, Tabard, Wrist / Hands, Waist, Legs, Feet, Finger, Trinket, Main hand, Off hand — extend with 2nd finger/trinket/ranged as the API provides). Render: transparent full-body PNG. Core stats: key/value list (Health, Mana, primary stats, Armor, crit, Block, Defense — whatever the API returns). |
| Category tiers | auto-fit grid (min 150px) of cards | Each: medium badge + category name + “Top N%” / “Not graded”. Links to that category below. |
| Progress | `.panel.chart` | Statistic picker (user’s choice; default = best-ranked graded stat), range 7d/30d/90d/All, KPIs (today, change, board rank), line chart from daily snapshots. |
| Statistics | Header row (title, count, filter box, Grouped / All-by-rank toggle); 2-col auto-fit grid (min 580px) of category panels; collapsed categories as full-width buttons | Each panel: category header + stat rows (name, value, “#rank of POP”, freshness) + “Show all N →”. Deaths & other bad stats: “not graded” chip, no tier letter (“–”). |

## Behaviour & responsive notes
Phone: sheet stacks (gear becomes two horizontal icon strips above/below the render); stat rows become 2-line; chart hides y-axis. “All, by rank” view = single table sorted by best rank. Loading / not-found / render-not-ready / API-error states: see `../../states/`.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
