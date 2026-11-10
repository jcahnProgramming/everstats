# Shell

A two-column grid: sidebar (`--es-adm-sidebar-w`) plus main.

- **Main:** a sticky top bar (`--es-adm-topbar-h`), then the content column (max `--es-adm-content-max`).
- **`.is-collapsed`:** an icon rail (`--es-adm-sidebar-w-collapsed`), with labels as `title` tooltips.
- **Phone:** the sidebar hides. The top bar wraps into three rows — menu + page title + refresh, then the version switcher, then search. `.menu-open` slides the sidebar in over a scrim.

The `.es` class from v1 sets type and colour.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.es.adm { display: grid; grid-template-columns: var(--es-adm-sidebar-w) minmax(0, 1fr); min-height: 100vh; background: linear-gradient(90deg, var(--es-adm-sidebar-bg) var(--es-adm-sidebar-w), var(--es-line) var(--es-adm-sidebar-w), var(--es-line) calc(var(--es-adm-sidebar-w) + var(--es-border-1)), var(--es-bg) calc(var(--es-adm-sidebar-w) + var(--es-border-1))); color: var(--es-text); font-size: var(--es-fs-14); }
.es.adm.is-collapsed { grid-template-columns: var(--es-adm-sidebar-w-collapsed) minmax(0, 1fr); background: linear-gradient(90deg, var(--es-adm-sidebar-bg) var(--es-adm-sidebar-w-collapsed), var(--es-bg) var(--es-adm-sidebar-w-collapsed)); }
.aside { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: var(--es-adm-sidebar-bg); border-right: var(--es-border-1) solid var(--es-line); min-width: 0; }
.aside .brandrow { display: flex; align-items: center; gap: var(--es-space-10); height: var(--es-adm-topbar-h); padding: 0 var(--es-space-16); border-bottom: var(--es-border-1) solid var(--es-line); }
.aside .brand { font-size: var(--es-fs-17); }
.aside .brand svg { width: var(--es-size-icon-lg); height: var(--es-size-icon-lg); }
.aside .admtag { font: var(--es-weight-bold) var(--es-fs-10)/var(--es-lh-none) var(--es-font-body); letter-spacing: var(--es-tracking-tag); text-transform: uppercase; padding: var(--es-space-4) var(--es-space-6); border-radius: var(--es-radius-xs); background: var(--es-accent); color: var(--es-accent-ink); }
.aside .collapse { margin-left: auto; }
.aside .foot-id { border-top: var(--es-border-1) solid var(--es-line); padding: var(--es-space-12) var(--es-space-12); display: flex; flex-direction: column; gap: var(--es-space-8); }
.aside .who { display: flex; align-items: center; gap: var(--es-space-10); font-size: var(--es-fs-12-5); color: var(--es-text-2); }
.aside .who b { color: var(--es-text); display: block; font-size: var(--es-fs-13); }
.amain { min-width: 0; display: flex; flex-direction: column; }
.atop { position: sticky; top: 0; z-index: var(--es-z-sticky); display: flex; align-items: center; gap: var(--es-space-12); height: var(--es-adm-topbar-h); padding: 0 var(--es-space-24); background: var(--es-adm-topbar-bg); border-bottom: var(--es-border-1) solid var(--es-line); }
.atop .menu-btn, .atop .phone-title { display: none; }
.atop .spacer { flex: 1; }
.atop .progress { position: absolute; left: 0; right: 0; bottom: calc(var(--es-border-1) * -1); height: var(--es-adm-progress-h); overflow: hidden; }
.atop .progress > i { display: block; height: 100%; width: 38%; background: var(--es-adm-progress); border-radius: var(--es-radius-pill); margin-left: 30%; }
.acontent { width: 100%; max-width: var(--es-adm-content-max); padding: var(--es-space-24) var(--es-space-24) var(--es-space-64); display: flex; flex-direction: column; gap: var(--es-space-20); }
  .es.adm, .es.adm.is-collapsed { grid-template-columns: minmax(0, 1fr); background: var(--es-bg); }
  .aside { display: none; }
  .atop { flex-wrap: wrap; height: auto; padding: var(--es-space-8) var(--es-space-12); gap: var(--es-space-8); }
  .atop .menu-btn { display: inline-flex; }
  .atop .phone-title { display: block; font: var(--es-weight-bold) var(--es-fs-15) var(--es-font-display); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .atop .asearch { order: 5; flex: 1 1 100%; }
  .atop .anchor.vs { order: 4; flex: 1 1 100%; }
  .atop .vswitch { width: 100%; justify-content: space-between; }
  .atop .spacer { display: none; }
  .acontent { padding: var(--es-space-14) var(--es-space-12) var(--es-space-48); gap: var(--es-space-14); }
```
