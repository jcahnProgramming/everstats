# Card maker

Opened from a **Share** button on a character page, guild page, board row or tier panel. Route: `/c/{slug}/share`, `/g/{slug}/share`, `/b/.../share?rank=`, `/c/{slug}/tier/share`. It can also open as a full-screen modal.

## Layout
- **Desktop:** preview (flex 999) on the left, controls (flex 1, min 300px) on the right.
- **Phone:** the preview is on top and the controls follow.
- The preview shows the real rendered PNG from the server. While a new image is generating, the old image stays visible, dimmed, with a "Generating your card…" pill on top.
- Under the preview, a **link preview** row shows the saved wide card and the page URL.

## Controls (top to bottom)
1. **Format:** Square / Story / Wide (`.seg`), with pixel dimensions.
2. **Card theme:** Forever / Alliance / Horde chips (`.tchip`, `role=radio`). Each chip renders in its own theme. Independent of the site theme.
3. **Layout:** A or B (names per type, see `cards/README.md`).
4. **Content** (depends on the card type):
   - Statistics: 1–6, drag to reorder, defaults to the owner's pins. A statistic with no real value is disabled and labelled "Not enough data yet".
   - Guild badges: pinned plus up to 3.
   - Guild totals: up to 4.
   - Board: period and context.
5. **Show** toggles: render, tier, badge, guild, gear strip, recruiting ribbon, tier bar, category letters, distance to next letter.
6. **Accent** (`.swatch`): the five colours from the **card theme's own palette** (`--es-accent`, `--es-c2` … `--es-c5`). There is no free colour picker.

## Actions
- **Download PNG** (primary).
- **Copy image.** Falls back to a toast pointing to Download when the browser blocks clipboard images.
- **Copy link.**
- **Save as my default.** Shown only to the owner, and for guild cards to the GM and officers. It becomes the card for everyone and the link preview. Anyone else sees a note that their choices aren't saved.

## States
- generating
- render unavailable
- character hidden
- not enough data for a statistic
- generation failed, with retry

All are in `../states/`.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `card-maker.css` (only `var(--es-*)`).
