# Sign in — two-factor step — spec

Second step after Battle.net/Discord when TOTP 2FA is enabled. Passkey sign-in skips this.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Card | Centred `.sheet`, max 460px | Eyebrow “Step 2 of 2 · <Provider> verified”, title “Two-factor code”, 56px OTP input (6 digits, `autocomplete="one-time-code"`), help text, “Trust this browser for 30 days” checkbox, gold “Verify and sign in”, footer: “← Other method” and “Use a recovery code instead” (swaps input to `XXXX-XXXX` format). |

## Behaviour & responsive notes
Wrong code: input `.is-error` + help “That code didn’t match. Try the newest one.” Five failures → 60 s cooldown message.

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
