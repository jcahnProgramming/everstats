# Toasts

Transient confirmations and errors (refresh queued, theme saved, copy done, refresh failed). Stack bottom-right above the footer on desktop, full-width bottom on phone. Not designed in the original brief — added so async actions have feedback.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.toasts` region (`aria-live="polite"`; error toasts use `role="alert"`).
- `.toast` — diamond `.gemtag` (accent / success / warning / danger), `.body` with bold title + supporting line, ghost close button.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Width | 380px (phone: full width minus 32px) |  |
| Padding | 14px 16px, gap 12px, radius 8px |  |
| Stack gap | 10px; bottom offset 72px desktop, 16px phone |  |

## States
| State | Treatment |
|---|---|
| Default (info) | `--es-raised`, `--es-line-strong` border, accent gem, `--es-shadow-toast`. |
| Success / warning / error | Gem colour `--es-success` / `--es-warning` / `--es-danger`. |
| Hover | Pauses auto-dismiss. |
| Focus | Close button focus ring; toast does not steal focus. |
| Active | n/a. |
| Disabled / Loading | n/a. Auto-dismiss: 5s info/success, errors persist until dismissed. |

## Tokens used
- `--es-raised`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-accent`, `--es-success`, `--es-warning`, `--es-danger`
- `--es-shadow-toast`, `--es-size-toast`, `--es-z-toast`

## HTML reference
```html
<div class="toasts" aria-live="polite">
  <div class="toast ok" role="status"><span class="gemtag"></span>
    <div class="body"><b>Theme saved</b><span>Horde applies on every device.</span></div>
    <button class="btn ghost sm icon x" aria-label="Dismiss">…close…</button></div>
</div>
```

## CSS reference (from components.css)
```css
.toasts { position: fixed; right: var(--es-space-24); bottom: var(--es-space-72); z-index: var(--es-z-toast); display: flex; flex-direction: column; gap: var(--es-space-10); width: min(var(--es-size-toast), calc(100vw - var(--es-space-32))); }
.toasts.static { position: static; width: var(--es-size-toast); max-width: 100%; }
.toast { display: flex; gap: var(--es-space-12); align-items: flex-start; padding: var(--es-space-14) var(--es-space-16); background: var(--es-raised); border: var(--es-border-1) solid var(--es-line-strong); border-radius: var(--es-radius-lg); box-shadow: var(--es-shadow-toast); color: var(--es-text); }
.toast .body { flex: 1; display: flex; flex-direction: column; gap: var(--es-space-2); font-size: var(--es-fs-13-5); }
.toast .body span { color: var(--es-text-2); font-size: var(--es-fs-13); }
.toast .gemtag { width: var(--es-size-gem); height: var(--es-size-gem); transform: rotate(45deg); margin-top: var(--es-space-6); background: var(--es-accent); flex: none; }
.toast.ok .gemtag { background: var(--es-success); }
.toast.warn .gemtag { background: var(--es-warning); }
.toast.err .gemtag { background: var(--es-danger); }
.toast .x { margin: calc(var(--es-space-8) * -1) calc(var(--es-space-10) * -1) 0 0; }

@media (max-width: 719px) {
  .toasts { right: var(--es-space-16); left: var(--es-space-16); bottom: var(--es-space-16); width: auto; }
}
```
