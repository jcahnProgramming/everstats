# Version + region switcher

A button showing "{version} | {region}". It opens a listbox with versions (each with an On or "Off · admin only" chip) and regions (off ones marked).

- **Global sections:** a dashed `.vswitch.is-global` "All versions" pill that can't be opened.
- **URL:** the choice is written to the URL (`?v=&r=`) and every per-version section follows it.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.vswitch { display: inline-flex; align-items: center; gap: var(--es-space-8); height: var(--es-size-control-md); padding: 0 var(--es-space-10) 0 var(--es-space-12); border-radius: var(--es-radius-md); border: var(--es-border-1) solid var(--es-line-strong); background: var(--es-sunken); color: var(--es-text); font: var(--es-weight-semibold) var(--es-fs-13) var(--es-font-body); cursor: pointer; white-space: nowrap; }
.vswitch .reg { font-family: var(--es-font-mono); font-size: var(--es-fs-12); color: var(--es-accent-2); padding-left: var(--es-space-8); border-left: var(--es-border-1) solid var(--es-line-strong); }
.vswitch.is-global { border-style: dashed; color: var(--es-text-2); cursor: default; }
.vmenu { position: absolute; z-index: var(--es-z-dropdown); top: calc(100% + var(--es-space-6)); left: 0; width: var(--es-adm-search-w); padding: var(--es-space-8); display: flex; flex-direction: column; gap: var(--es-space-2); box-shadow: var(--es-shadow-modal); }
.vmenu .grp { font: var(--es-weight-semibold) var(--es-fs-10) var(--es-font-body); letter-spacing: var(--es-tracking-eyebrow); text-transform: uppercase; color: var(--es-muted); padding: var(--es-space-8) var(--es-space-8) var(--es-space-4); }
.vopt { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--es-space-8); padding: var(--es-space-8); border-radius: var(--es-radius-sm); font-size: var(--es-fs-13); color: var(--es-text); }
.vopt[aria-selected="true"] { background: var(--es-adm-nav-active); box-shadow: inset var(--es-border-2) 0 0 var(--es-accent); }
.vopt.is-off { color: var(--es-muted); }
.regs { display: flex; flex-wrap: wrap; gap: var(--es-space-4); padding: var(--es-space-4) var(--es-space-8) var(--es-space-8); }
  .vmenu { width: auto; right: 0; }
```
