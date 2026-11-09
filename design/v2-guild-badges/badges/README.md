# Guild badge artwork

All original. The frame is a hanging standard: a three-tailed gonfalon on a crossbar rod. Motifs are simple geometric glyphs. There are no guild crests, tabards, faction crests, game UI or third-party marks.

## Files
- **Levelled badges** have **one file per level**, since metal, gems, numeral, cloth and star all change: `<id>-<level>.svg` for standard/large/xl and `<id>-<level>-inline.svg` for 18px.
- **Badges without levels:** `<id>.svg` and `<id>-inline.svg`.
- **Colours:** `--gc` cloth, `--gm` metal, `--gi` ink, plus `--es-gbadge-*` tokens. The SVGs link `../../../v1/tokens/themes.css` and `../../tokens/guild-badges.css`, so they render in Forever when opened on their own. Keep `v1/`, `v2-badges/` and `v2-guild-badges/` as siblings.

## Templates (`templates/`)
- **deeds-template**: the collective-statistic template. Replace only `data-slot="stat-motif"` with an original glyph, about 20×20, centred at 32,25. The level treatment (metal, gems, plate, V star) is generated from the level, so a new statistic needs a motif and nothing else.
- **partner-guild**: replace only `data-slot="partner-guild-mark"` with the partner guild's emblem (written permission required), inside a 21px circle at 32,25 (inline: 26px at 32,28). The placeholder reads "PG".

## Index
| Badge | Family | Files | How | Proposed thresholds I–V |
|---|---|---|---|---|
| **Muster** | Roster | `roster/muster-1…5.svg` + `-inline` | Tracked members on Everstats. | 10 / 25 / 50 / 100 / 250 tracked members |
| **Every Calling** | Roster | `roster/every-calling-g.svg` + `-inline` | Tracked level 10+ members cover every class. | — |
| **Questers** | Deeds | `deeds/questers-1…5.svg` + `-inline` | Quests completed, combined across current tracked members. | 10k / 50k / 100k / 500k / 1M quests completed |
| **Slayers** | Deeds | `deeds/slayers-1…5.svg` + `-inline` | Creatures killed, combined across current tracked members. | 100k / 500k / 1M / 5M / 10M creatures killed |
| **Campfire** | Deeds | `deeds/campfire-1…5.svg` + `-inline` | Times camped, combined across current tracked members. | 100 / 500 / 1k / 5k / 10k times camped |
| **Fallen Together** | Deeds | `deeds/fallen-together-1…5.svg` + `-inline` | Total deaths, combined across current tracked members. Just for fun — deaths never count toward tiers. | 1k / 5k / 10k / 50k / 100k deaths |
| **Deeds (template)** | Deeds | `templates/deeds-template-1…5.svg` + `-inline` | Combined total of one statistic. | set per statistic |
| **Board Champion** | Standing | `standing/board-champion.svg` + `-inline` | #1 on a guild board (by total or by per-member average). | — |
| **Top Ten** | Standing | `standing/top-ten.svg` + `-inline` | Top 10 on a guild board (by total or by per-member average). | — |
| **Weekly Champion** | Standing | `standing/weekly-champion.svg` + `-inline` | #1 on a weekly guild board this week. Resets at the Tuesday weekly reset. | — |
| **Strong Roster** | Standing | `standing/strong-roster.svg` + `-inline` | Average overall tier of tracked members is A or better. | — |
| **Founding Guild** | Heritage | `heritage/founding-guild.svg` + `-inline` | Tracked on Everstats during the open beta. | — |
| **Early Guild** | Heritage | `heritage/early-guild.svg` + `-inline` | Tracked in the early window after launch. | — |
| **Verified Guild** | Recognition | `recognition/verified-guild.svg` + `-inline` | Has an active Guild Master on Everstats (owns the rank-0 character). | — |
| **Partner Guild** | Recognition | `templates/partner-guild.svg` + `-inline` | Granted by Everstats staff to official community partners. | set per statistic |
| **Featured Guild** | Recognition | `recognition/featured-guild.svg` + `-inline` | Granted by Everstats staff, e.g. for an event. | — |
