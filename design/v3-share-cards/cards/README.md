# Card templates (server-renderable)

`cards/<type>/<format>-<layout>.html` contains 4 types × 3 formats × 2 layouts = **24 templates**.

| Type | Layout A | Layout B |
|---|---|---|
| character | Render left | Render centred (tier on the render) |
| guild | Crest left | Centred banner |
| board | Top 3 context | Neighbours context (ranks either side) |
| tier | Letter left | Letter centred (wide: letter right) |

Each template is the same markup for its type. The root class picks the format and layout (`fmt-square|story|wide`, `v-a|v-b`), and every size comes from `../tokens/cards.css`.

## How a server renders a card
1. Load the template in headless Chromium with the viewport set to the card size: square 1080×1080, story 1080×1920, wide 1200×630, `deviceScaleFactor: 1`.
2. Replace `../data/<type>.example.js` with `window.CARD_DATA = {…}`. `render-example.mjs` does this with a route.
3. Wait for `html[data-ready="1"]`. `fill.js` sets it once data is bound, images have loaded, fonts are ready and long names are shrunk to fit.
4. Screenshot `[data-card]` as PNG.

Query overrides are for previews only: `?theme=forever|alliance|horde`, `?accent=accent|c2|c3|c4|c5`, `?norender=1`.

## Bindings (full list in `fill.js`)
`data-slot` (text, always escaped) · `data-slot-src` · `data-slot-html` (trusted, server-generated badge SVG only, **never user text**) · `data-if` / `data-if-not` · `data-class` · `data-slot-width` · `data-repeat` + `data-item` with `data-f`, `data-f-html`, `data-f-class`, `data-f-width`, `data-f-src` · `data-fit` (shrink-to-fit, floor 55%).

## Data (see `data/*.example.js`; all example values are fictional)
**Common to every type:** `theme`, `accent` (one of the theme's own tokens: `accent`, `c2` … `c5`), `url` (shown as text, e.g. `everstats.app/c/<slug>`), `asof` (snapshot date).

- **character**
  - identity: `first`, `last`, `initials`, `meta` (level · race · class), `faction`, `ruleset`, `guild`
  - `render`: a Blizzard render URL, or `null` for the crest version
  - `tier {letter, cls, pct}`, `badge {svg, name}`
  - `stats[1–6] {label, value, rank}`
  - `gear[] {q, icon}`: Blizzard item icon URLs, quality classes `q-epic|q-rare|q-uncommon|q-legendary|q-common`
  - `show {tier, badge, guild, gear}`
- **guild**
  - identity: `name`, `faction`, `ruleset`, `members`, `pinned_svg`
  - `badges[≤4] {svg, name, lv, cls:'pinned'}`, `totals[≤4] {label, value}`
  - `place {rank, stat, scope}`
  - `tiers[] {k, w (percent), t}`
  - `discord` (as set on the guild page), `show {recruiting}`
- **board**
  - placement: `rank`, `rank_cls` (`r1|r2|r3|rn`), `stat`, `scope` (ruleset · period), `value`, `unit`
  - subject: `subject`, `sub`, and either `render` or `subject_svg` (guild subject, see `data/board-guild.example.js`)
  - context: `top3[]`, `neighbours[] {rank, name, value, cls:'me'}`
- **tier**
  - identity: `first`, `last`, `meta`, `faction`, `ruleset`
  - `tier {letter, cls}`, `pct`
  - `next {show, text, sub, w}`
  - `cats[10] {name, L, cls}`, `show {cats}`

## Fixed on every card
- the Everstats wordmark and emblem mark
- the page URL as text
- "Data: Blizzard Entertainment"
- "as of {date}"
- the gilt frame
- the theme background

These live in a solid footer band (`--es-sunken`), at no less than `--es-card-<format>-foot` size: 24, 26 or 20px at full size. They stay readable when Discord or X shrink the image to about half.

## Renderer-safe CSS
- No backdrop-filter, blend modes or filters on text, and no web components.
- Gradients, clip-path (the tier shield), transforms and `color-mix()` are used. All of these are supported by current headless Chromium.
- If you render with something other than Chromium, check `color-mix()` and `clip-path` support.

## Fonts
Cinzel, Inter and JetBrains Mono are all under the **SIL Open Font License 1.1**. Server-side rendering and embedding in images is allowed, with no limit on use. The files are in `../../v1/assets/fonts/`.

## Images from Blizzard
- **Character renders and item icons** come from Blizzard's API. Use them under the Blizzard Developer API terms, and keep "Data: Blizzard Entertainment" on the card.
- **Hidden characters** produce no card and no preview.
- **No render** (`render: null`) shows the crest monogram version. It's never empty.

## Link previews
For `/c/{slug}`, `/g/{slug}` and `/b/...` pages, serve the saved wide card:

```html
<meta property="og:image" content="https://everstats.app/og/c/{slug}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

- **Which settings:** the owner's saved default, or, for guild cards, the GM's or an officer's. Otherwise the defaults are layout A, the Forever theme, the theme accent, and the owner's pinned stats (or the top-ranked stats).
- **Regenerate:** whenever the data snapshot changes, and cache by snapshot date (the "as of" date).
- **Hidden characters:** the link serves the plain Everstats preview instead.
