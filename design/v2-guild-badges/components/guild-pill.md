# Guild badge pill

Wherever there's room, a guild badge is shown as a **pill**: icon + badge name + level numeral, e.g. "[icon] Muster IV". Badges are icon-only only on dense guild boards. There the name appears in the aria-label and in the popover on hover, focus or tap.

## Variants
- **Standard pill**: 36px tall (`--es-size-gbadge-pill`), 28px icon, Inter 600 at 13px, numeral in Cinzel 800 `--es-accent-2`.
- **Small pill** `.sm`: 26px tall, 18px icon, 12px text. Used on the /guilds list and in Manage.
- **Pinned** `.pinned`: gold-tinted border plus a pin icon. The pinned badge leads the row and is the one shown next to the guild's name on boards and lists.
- **Held:** a green hourglass + "HELD" after the name.
- **Lost / locked / no longer available:** transparent background with a dashed border. Lost also reads "Lost [Date]".
- **New:** a glow ring plus the `.ribbon`.

## Row (`.grow`) on the guild page
- Up to **6** pills (`--es-gbadge-row-max`), with the pinned badge first.
- "+N more" (`.gmore`) opens a dialog with every shown badge.
- A guild with nothing to show renders **no row at all**: no heading, no empty box. Only "Next unlocks" remains.

## Verified Guild: a status mark, not a pill
Verified Guild is proposed as a **status mark** beside the guild name (`.gverified`: the inline badge plus "Verified"). It appears in the header, the /guilds list and on boards, and doesn't take one of the 6 slots. It is still listed among the guild's badges under Recognition, so the family stays complete.

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.gpill { position: relative; display: inline-flex; align-items: center; gap: var(--es-space-8); height: var(--es-size-gbadge-pill); padding: 0 var(--es-space-14) 0 var(--es-space-4); border-radius: var(--es-radius-pill); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line-strong); color: var(--es-text); font: var(--es-weight-semibold) var(--es-fs-13)/var(--es-lh-none) var(--es-font-body); white-space: nowrap; cursor: pointer; text-decoration: none; }
.gpill:hover, .gpill.is-hover { border-color: var(--es-accent); }
.gpill .lvl { font-family: var(--es-font-display); font-weight: var(--es-weight-black); color: var(--es-accent-2); letter-spacing: var(--es-tracking-display); }
.gpill .pin { color: var(--es-accent); display: inline-flex; }
.gpill .pin svg, .gpill .held svg { width: var(--es-space-12); height: var(--es-space-12); fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.gpill .held { display: inline-flex; align-items: center; gap: var(--es-space-3); color: var(--es-gbadge-held); font-size: var(--es-fs-11); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; }
.gpill.pinned { border-color: color-mix(in oklab, var(--es-accent) 60%, var(--es-line)); }
.gpill.is-new { box-shadow: 0 0 0 var(--es-border-2) color-mix(in oklab, var(--es-badge-new) 55%, transparent), 0 0 var(--es-space-14) color-mix(in oklab, var(--es-badge-new) 35%, transparent); }
.gpill.is-lost, .gpill.is-locked, .gpill.is-retired { background: transparent; border-style: dashed; color: var(--es-text-2); }
.gpill.sm { height: var(--es-size-gbadge-pill-sm); gap: var(--es-space-6); padding: 0 var(--es-space-10) 0 var(--es-space-3); font-size: var(--es-fs-12); }
.gpill.sm .gbdg { width: var(--es-size-gbadge-pill-icon-sm); height: var(--es-size-gbadge-pill-icon-sm); }
.grow { display: flex; flex-wrap: wrap; gap: var(--es-space-10); align-items: center; }
.gmore { display: inline-flex; align-items: center; height: var(--es-size-gbadge-pill); padding: 0 var(--es-space-14); border-radius: var(--es-radius-pill); border: var(--es-border-1) dashed var(--es-line-strong); background: transparent; color: var(--es-text-2); font: var(--es-weight-semibold) var(--es-fs-13) var(--es-font-body); cursor: pointer; }
.gmore:hover { border-color: var(--es-accent); color: var(--es-text); }
.gverified { display: inline-flex; align-items: center; gap: var(--es-space-4); vertical-align: middle; color: var(--es-success); font: var(--es-weight-semibold) var(--es-fs-11) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; }
.gverified .gbdg.inline { width: var(--es-space-22); height: var(--es-space-22); }
.gname { display: inline-flex; align-items: center; gap: var(--es-space-8); min-width: 0; }
.gname a, .gname b { color: var(--es-text) !important; font-weight: var(--es-weight-semibold); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```
