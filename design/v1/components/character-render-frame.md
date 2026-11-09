# Character render frame

Frame for the transparent-background full-body character render. Sits in the character sheet between the two gear columns. Background = theme hero gradient + compass ring motif; the PNG sits bottom-centred over it.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.render` container — `--es-hero` radial gradient, 1px border, radius 6px.
- `.ring` — assets/emblem/compass-ring.svg, 80% width (max 420px), 55% opacity.
- `.figure` — the render `<img>` (placeholder: assets/illustrations/render-placeholder.svg), width 250px, max 80%.
- `.fade` — 64px bottom fade into the page ground.
- `.cap` — optional mono caption (mockup only).
- `.center` — overlay used by the render-not-ready state.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Min height | 560px desktop, 340px phone |  |
| Figure | 250px wide desktop, 150px phone, keep aspect |  |
| Real render asset | Expect a transparent PNG/WebP, tall portrait (≈ 1:2); object-fit contain, anchored bottom |  |

## States
| State | Treatment |
|---|---|
| Default | Render shown over ring + hero gradient. |
| Hover | n/a (not interactive). Optional: none. |
| Focus | n/a. |
| Active | n/a. |
| Disabled | n/a. |
| Loading | Whole frame `.skel` + 64px spinner (character lookup in progress). Render-not-ready: ring + `.center` with spinner, “Portrait in progress” — rest of page live (see states/render-not-ready). |

## Tokens used
- `--es-hero (from --es-hero-1/2/3)`, `--es-line`, `--es-bg`, `--es-accent (ring)`, `--es-raised & --es-line-strong (placeholder figure)`
- `--es-size-render-min-h`, `--es-size-render-phone-h`, `--es-size-render-figure-w`, `--es-size-emblem-hero`, `--es-opacity-motif`

## HTML reference
```html
<div class="render">
  <svg class="ring" viewBox="0 0 200 200" aria-hidden="true">…compass-ring…</svg>
  <img class="figure" src="/renders/{id}.png" alt="Full-body render of Placeholdername Surname">
  <span class="fade"></span>
</div>
```

## CSS reference (from components.css)
```css
.render { position: relative; display: grid; place-items: end center; overflow: hidden; background: var(--es-hero); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-md); min-height: var(--es-size-render-min-h); }
.render .ring { position: absolute; left: 50%; top: 46%; width: 80%; max-width: var(--es-size-emblem-hero); aspect-ratio: 1; transform: translate(-50%, -50%); opacity: var(--es-opacity-motif); }
.render .figure { position: relative; width: var(--es-size-render-figure-w); max-width: 80%; height: auto; }
.render .fade { position: absolute; inset: auto 0 0 0; height: var(--es-space-64); background: linear-gradient(0deg, color-mix(in oklab, var(--es-bg) 70%, transparent), transparent); }
.render .cap { position: absolute; top: var(--es-space-12); left: var(--es-space-14); font: var(--es-fs-11) var(--es-font-mono); color: var(--es-muted); }
.render .badge-corner { position: absolute; top: var(--es-space-10); right: var(--es-space-10); }
.render .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--es-space-8); text-align: center; padding: var(--es-space-16); }

@media (max-width: 719px) {
  .render { min-height: var(--es-size-render-phone-h); }
  .render .figure { width: calc(var(--es-size-render-figure-w) * 0.6); }
}
```
