# Changelog — spec

Release notes, newest first. Reached **only** from the version tag in the bottom bar.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Header | Narrow container (860px) | Eyebrow, title, one-line description. |
| Timeline | `ol.timeline`: diamond rail + article per release: version (mono 22px), tag (Next / Skeleton / …), date, groups (Added / Changed / Fixed) with bullet lists | Starts at 0.1.0 (skeleton); “Unreleased” on top with a hollow diamond. 1.0.0 reserved for the public launch. |

## Behaviour & responsive notes
Render from `CHANGELOG.md` in the repo.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
