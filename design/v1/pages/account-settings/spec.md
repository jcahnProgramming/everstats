# Account settings — spec

Logged-in only. Theme picker, linked sign-in methods, passkeys, 2FA setup with one-time recovery codes, merge accounts.

Mockup: `index.html` · Screenshots: `screenshots/`

## Regions & data

| Region | Layout | Content / data |
|---|---|---|
| Settings nav (side, ≤260px) | Vertical buttons: Appearance, Sign-in methods, Two-factor, Merge accounts, Sign out | Anchor links / sub-routes. |
| Appearance | 3 theme cards (`role=radio`), each previewing its own tokens; “Signed-in perk” tag; Reduce-motion toggle | Selecting a card applies immediately (try it in the mockup) and saves to the account. |
| Sign-in methods | List box rows: Battle.net (Linked tag + Unlink), Discord (Link), Passkeys (Add + list of devices with last-used + Remove) | Second provider can only be linked here. Unlink requires another method to remain (else disabled with tooltip). |
| Two-factor | Two step cards: 1 Scan (QR, manual key, verify input); 2 Recovery codes **shown once** (10 codes, warning, Download / Copy / Print, “I’ve stored these” checkbox gates Finish) | After finishing, the section shows “2FA on · Regenerate codes · Turn off”. |
| Merge accounts | Keep (this) ← Absorb (other: sign in with Battle.net/Discord to prove ownership) + irreversible note | Confirmation modal: `../../components/modals.md`. |

## Behaviour & responsive notes
Screenshots per theme show the page rendered in that theme (the active card follows the page theme).

## Global frame (every page)
- Top bar = nav option A (see `../../components/nav.md`). Bottom bar with version tag → Changelog (`../../components/bottom-version-bar.md`).
- Container: max-width 1240px (`--es-size-container`), side padding 24px desktop / 16px phone. Page padding top 40px / bottom 96px (phone 16 / 48).
- Background: `--es-bg` + `.mapbg` old-map motif (all three themes; tokens change per theme).
- Breakpoint: phone ≤ 719px. Between 720 and 1440 every grid uses `repeat(auto-fit, minmax(min(<col>, 100%), 1fr))` so it reflows without extra breakpoints.
- Mockup data is placeholder: names “Placeholder Name NN” / “Placeholdername Surname”, guild “Placeholder Guild”, values as repeated digits (99,999 / 88,888 …), dates `[Date]`, levels `[00]`. Replace all with API data.
- Screenshots: `screenshots/{desktop|phone}-{forever|alliance|horde}.png` (1440px and 390px wide, full page). Open `index.html?theme=alliance` (or horde) to switch theme in the mockup.
