# Inputs

Text inputs with visible labels, OTP inputs, selects and checkboxes.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.field` column: `<label>` (Inter 600 12px, `--es-text-2`), control, optional `.help` line.
- `.inp` — the control. `.inp.otp` (mono, 0.3em tracking, 18px) and `.inp.otp-lg` (56px tall, 24px, centred) for 2FA.
- `.check` — native checkbox with `accent-color: var(--es-accent)`, 44px min hit area.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Height | 44px (OTP large 56px) |  |
| Padding | 0 12px |  |
| Radius | 6px |  |
| Label gap | 6px |  |

## States
| State | Treatment |
|---|---|
| Default | `--es-sunken` fill, `--es-line-strong` border, `--es-muted` placeholder. |
| Hover | Border `--es-accent`. |
| Focus | Border + 2px outline `--es-focus`, offset 2px. |
| Active | Same as focus. |
| Disabled | opacity 0.45, not-allowed. |
| Loading | n/a for inputs; Error: `.is-error` border `--es-danger` + `.help.err` message below. |

## Tokens used
- `--es-sunken`, `--es-line-strong`, `--es-accent`, `--es-focus`, `--es-danger`, `--es-muted`, `--es-text`, `--es-text-2`
- `--es-size-control`, `--es-size-control-xl`, `--es-font-mono`, `--es-tracking-otp`, `--es-tracking-otp-lg`, `--es-size-checkbox`

## HTML reference
```html
<div class="field">
  <label for="fn">First name</label>
  <input id="fn" class="inp" placeholder="Placeholdername" autocomplete="off">
</div>
<div class="field">
  <label for="otp">Authentication code</label>
  <input id="otp" class="inp otp-lg" inputmode="numeric" autocomplete="one-time-code" placeholder="000 000">
  <span class="help">Codes refresh every 30 seconds.</span>
</div>
<label class="check"><input type="checkbox">Trust this browser for 30 days</label>
```

## CSS reference (from components.css)
```css
.field { display: flex; flex-direction: column; gap: var(--es-space-6); }
.field > label, .lbl { font: var(--es-weight-semibold) var(--es-fs-12) var(--es-font-body); color: var(--es-text-2); }
.inp { width: 100%; height: var(--es-size-control); padding: 0 var(--es-space-12); border-radius: var(--es-radius-md); border: var(--es-border-1) solid var(--es-line-strong);
  background: var(--es-sunken); color: var(--es-text); font: var(--es-fs-15) var(--es-font-body); }
.inp::placeholder { color: var(--es-muted); }
.inp:hover, .inp.is-hover { border-color: var(--es-accent); }
.inp:focus, .inp.is-focus { outline: var(--es-border-2) solid var(--es-focus); outline-offset: var(--es-space-2); border-color: var(--es-focus); }
.inp[disabled], .inp.is-disabled { opacity: var(--es-opacity-disabled); cursor: not-allowed; }
.inp.is-error { border-color: var(--es-danger); }
.inp.otp { font-family: var(--es-font-mono); letter-spacing: var(--es-tracking-otp); font-size: var(--es-fs-18); }
.inp.otp-lg { height: var(--es-size-control-xl); font-family: var(--es-font-mono); letter-spacing: var(--es-tracking-otp-lg); font-size: var(--es-fs-24); text-align: center; }
.help { font-size: var(--es-fs-12); color: var(--es-muted); }
.help.err { color: var(--es-danger); }
select.inp { appearance: auto; }
.check { display: inline-flex; align-items: center; gap: var(--es-space-10); min-height: var(--es-size-control); cursor: pointer; }
.check input { width: var(--es-size-checkbox); height: var(--es-size-checkbox); accent-color: var(--es-accent); margin: 0; }
```
