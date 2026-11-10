# Confirm dialog

A v1 sheet modal containing:

- a title phrased as a question
- what happens, and whether players see it
- an affected list (`.affect`) with every dependent and its fallback
- a reason field: required, and saved to the audit log
- optionally, an acknowledgement checkbox for changes players see
- Cancel and a danger confirm button whose label names the action ("Turn off", "Temp ban for 7 days")

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.adlg { width: 100%; max-width: var(--es-adm-dialog-w); padding: var(--es-space-20); gap: var(--es-space-14); }
.adlg h2 { font: var(--es-weight-bold) var(--es-fs-20)/var(--es-lh-snug) var(--es-font-display); }
.adlg .affect { display: flex; flex-direction: column; border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-md); }
.adlg .affect > div { display: flex; gap: var(--es-space-10); align-items: center; padding: var(--es-space-8) var(--es-space-12); border-bottom: var(--es-border-1) solid var(--es-row-sep); font-size: var(--es-fs-13); }
.adlg .affect > div:last-child { border-bottom: 0; }
.adlg textarea.inp { height: auto; min-height: var(--es-space-72); padding: var(--es-space-8) var(--es-space-10); font: inherit; font-size: var(--es-fs-13); }
```
