# Admin — spec

Owner only. API key manager, minimum population for grading, crawler status.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| API keys | Table: Key (label + env name) · Value (masked, last 4) · Set on · Last test (freshness dot) · Actions (Test / Set / Rotate + Replace) | Values are write-only; never re-displayed. “Not set” row shows the dependent feature that is disabled. |
| Grading | Number input “Minimum tracked characters per ruleset” + Save; per-ruleset row: name, progress bar toward minimum, count, status tag (Grading / Unranked / Not live) | Drives the Unranked state everywhere. |
| Crawler | Status tag, Pause / Run now; 4 stat tiles (this run progress, lookup queue, API budget, errors 24h); progress bar; recent runs table | Live from the crawler. |

## Behaviour & responsive notes
Admin link appears in the top bar only for the owner account.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
