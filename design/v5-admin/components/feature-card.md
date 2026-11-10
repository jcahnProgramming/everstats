# Feature card

**Header:** name, a toggle with On/Off text, a state chip, and either "Visible to players" (`chip.vis`) or "Admin and background only".

**Body:**

- what it does
- **When off:** the fallback visitors see
- **Needs:** dependencies
- **Used by:** dependents
- its own settings, if any — e.g. the renders-off note
- last changed by and when

`.is-off` has a dashed edge and a dimmer background. A toggle that can't be turned off (the only game version on) is disabled.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.fgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--es-size-col-min-xl), 100%), 1fr)); gap: var(--es-space-12); }
.fcard { display: flex; flex-direction: column; gap: var(--es-space-10); padding: var(--es-space-14) var(--es-space-16); background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); }
.fcard .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--es-space-4) var(--es-space-12); align-items: start; }
.fcard .top h3 { font: var(--es-weight-semibold) var(--es-fs-15)/var(--es-lh-snug) var(--es-font-body); }
.fcard .top .chips { grid-column: 1; display: flex; gap: var(--es-space-6); flex-wrap: wrap; }
.fcard .top .toggle { grid-row: span 2; grid-column: 2; min-height: 0; }
.fcard .top .toggle .state { font: var(--es-weight-semibold) var(--es-fs-12) var(--es-font-body); color: var(--es-text-2); min-width: var(--es-space-24); }
.fcard p { font-size: var(--es-fs-13); color: var(--es-text-2); }
.fcard dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--es-space-6) var(--es-space-12); margin: 0; font-size: var(--es-fs-12-5); }
.fcard dt { color: var(--es-muted); }
.fcard dd { margin: 0; color: var(--es-text); min-width: 0; }
.fcard .own { border-top: var(--es-border-1) solid var(--es-row-sep); padding-top: var(--es-space-10); display: flex; flex-direction: column; gap: var(--es-space-8); }
.fcard .own textarea.inp { height: auto; min-height: var(--es-space-56); padding: var(--es-space-8) var(--es-space-10); font: inherit; font-size: var(--es-fs-13); }
.fcard .by { font-size: var(--es-fs-11-5); color: var(--es-muted); }
.fcard.is-off { background: color-mix(in oklab, var(--es-surface) 60%, var(--es-bg)); border-style: dashed; }
```
