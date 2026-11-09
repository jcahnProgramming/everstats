# Everstats design system — v1 handoff

Visual system for **everstats.app**, the WoW: Forever character-stats and leaderboard site. Direction: **"Cartographer's Ledger."** The character page reads like a gilt-framed character sheet laid over a twilight map. Leaderboards and statistic tables drop the ornament and go dense.

This package is meant to be **complete**: every colour, size, spacing value, radius, font and state is in these files. **No value should need to be read off a screenshot.** If a value seems to be missing, it's a bug in this package, not something to guess.

---

## How to use it (Claude Code)

1. **Load order on every page:**
   - `assets/fonts/fonts.css`
   - `tokens/themes.css`
   - `components/components.css` (or port its rules into your component CSS)
2. **Themes:**
   - Forever is the `:root` default.
   - Set `data-theme="alliance"` or `data-theme="horde"` on `<html>` to switch.
   - Only logged-in users can choose another theme. Logged-out visitors always get Forever.
3. **Tokens:**
   - Every token is a CSS custom property prefixed `--es-`. `tokens/tokens.json` holds the same values in DTCG format.
   - **Never hard-code a colour, spacing or radius.** Use the token.
   - The one exception is the phone breakpoint, `@media (max-width: 719px)`, because CSS media queries can't read custom properties.
4. **Build order:** port one page at a time from `pages/<page>/`. For each page:
   - `index.html` is the mockup.
   - `spec.md` gives regions, data and responsive rules.
   - `screenshots/` is the visual target.
5. **Component reference:** each `components/*.md` contains:
   - anatomy
   - every state
   - sizes
   - the tokens used
   - an HTML snippet
   - the exact CSS rules copied verbatim from `components.css`
6. **States:** the `states/` folders say which pages each state appears on.
7. **Mockup theme switch:** open any mockup with `?theme=alliance` or `?theme=horde`. The sign-in page also accepts `?variant=passkey`.

---

## Chosen navigation: Option A — Ledger Bar

One top row:

- emblem mark + "Everstats" wordmark
- Leaderboards and Guilds (plus Admin for the owner)
- character search
- Sign in, or Account when logged in

On phone this collapses to two icon buttons (search and menu).

**Why A:**

- **Search is the front door.** Most visits are "look up this character," so the search box is visible on every page at desktop width.
- **Ruleset belongs to the board, not the site.** A character has exactly one ruleset, so a site-wide ruleset switcher (option C) would either do nothing on character and guild pages or confuse people. The ruleset switcher sits on the leaderboard pages, where it changes something.
- **The site only has a few sections.** With 2–3 of them, a side rail (option B) wastes horizontal space that the dense tables need.

Options B (Atlas Rail) and C (Ruleset Banner) are kept for reference in `components/gallery/navigation-options.html` and `navigation-options-<theme>.png`.

---

## Index

```
v1/
  README.md                     this file
  tokens/
    tokens.json                 all tokens, DTCG format: themes.{forever,alliance,horde}.color + shared + composite
    themes.css                  same tokens as --es-* custom properties; :root = Forever, [data-theme] blocks
    typography.md               families, weights, sizes, line heights, tracking, tabular figures, licensing
    contrast.md                 (extra) measured WCAG contrast for every text/ground and tier pair, all themes
  components/
    components.css              (extra) the shared stylesheet the mockups use — only var(--es-*) values
    tier-badge.md  stat-row.md  stat-card.md  ranked-table-row.md  category-header.md  search-box.md
    nav.md  bottom-version-bar.md  buttons.md  inputs.md  toggles.md  tabs.md  ruleset-switcher.md
    character-render-frame.md  gear-slot.md  chart-container.md  toasts.md  modals.md
    gallery/
      components.html + components-{forever,alliance,horde}.png      every component in every state
      tier-badges.html + tier-badges.png                             S/A/B/C/D/unranked at all 3 sizes, 3 themes side by side
      navigation-options.html + navigation-options-<theme>.png       options A (chosen), B, C
  pages/  (each: index.html, spec.md, screenshots/{desktop,phone}-{forever,alliance,horde}.png)
    home/  character/  leaderboards-index/  leaderboard-single/  guild/
    sign-in/  (+ screenshots/passkey-waiting-*.png)  sign-in-2fa/  account-settings/  admin/  changelog/
  states/  (each: index.html, README.md with "appears on", {desktop,phone}-{forever,alliance,horde}.png)
    loading/  character-not-found/  render-not-ready/  unranked/  no-data-yet/  no-coverage-here/
    api-unavailable/  sign-in-not-configured/
  assets/
    emblem/emblem.svg           round compass-rose emblem with "E" (original)
    emblem/mark.svg             small brand mark for the top bar / favicon
    emblem/compass-ring.svg     ring motif behind the character render
    textures/old-map-tile.svg   tileable old-map texture (graticule + contour rings); CSS twin = .mapbg
    illustrations/render-placeholder.svg      silhouette shown until a real render exists (mockup only)
    illustrations/guild-crest-placeholder.svg generic guild crest (no game crest is available)
    illustrations/spinner.svg
    icons/*.svg                 35 original 24×24 stroke icons (currentColor)
    fonts/                      Cinzel, Inter, JetBrains Mono woff2 (SIL OFL 1.1) + fonts.css + licence texts
    preview/assets.html + assets-<theme>.png  contact sheet of all artwork and icons
```

Standalone SVG files link `tokens/themes.css` through `<?xml-stylesheet?>`, so they render in Forever colours when opened directly. When inlined in a page they follow the page theme. Icons use `currentColor`.

---

## Conventions

- **Placeholder data only.** Nothing in the mockups is real:
  - names: "Placeholdername Surname" and "Placeholder Name 01…20"
  - guild: "Placeholder Guild"
  - values: repeated-digit numbers (99,999 / 88,888 / …)
  - levels, races, classes and dates in brackets (`[00]`, `[Race]`, `[Date]`)
  - masked keys: `XXXX`
  - recovery codes: `XXXX-XXXX`

  Statistic labels such as "Times camped" or "Total deaths" are example labels, not data.
- **Lint result:**
  - No hex, RGB or HSL colour value appears anywhere outside `tokens/`.
  - No `px` literal appears in any mockup HTML or CSS outside `tokens/`, apart from the one media query.
  - Numbers inside SVG `viewBox` and path coordinates are drawing units, not CSS spacing.
- **Accessibility built in:**
  - real `<button>`, `<a>` and `<label>` elements
  - 44px minimum touch targets on phone
  - `aria-current` on the current nav item, `aria-pressed` on segmented controls, `aria-sort` on sortable table headers
  - tier badges carry `role="img"` and `aria-label="Tier S"` (or "Unranked")
  - a 2px `--es-focus` ring everywhere
  - `prefers-reduced-motion` stops the shimmer and spinners
- **Screenshots** are full-page, taken at 1× device scale: 1440px desktop and 390px phone, Chromium.

---

## Added beyond the original brief

- **Toasts and modals.** Designed so that async actions (refresh, copy, save) and destructive actions (unlink, merge, remove passkey, rotate key) have feedback and a confirmation step.
- **Toggle and tabs components.** Requested in this export but not in the original brief. A Reduce-motion toggle sits in Account › Appearance.
- **Statistic and filter UI:**
  - a statistic filter box and a "Grouped / All, by rank" toggle on the character page
  - a statistic search and category jump tags on the leaderboards index
- **Leaderboard extras:**
  - a faction filter (All / Alliance / Horde)
  - a jump-to-character search
  - pagination (20 per page)
  - an "About this board" card
  - "· · ·" separator rows appending your own characters when they're off-page
- **Character page details:**
  - a "not graded" chip on statistics that have boards but don't count toward tiers (deaths etc.)
  - freshness states: fresh, stale, never crawled
  - a dashed "board opens at N" rank pill
- **Guild page details:**
  - a "Members by tier" proportional bar
  - a "Best category" column
- **Sign-in and 2FA details:**
  - a passkey "waiting for your passkey" step
  - a "Use a recovery code instead" link
  - a "Trust this browser for 30 days" checkbox
  - copy for wrong codes and the cooldown, in the spec
- **Account settings details:**
  - Download / Copy / Print and "I've stored these" gating for recovery codes
  - a "Regenerate codes" follow-up, in the spec
- **Admin:** per-ruleset progress toward the minimum population, crawler tiles (API budget, lookup queue, 24h errors) and a recent-runs table.
- **Home:** three short "pillars" under the hero.
- **Extra docs:** `tokens/contrast.md` and `components/components.css`, which aren't in the requested folder structure but which Claude Code will want.
- **Spec behaviours I proposed, not from the brief — confirm or drop:**
  - remembering the visitor's last ruleset
  - a 60-second cooldown after five wrong 2FA codes
  - unlink disabled when it's your last sign-in method
  - the chart's "not enough history" empty state

## Changed from the canvas version

Four tier/accent colours were adjusted so every tier letter reaches ≥ 7:1 against its fill (Forever A and D fills, Horde D fill, Horde accent/c1). Old → new values are listed in `tokens/contrast.md`. The canvas's realistic-looking sample names and numbers were replaced with the placeholders described above.

## Left out, or only partly delivered

- **No real game art.** There is no real character render, item icon or guild crest. Renders and icons come from Blizzard's API at runtime, and the brief bans game assets, so the package ships original placeholders and frames for them.
- **No Battle.net or Discord logos.** Sign-in buttons use generic original icons plus the provider's name. If you add the official marks later, follow each brand's guidelines.
- **Hardcore** appears only as a disabled "Hardcore · soon" segment. There are no Hardcore-specific layouts.
- **Guild roster on phone** scrolls sideways inside its panel. It doesn't get the stacked list the leaderboard has; the spec notes the `.ranklist` pattern can be reused.
- **No real QR code.** The 2FA QR is a labelled placeholder box; generate the real one at runtime.
- **Tooltips** (gear item tooltip, chart hover) are specified: the chart tooltip is drawn in the gallery and the gear tooltip is described in `gear-slot.md`. There is no separate item-tooltip mockup.
- **No light theme.** The brief asked for exactly three themes, all dark.
- **Nothing else from the brief was dropped.** All 9 pages (sign-in split into choose + 2FA, making 10 folders), all 8 states, all 18 components, three navigation options, three themes and phone layouts are present, with phone screenshots for every page.
