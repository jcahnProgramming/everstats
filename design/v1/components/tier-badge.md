# Tier badge

Shield-shaped crest showing a letter tier S/A/B/C/D, or “–” for Unranked. Three sizes. Rank is encoded three ways so it never relies on colour alone: the letter, the fill, and the frame (S = gilt bevel + glow + three pips, A = gold rim, B = silver rim, C/D = plain rims, D on the quietest rim).

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Outer element `.tier` — clipped to the shield polygon; its background is the **ring** (frame).
- Inner `<b>` — clipped to the same polygon, inset by the size’s padding; background is the **fill**, text is the letter in `--es-t-ink`.
- Optional `.tierglow` wrapper (S only, large/hero use) — drop-shadow glow; must wrap, because `filter` on the clipped element would be clipped away.
- Optional `.pips` row (S only, large) — three 6px diamonds under the badge.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Small `.tier.sm` | 22 × 26 px, ring 2px, letter 13px Cinzel 800 | Table rows, roster, collapsed category rows, mini lists |
| Medium `.tier.md` | 40 × 47 px, ring 2.5px, letter 22px | Category headers, category tier grid, featured cards |
| Large `.tier.lg` | 116 × 136 px, ring 5px, letter 70px, inner bevel 4px light + 7px dark | Overall tier on the character sheet; Unranked state |

## States
| State | Treatment |
|---|---|
| Default | Fill + ring per tier (see tokens). Letter `--es-t-ink` (≥7:1 against every fill in every theme). |
| Hover | Only when wrapped in a link (`a.tier-link`): `filter: brightness(1.08)`. Badges themselves are not interactive. |
| Focus | Focus ring goes on the wrapping link, never the badge. |
| Active | n/a — not interactive. |
| Disabled / Unranked | `.tier.u` — sunken fill, `--es-line-strong` ring, letter “–” in `--es-muted`, aria-label “Unranked”. |
| Loading | `.tier.is-loading` — raised fill, `--es-line` ring, letter transparent; pair with skeleton shimmer on siblings. |

## Tokens used
- `--es-t-s`, `--es-t-a`, `--es-t-b`, `--es-t-c`, `--es-t-d (fills)`
- `--es-t-ink (letter)`
- `--es-tier-s-ring (gradient: --es-t-s-ring-hi → --es-accent → --es-t-s-ring-lo)`
- `--es-tier-a-ring (gradient --es-accent-2 → --es-accent)`
- `--es-tier-b-ring (mix of --es-text and --es-line-strong)`
- `--es-line-strong (C ring`, `Unranked ring)`, `--es-line (D ring)`
- `--es-bevel-light`, `--es-bevel-dark (large only)`
- `--es-size-tier-{sm|md|lg}-{w|h|font|pad}`
- `--es-font-display`, `--es-weight-black`, `--es-size-pip`

## HTML reference
```html
<!-- small, in a table cell -->
<span class="tier sm a" role="img" aria-label="Tier A"><b aria-hidden="true">A</b></span>

<!-- large overall tier with S treatment -->
<div class="tier-stack">
  <span class="tierglow"><span class="tier lg s" role="img" aria-label="Tier S"><b aria-hidden="true">S</b></span></span>
  <div class="pips" aria-hidden="true"><i></i><i></i><i></i></div>
</div>

<!-- unranked -->
<span class="tier md u" role="img" aria-label="Unranked"><b aria-hidden="true">–</b></span>
```

## CSS reference (from components.css)
```css
.tier { --shield: polygon(50% 0%, 100% 13%, 100% 63%, 50% 100%, 0% 63%, 0% 13%);
  display: inline-grid; place-items: stretch; flex: none; vertical-align: middle; clip-path: var(--shield); background: var(--ring, var(--es-line-strong)); }
.tier > b { display: grid; place-items: center; clip-path: var(--shield); background: var(--fill); color: var(--es-t-ink); font-family: var(--es-font-display); font-weight: var(--es-weight-black); line-height: var(--es-lh-none); padding-bottom: 12%; }
.tier.sm { width: var(--es-size-tier-sm-w); height: var(--es-size-tier-sm-h); padding: var(--es-size-tier-sm-pad); }
.tier.sm > b { font-size: var(--es-size-tier-sm-font); }
.tier.md { width: var(--es-size-tier-md-w); height: var(--es-size-tier-md-h); padding: var(--es-size-tier-md-pad); }
.tier.md > b { font-size: var(--es-size-tier-md-font); }
.tier.lg { width: var(--es-size-tier-lg-w); height: var(--es-size-tier-lg-h); padding: var(--es-size-tier-lg-pad); }
.tier.lg > b { font-size: var(--es-size-tier-lg-font); box-shadow: inset 0 0 0 var(--es-space-4) var(--es-bevel-light), inset 0 0 0 var(--es-space-7) var(--es-bevel-dark); }
.tier.s { --fill: var(--es-t-s); --ring: var(--es-tier-s-ring); }
.tier.a { --fill: var(--es-t-a); --ring: var(--es-tier-a-ring); }
.tier.b { --fill: var(--es-t-b); --ring: var(--es-tier-b-ring); }
.tier.c { --fill: var(--es-t-c); --ring: var(--es-line-strong); }
.tier.d { --fill: var(--es-t-d); --ring: var(--es-line); }
.tier.u { --fill: var(--es-sunken); --ring: var(--es-line-strong); }
.tier.u > b { color: var(--es-muted); font-weight: var(--es-weight-semibold); }
.tier.is-loading { --fill: var(--es-raised); --ring: var(--es-line); }
.tier.is-loading > b { color: transparent; }
.tierglow { display: inline-block; filter: drop-shadow(0 0 var(--es-space-18) color-mix(in oklab, var(--es-t-s) 45%, transparent)); }
.pips { display: flex; gap: var(--es-space-5); justify-content: center; }
.pips i { width: var(--es-size-pip); height: var(--es-size-pip); transform: rotate(45deg); background: var(--es-accent); }
.tier-stack { display: inline-flex; flex-direction: column; align-items: center; gap: var(--es-space-10); }
a.tier-link:hover .tier { filter: brightness(1.08); }
```

## Notes
Side-by-side contrast check in all three themes: `gallery/tier-badges.html` and `gallery/tier-badges.png`. Measured ink-on-fill contrast is in `../tokens/contrast.md`.

Percentile scale (graded within the character’s own ruleset): **S top 5% · A next 15% · B next 30% · C next 30% · D bottom 20%**. Stats marked “not graded” (deaths etc.) never move a tier.
