# Everstats — v3 share cards (additive to v1, v2-badges, v2-guild-badges)

Share cards are downloadable images made from a character, a guild, a leaderboard placement or a tier. The same templates also produce the **link-preview image** shown when an everstats.app link is pasted into Discord, Reddit or X.

Every card is an advert, so each one carries the Everstats wordmark, the page link, "Data: Blizzard Entertainment" and "as of {date}" in a solid footer band. Text stays legible after the image is shrunk and recompressed.

Keep this folder next to `v1/`, `v2-badges/` and `v2-guild-badges/`. Templates and mockups link into all three.

---

## Card types and layouts

| Card | Content | Layout A | Layout B |
|---|---|---|---|
| **Character** | name, level/race/class, faction, ruleset, guild; render (or crest version); overall tier; pinned badge; 1–6 stats with value and rank; gear strip of Blizzard item icons | Render left | Render centred (tier on the render) |
| **Guild** | name, faction, ruleset, tracked members; pinned guild badge + up to 3 more; up to 4 totals; best guild-board placement; S/A/B/C/D tier bar; optional "RECRUITING" ribbon with the Discord invite as text | Crest left | Centred banner |
| **Leaderboard** | big "#1", statistic, ruleset · period (Overall, This week or Last 30 days), value, character (small render) or guild (guild badge), context rows | Top 3 | Neighbours (ranks either side) |
| **Tier** | big v1 tier shield, name, "Top N% on Ruleset", distance to the next letter (bar), the 10 category letters | Letter left | Letter centred (wide: letter right) |

**Formats:** square 1080×1080 (Discord, Instagram), story 1080×1920, wide 1200×630 (X, Reddit, link preview). That makes 4 types × 3 formats × 2 layouts = **24 templates**.

**Format rules:**

- **Square, layout B (character):** shows the first 3 stats.
- **Wide (character):** shows the first 3 stats and hides the gear strip.
- **Story:** shows all 6 stats.

## Fixed vs customisable

**Fixed on every card:**

- the wordmark and emblem mark
- the page URL as text (shrunk to fit, never cut off)
- "Data: Blizzard Entertainment"
- "as of {date}"
- the gilt frame
- the theme background
- the footer band
- a minimum text size: `--es-card-<format>-foot` (24, 26 or 20px at full size)

**Customisable in the card maker:**

- format
- card theme: Forever, Alliance or Horde, independent of the viewer's site theme
- layout A or B
- content: stats (1–6, defaulting to the owner's pins), guild badges, totals, board period and context
- show/hide toggles: render, tier, badge, guild, gear strip, recruiting ribbon, tier bar, category letters, distance to next letter
- **accent**, chosen only from the card theme's own tokens (`--es-accent`, `--es-c2` to `--es-c5`)

**Saving a default:** the owner, or the Guild Master and officers for guild cards, can **Save as my default**. That becomes the card everyone sees first and the link preview. Nobody else's choices are saved.

**Link-preview defaults** when nothing is saved: wide format, layout A, Forever theme, theme accent, and the owner's pinned stats (or the top-ranked ones).

---

## Index

```
v3-share-cards/
  README.md
  tokens/      cards.css · card-tokens.json     (card sizes, safe margins, per-format type scales, footer floor)
  cards/
    README.md                server render guide, bindings, data shape, link-preview meta tags, font licences
    cards.css                renderer-safe card styles
    fill.js                  data binder (escaped text; SVG only from the server); sets html[data-ready]
    render-example.mjs       reference Playwright renderer
    character/ guild/ board/ tier/   <format>-<a|b>.html  (24 templates, data-slot marked)
    data/                    <type>.example.js (fictional) · board-guild.example.js · schema-summary.json
  examples/                  every type × format × layout × theme (72) + no-render (9) + guild-subject board (6)
                             overview-<type>.png contact sheets
  assets/example-render.png  placeholder standing in for Blizzard's render (mockups only)
  components/  card-maker.css · card-maker.md · share-button.md · toasts.md · gallery/components(-<theme>.png)
  pages/       maker-character/ maker-guild/ maker-board/ maker-tier/    (desktop 1440 + phone 390 × 3 themes)
  states/      generating/ no-render/ hidden-character/ missing-stat/ failed/  (desktop + phone × 3 themes)
```

## Server rendering

- **Renderer:** headless Chromium (Playwright) at exactly the card size, then a screenshot of `[data-card]` once `html[data-ready="1"]` is set. A full sketch is in `cards/render-example.mjs`.
- **CSS:** no backdrop-filter, blend modes or filters on text. Every piece of text sits on a solid panel.
- **Fonts:** Cinzel, Inter and JetBrains Mono are all SIL OFL 1.1, so server-side rendering and embedding in images is unrestricted.
- **Images:** character renders and item icons are Blizzard API images, used under the Developer API terms with the attribution kept on the card.

## Reused from earlier packages

**v1:**

- all `--es-*` tokens, including the theme hero gradient, `.mapbg` old-map motif and accent palette
- the tier shield (`.tier` and its fills, rings and bevels), quality colours and `.tierbar` colours
- the emblem mark and compass ring art
- in the maker: top bar, footer, `.panel`, `.seg`, `.toggle`, `.btn`, `.field` / `.inp`, `.note`, `.toast`, `.split` pattern, focus ring

**v2-badges:**

- player badge SVGs (pinned badge on the character card)
- the inline badge in the header

**v2-guild-badges:**

- guild badge SVGs (pinned + up to 3, leaderboard guild subject) and their level numerals
- guild tokens

**New tokens:**

- `--es-card-{square|story|wide}-{w,h,safe,gap,name,name-sm,meta,stat-val,stat-label,stat-rank,foot,foot-h,hero,tier}`
- `--es-card-radius`, `-border`, `-inner-inset`, `-panel-radius`, `-gem`, `-badge`, `-badge-sm`, `-gear`, `-preview-w`, `-preview-w-phone`, `-thumb`

---

## Added beyond the brief

- **Link-preview row in the maker:** shows exactly what Discord, Reddit and X will display.
- **Guild subject example for the leaderboard card:** `data/board-guild.example.js` plus renders.
- **Crest version:** the no-render card shows an initials monogram in the compass ring, plus race/class.
- **Shrink-to-fit names and URLs** (`data-fit`), so long WoW names never overflow.
- **More toasts:** "Download started", plus a fallback toast when the browser blocks copying images.
- **More visible Share buttons:** the character sheet and guild header get gold Share buttons; board rows get an icon button that names the placement for screen readers.
- **Fixed share routes:** `/c/{slug}/share`, `/g/{slug}/share`, `/b/…/share?rank=`, `/c/{slug}/tier/share`.
- **Caching:** regenerate the link preview when the data snapshot changes, and cache images by snapshot date.

## Left out, or only partly delivered

- **No third layout per type.** The brief allowed 2–3; two are delivered per type.
- **No real character renders or item icons.** Mockups use a placeholder render image and empty quality-bordered slots.
- **Static controls in the maker mockups.** Drag-to-reorder of stats is drawn but not interactive, and theme changes use pre-rendered example images rather than live re-rendering.
- **Clipboard image copy** depends on the browser, so the warning toast covers the fallback.
- **Nothing else from the brief was dropped.** All 4 card types, 3 formats, link-preview behaviour, the card maker from 4 entry points, all 5 states, desktop and 390px mockups, and every card in all 3 themes and formats are present.
