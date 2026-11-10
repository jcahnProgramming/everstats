# Refresh control and panel states

**One per page, in the top bar:** stamp, Refresh button, auto-refresh select (persisted).

| State | Treatment |
|---|---|
| `.is-busy` | The icon spins and the top bar shows a progress line. |
| Panel `.is-loading` | A progress line on the panel's top edge, body dimmed, "Updating…". Same size, so nothing jumps. |
| Panel `.is-stale` | A warning edge and the "Stale · N min old" chip. |
| Panel `.is-error` | A danger edge and an inline `.perr`: what failed, why, and Retry, above ghost rows that keep the panel's height. |

**Panel stamps:** each panel header has its own "Updated …" stamp.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.atop .progress { position: absolute; left: 0; right: 0; bottom: calc(var(--es-border-1) * -1); height: var(--es-adm-progress-h); overflow: hidden; }
.atop .progress > i { display: block; height: 100%; width: 38%; background: var(--es-adm-progress); border-radius: var(--es-radius-pill); margin-left: 30%; }
.rfx { display: inline-flex; align-items: center; gap: var(--es-space-8); }
.rfx .stamp { font-size: var(--es-fs-12); color: var(--es-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.rfx .stamp.stale { color: var(--es-warning); }
.rfx .btn .ico { transition: transform var(--es-motion-base) var(--es-motion-ease); }
.rfx.is-busy .btn .ico { animation: es-spin var(--es-motion-spin) linear infinite; }
.rfx select.inp { width: auto; height: var(--es-size-control-sm); padding: 0 var(--es-space-8); font-size: var(--es-fs-12-5); }
.ap { position: relative; background: var(--es-surface); border: var(--es-border-1) solid var(--es-line); border-radius: var(--es-radius-lg); min-width: 0; }
.ap > .hd { display: flex; align-items: center; gap: var(--es-space-10); flex-wrap: wrap; padding: var(--es-space-12) var(--es-space-16); border-bottom: var(--es-border-1) solid var(--es-line); min-height: var(--es-size-control-lg); }
.ap > .hd h2, .ap > .hd h3 { font: var(--es-weight-semibold) var(--es-fs-15)/var(--es-lh-snug) var(--es-font-body); }
.ap > .hd .spacer { flex: 1; }
.ap > .hd .stamp { font-size: var(--es-fs-11-5); color: var(--es-muted); white-space: nowrap; }
.ap > .bd { padding: var(--es-space-14) var(--es-space-16); display: flex; flex-direction: column; gap: var(--es-space-12); }
.ap > .bd.flush { padding: 0; gap: 0; }
.ap > .ft { padding: var(--es-space-10) var(--es-space-16); border-top: var(--es-border-1) solid var(--es-row-sep); font-size: var(--es-fs-12-5); display: flex; gap: var(--es-space-12); align-items: center; flex-wrap: wrap; }
.ap .pbar { position: absolute; left: 0; right: 0; top: 0; height: var(--es-adm-progress-h); overflow: hidden; border-radius: var(--es-radius-lg) var(--es-radius-lg) 0 0; display: none; }
.ap .pbar > i { display: block; width: 35%; height: 100%; margin-left: 20%; background: var(--es-adm-progress); }
.ap.is-loading .pbar { display: block; }
.ap.is-loading > .bd { opacity: var(--es-adm-loading-opacity); }
.ap.is-stale { border-color: color-mix(in oklab, var(--es-adm-stale-edge) 55%, var(--es-line)); }
.ap.is-error { border-color: color-mix(in oklab, var(--es-adm-error-edge) 60%, var(--es-line)); }
.perr { display: flex; align-items: flex-start; gap: var(--es-space-10); padding: var(--es-space-10) var(--es-space-12); border-radius: var(--es-radius-md); background: color-mix(in oklab, var(--es-danger) 9%, var(--es-sunken)); border: var(--es-border-1) solid color-mix(in oklab, var(--es-danger) 40%, var(--es-line)); font-size: var(--es-fs-13); color: var(--es-text-2); }
.perr .ico { color: var(--es-danger); margin-top: var(--es-space-1); }
.perr b { color: var(--es-text); }
.perr .spacer { flex: 1; }
.ghostrows { display: flex; flex-direction: column; gap: var(--es-space-10); opacity: var(--es-adm-loading-opacity); }
.ghostrows i { display: block; height: var(--es-space-14); border-radius: var(--es-radius-sm); background: var(--es-raised); }
  .rfx .stamp, .rfx select.inp { display: none; }
  .rfx.show-ph .stamp { display: inline; }
```
