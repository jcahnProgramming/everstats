# Bottom version bar

Footer on every page. Left: “Everstats · Not affiliated with or endorsed by Blizzard Entertainment · Data via the Blizzard API”. Right: the version tag — **the only link to the Changelog page**.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Disclaimer text (`--es-muted`, 12.5px).
- `a.ver` — JetBrains Mono version string (`v0.1.0`) in a 1px bordered chip.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Height | min 52px; padding 8px vertical |  |
| Version chip | min-height 32px (44px on phone), padding 0 8px, radius 4px |  |

## States
| State | Treatment |
|---|---|
| Default | Background `--es-footbar-bg`, top border `--es-line`. |
| Hover | Version chip border `--es-accent`, text `--es-text`. |
| Focus | Focus ring on the chip. |
| Active | Same as hover. |
| Disabled | n/a. |
| Loading | n/a — version is build-time. |

## Tokens used
- `--es-footbar-bg`, `--es-line`, `--es-muted`, `--es-text-2`, `--es-accent`
- `--es-font-mono`, `--es-size-footbar`, `--es-size-control-xs`

## HTML reference
```html
<footer class="foot"><div class="wrap in">
  <span>Everstats · Not affiliated with or endorsed by Blizzard Entertainment · Data via the Blizzard API</span>
  <a class="ver" href="/changelog">v0.1.0</a>
</div></footer>
```

## CSS reference (from components.css)
```css
.foot { border-top: var(--es-border-1) solid var(--es-line); background: var(--es-footbar-bg); color: var(--es-muted); font-size: var(--es-fs-12-5); }
.foot .in { display: flex; gap: var(--es-space-10) var(--es-space-20); flex-wrap: wrap; justify-content: space-between; align-items: center; min-height: var(--es-size-footbar); padding-top: var(--es-space-8); padding-bottom: var(--es-space-8); }
.foot a { color: var(--es-text-2) !important; text-decoration: none; }
.foot a.ver { display: inline-flex; align-items: center; min-height: var(--es-size-control-xs); padding: 0 var(--es-space-8); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-sm); font-family: var(--es-font-mono); }
.foot a.ver:hover { border-color: var(--es-accent); color: var(--es-text) !important; }

@media (max-width: 719px) {
  .foot .in { flex-direction: column; align-items: flex-start; }
  .foot a.ver { min-height: var(--es-size-control); }
}
```
