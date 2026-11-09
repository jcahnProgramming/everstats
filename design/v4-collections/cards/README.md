# Collections share card

This card type follows the same contract as `../../v3-share-cards/cards/README.md`:

1. Inject `window.CARD_DATA`.
2. Render at the card size.
3. Wait for `html[data-ready="1"]`.
4. Screenshot `[data-card]`.

The bindings come from v3's `fill.js`, which is loaded from the v3 folder.

## Files

- **Templates:** `collections/square.html` (1080×1080), `collections/story.html` (1080×1920), `collections/wide.html` (1200×630, also the link preview for `/c/{slug}/collections`).
- **Example wiring:** `collections/*-no-catalog.html` uses the same template with `data/collections-no-catalog.example.js`.
- **Styles:** `collections-card.css`. It extends v3 `cards.css` with the same renderer-safe rules.

## Data (fictional examples in `data/`)

- **Common:** `theme`, `accent`, `url`, `asof`, `first`, `last`, `meta`, `faction`, `ruleset`, `guild`
- **`transmog`:** `{big, sub, w}`
  - with the catalog: `big: "19%"`, `sub: "412 / 2,140 appearances"`, `w: 19`
  - without it: `big: "412"`, `sub: "appearances collected"`, `w: null` (no bar)
- **`counts[≤6]`:** `{label, value, cls}`. `cls: "acct"` shows the account glyph.
- **`showcase[≤6]`:** `{name, q, icon, glyph}`
  - `icon` is the Blizzard media URL.
  - `q` is a quality class: `q-epic`, `q-rare`, …
  - `glyph` is a server-generated placeholder SVG, used only when no icon exists.
- **`show`:** `{transmog, guild, acct}`. `acct` shows the "Shared across this account" key whenever any count is account-wide.

## Layout per format

| Format | Layout |
|---|---|
| Square | identity + transmog box, 3×2 counts, a row of 6 showcase tiles with names |
| Story | one column, 2×3 counts, 3×2 showcase |
| Wide | identity + transmog on the left, counts + an icon strip (no names) on the right |
