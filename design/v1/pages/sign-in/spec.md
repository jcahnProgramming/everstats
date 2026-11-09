# Sign in — spec

Choose Battle.net, Discord or passkey.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Card | Centred `.sheet`, max 460px, padding 36/32px | Emblem mark, “Sign in”, optional-account explainer. Buttons (lg, 52px): Continue with Battle.net (“imports characters”), Continue with Discord, divider “or”, gold “Sign in with a passkey”, helper “Passkeys are added from Account settings after your first sign-in.” |
| Variant: passkey waiting | Same card | Spinner, “Waiting for your passkey”, “No code needed — passkeys skip two-factor”, Cancel. Screenshots `screenshots/passkey-waiting-*.png` (`?variant=passkey`). |

## Behaviour & responsive notes
Provider icons are deliberately generic (no Battle.net or Discord logos are included in this package). If you later add official provider marks, follow each brand’s guidelines. Not configured → `states/sign-in-not-configured`.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
