# Toggles (switch)

On/off switch for immediate-effect settings (e.g. Reduce motion in Account settings). Built on a real checkbox for accessibility.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Visually hidden `<input type="checkbox">` (kept in the tab order).
- `.track` — 44 × 26px pill; `::after` knob 20px.
- Label text.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Track | 44 × 26px, radius pill, 1px border |  |
| Knob | 20px circle, 2px inset |  |
| Hit area | min-height 44px row |  |

## States
| State | Treatment |
|---|---|
| Default (off) | Track `--es-sunken`, border `--es-line-strong`, knob `--es-muted`. |
| On | Track + border `--es-accent`, knob `--es-accent-ink`, knob slides right. |
| Hover | Track border `--es-accent`. |
| Focus | 2px `--es-focus` outline on the track. |
| Disabled | Track opacity 0.45, not-allowed cursor. |
| Loading | n/a — apply optimistically; on failure revert and show an error toast. |

## Tokens used
- `--es-sunken`, `--es-line-strong`, `--es-muted`, `--es-accent`, `--es-accent-ink`, `--es-focus`
- `--es-size-toggle-w`, `--es-size-toggle-h`, `--es-size-toggle-knob`, `--es-motion-base`, `--es-motion-ease`

## HTML reference
```html
<label class="toggle"><input type="checkbox" checked><span class="track"></span>Reduce motion</label>
```

## CSS reference (from components.css)
```css
.toggle { display: inline-flex; align-items: center; gap: var(--es-space-12); min-height: var(--es-size-control); cursor: pointer; }
.toggle input { position: absolute; opacity: 0; width: var(--es-size-toggle-w); height: var(--es-size-toggle-h); margin: 0; cursor: pointer; }
.toggle .track { position: relative; width: var(--es-size-toggle-w); height: var(--es-size-toggle-h); border-radius: var(--es-radius-pill); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line-strong); transition: background var(--es-motion-base) var(--es-motion-ease); flex: none; }
.toggle .track::after { content: ""; position: absolute; top: calc((var(--es-size-toggle-h) - var(--es-size-toggle-knob)) / 2 - var(--es-border-1)); left: var(--es-space-2); width: var(--es-size-toggle-knob); height: var(--es-size-toggle-knob); border-radius: var(--es-radius-round); background: var(--es-muted); transition: transform var(--es-motion-base) var(--es-motion-ease), background var(--es-motion-base); }
.toggle input:checked + .track { background: var(--es-accent); border-color: var(--es-accent); }
.toggle input:checked + .track::after { transform: translateX(calc(var(--es-size-toggle-w) - var(--es-size-toggle-knob) - var(--es-space-6))); background: var(--es-accent-ink); }
.toggle:hover .track, .toggle.is-hover .track { border-color: var(--es-accent); }
.toggle input:focus-visible + .track, .toggle.is-focus .track { outline: var(--es-border-2) solid var(--es-focus); outline-offset: var(--es-space-2); }
.toggle input:disabled + .track, .toggle.is-disabled .track { opacity: var(--es-opacity-disabled); }
.toggle.is-disabled { cursor: not-allowed; }
```
