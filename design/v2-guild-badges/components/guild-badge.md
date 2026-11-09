# Guild badge

The guild badge icon. Its frame is the **hanging standard**: a three-tailed gonfalon hung from a crossbar rod with ball finials.

## Anatomy, back to front
1. Level V only: a glow stroke (`--es-gbadge-metal-5-glow`).
2. The rim (`--es-gbadge-rim`) around the body and rod.
3. The cloth body: `--gc`, the family cloth, or `--es-gbadge-cloth-forever` at level V.
4. The metal edge: `--gm`, the level metal, or `--es-gbadge-metal-fixed` for badges without levels.
5. The rod (`--es-gbadge-rod`) with metal finials.
6. The inset line (standard and large sizes only).
7. Level badges only: **gems on the rod, one per level**, plus a **numeral plate** (I–V).
8. The motif in `--gi`.
9. Level V only: a **star finial** above the rod.

Inline drawings (`*-inline.svg`) drop the gems, inset and plate. Levelled badges show the **level numeral** as the motif instead, so the level can still be read at 18px.

## Level system (non-colour cues at every size)
| Level | Metal token | Cues |
|---|---|---|
| I · Iron | `--es-gbadge-metal-1` | 1 gem · plate “I” · inline numeral “I” |
| II · Bronze | `--es-gbadge-metal-2` | 2 gems · plate “II” · inline numeral “II” |
| III · Silver | `--es-gbadge-metal-3` | 3 gems · plate “III” · inline numeral “III” |
| IV · Gold | `--es-gbadge-metal-4` | 4 gems · plate “IV” · inline numeral “IV” |
| V · Forever | `--es-gbadge-metal-5` | 5 gems · plate “V” · inline numeral “V” · star finial · glow · Forever cloth |

The pill always spells the numeral out as text ("Muster IV"), and the aria-label says it too.

## Sizes
Same as player badges: inline 18px (`--es-size-badge-inline`), pill icon 28px (`--es-size-gbadge-pill-icon`), standard 44px, large 112px, xl 128px. The viewBox is `-3 -5 70 70` to leave room for the star finial.

## States
| State | Treatment |
|---|---|
| Unlocked | Full colour. |
| Hover / focus / active | Same as v2 badges: lift + brightness on hover, v1 focus ring. |
| New | `.is-new`: a `--es-badge-new` glow. On the guild page the pill also gets an **Unlocked [Date]** ribbon for 7 days. |
| Next level in progress | `.is-progress`: locked cloth and ink, but the **next level’s metal, gems and numeral** are already visible, so you can see the target. Always shown with a progress bar. |
| Locked (not started) | `.is-locked`: locked cloth, metal and ink, plus a lock mark. |
| Held | `.is-held`: an hourglass mark (`--es-gbadge-held`), top-right. Standing badges only. |
| Lost | `.is-lost`: locked colours at 70% opacity with a hollow hourglass. Lost badges disappear from the public page; only the GM and officers see them, in Manage, until the badge is regained. |
| No longer available | `.is-retired`: locked colours at 70% opacity with a clock mark, plus a "No longer available" note. Heritage badges only. |

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.gbdg { position: relative; display: inline-grid; place-items: center; flex: none; padding: 0; margin: 0; border: 0; background: none; cursor: pointer; border-radius: var(--es-radius-md); vertical-align: middle; color: inherit; }
.gbdg svg { width: 100%; height: 100%; display: block; overflow: visible; transition: transform var(--es-motion-fast) var(--es-motion-ease), filter var(--es-motion-fast); }
.gbdg.inline { width: var(--es-size-badge-inline); height: var(--es-size-badge-inline); border-radius: var(--es-radius-xs); }
.gbdg.pill-ico { width: var(--es-size-gbadge-pill-icon); height: var(--es-size-gbadge-pill-icon); }
.gbdg.std { width: var(--es-size-badge); height: var(--es-size-badge); }
.gbdg.lg { width: var(--es-size-badge-lg); height: var(--es-size-badge-lg); }
.gbdg.xl { width: var(--es-size-badge-xl); height: var(--es-size-badge-xl); }
button.gbdg:hover svg, .gbdg.is-hover svg { transform: translateY(calc(var(--es-border-1) * -1)); filter: brightness(1.08); }
.gbdg.is-new svg { filter: drop-shadow(0 0 var(--es-space-6) color-mix(in oklab, var(--es-badge-new) 70%, transparent)); }
.gbdg.is-locked svg, .gbdg.is-retired svg, .gbdg.is-lost svg, .gbdg.is-progress svg {
  --gc: var(--es-gbadge-locked-cloth) !important; --gi: var(--es-gbadge-locked-ink) !important; }
.gbdg.is-locked svg, .gbdg.is-retired svg, .gbdg.is-lost svg { --gm: var(--es-gbadge-locked-metal) !important; }
.gbdg.is-retired svg, .gbdg.is-lost svg { opacity: 0.7; }
.gbdg .mark { position: absolute; right: calc(var(--es-space-4) * -1); top: calc(var(--es-space-2) * -1); width: 38%; height: 38%; min-width: var(--es-space-14); min-height: var(--es-space-14); border-radius: var(--es-radius-round); display: grid; place-items: center; border: var(--es-border-1) solid var(--es-bg); }
.gbdg .mark svg { width: 62%; height: 62%; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.gbdg .mark.held { background: var(--es-gbadge-held); color: var(--es-gbadge-held-ink); }
.gbdg .mark.lost, .gbdg .mark.lock, .gbdg .mark.closed { background: var(--es-raised); color: var(--es-muted); border-color: var(--es-line-strong); top: auto; bottom: calc(var(--es-space-2) * -1); }
.gbdg.inline .mark, .gbdg.pill-ico .mark { display: none; }
.gpill.sm .gbdg { width: var(--es-size-gbadge-pill-icon-sm); height: var(--es-size-gbadge-pill-icon-sm); }
.gverified .gbdg.inline { width: var(--es-space-22); height: var(--es-space-22); }
.ucard .gbdg { grid-row: span 2; }
```
