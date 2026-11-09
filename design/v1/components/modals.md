# Modals

Confirmation dialogs for destructive or irreversible actions: unlink a sign-in method, remove a passkey, merge accounts, regenerate recovery codes, rotate an API key. Plain variant `.modal.panel`; ornate variant `.modal.sheet` for irreversible actions. Not in the original brief — added because the settings flows need them.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.scrim` — fixed full-screen backdrop `--es-scrim`, centres the dialog, z `--es-z-modal`.
- `.modal[role=dialog][aria-modal=true]` — header (`h3` + close), body, optional warning `.note.warn`, confirmation checkbox, `.actions` (Cancel ghost + primary/danger).

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Width | max 480px, 100% on phone (16px scrim padding) |  |
| Padding | 24px, gap 16px |  |
| Actions | right-aligned, gap 10px, wrap on phone |  |

## States
| State | Treatment |
|---|---|
| Default | Open with focus on the first control; Esc and Cancel close; focus returns to the trigger. |
| Hover | Buttons per button spec. |
| Focus | Focus trapped inside the dialog. |
| Active | n/a. |
| Disabled | Primary stays disabled until the confirmation checkbox is ticked (merge). |
| Loading | Primary `.is-loading`; Cancel disabled; Esc ignored until the request resolves. |

## Tokens used
- `--es-scrim`, `--es-surface`, `--es-line`, `--es-accent`, `--es-shadow-modal`, `--es-size-modal`, `--es-z-modal`

## HTML reference
```html
<div class="scrim">
  <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <div class="hd"><h3 class="h3" id="m-title" style="flex: 1">Unlink Battle.net?</h3>
      <button class="btn ghost sm icon" aria-label="Close">…</button></div>
    <p class="t2 small">Your imported characters stay on Everstats but will no longer be highlighted as yours.</p>
    <div class="actions"><button class="btn ghost">Cancel</button><button class="btn danger">Unlink</button></div>
  </div>
</div>
```

## CSS reference (from components.css)
```css
.scrim { position: fixed; inset: 0; background: var(--es-scrim); z-index: var(--es-z-modal); display: grid; place-items: center; padding: var(--es-space-16); }
.scrim.static { position: relative; inset: auto; min-height: var(--es-space-120); border-radius: var(--es-radius-lg); padding: var(--es-space-40) var(--es-space-16); }
.modal { width: 100%; max-width: var(--es-size-modal); display: flex; flex-direction: column; gap: var(--es-space-16); padding: var(--es-space-24); }
.modal.sheet { box-shadow: inset 0 0 0 var(--es-border-5) var(--es-surface), inset 0 0 0 var(--es-space-6) color-mix(in oklab, var(--es-accent) 45%, transparent), var(--es-shadow-modal); }
.modal .hd { display: flex; align-items: flex-start; gap: var(--es-space-12); }
.modal .actions { display: flex; gap: var(--es-space-10); justify-content: flex-end; flex-wrap: wrap; }
```
