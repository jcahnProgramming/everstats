# Ranked table row

Dense leaderboard row. Desktop is a real `<table>`; at phone width the same data renders as the stacked `.ranklist` (a separate `<ol>` toggled by CSS).

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- Rank `.rk` — Cinzel 700 15px; #1 `--es-t-s`, #2 `--es-text`, #3 `--es-accent-2`, rest `--es-text-2`.
- Character `.who` — avatar initials `.av` (28px circle), name link (Inter 600), meta line “[Race] [Class] · level” below in `--es-muted` 12px.
- Tier — `.tier.sm`.
- Guild — `--es-text-2`, “—” when none.
- 7-day movement — `▲ n` `.up`, `▼ n` `.down`, `—` muted.
- Value — right-aligned, Inter 600 tabular.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Cell padding | 9px 14px (th 10px 14px) | row ≈ 57px with two-line character cell |
| Rank column | 56px |  |
| Phone list item | grid `40px minmax(0,1fr) auto`, min-height 56px, padding 10px 14px |  |

## States
| State | Treatment |
|---|---|
| Default | Transparent; `--es-row-sep` bottom border. |
| Hover | All cells `--es-raised` at 70%. |
| Focus | Name link gets the focus ring; whole row is not focusable. |
| Active / own row | `tr.me` — background `--es-own-row` (13% accent) + `.tag.you` after the name. Logged-in only. If the viewer’s character is outside the visible page, append a `tr.sep` “· · ·” row then their row(s). |
| Disabled | n/a. |
| Loading | Skeleton row: `.skel.skel-line` in each cell, `.tier.is-loading`. Show 10 skeleton rows. |

## Tokens used
- `--es-row-sep`, `--es-raised`, `--es-own-row`, `--es-accent`, `--es-accent-ink`
- `--es-t-s`, `--es-text`, `--es-accent-2`, `--es-text-2 (rank colours)`
- `--es-size-rank-col`, `--es-size-avatar`, `--es-tracking-th`

## HTML reference
```html
<div class="panel tblbox">
<table class="tbl to-list">
  <thead><tr><th aria-sort="ascending">Rank</th><th>Character</th><th>Tier</th><th>Guild</th><th class="r">7-day</th><th class="r">Times camped</th></tr></thead>
  <tbody>
    <tr><td class="rk r1">1</td>
      <td><div class="who"><span class="av">01</span><span class="stack"><a href="#">Placeholder Name 01</a><span class="muted xsmall">[Race] [Class] · 00</span></span></div></td>
      <td><span class="tier sm s" role="img" aria-label="Tier S"><b aria-hidden="true">S</b></span></td>
      <td class="t2">Placeholder Guild</td><td class="r up">▲ 2</td><td class="r strong">99,999</td></tr>
    <tr class="me">…<span class="tag you">You</span>…</tr>
  </tbody>
</table>
<ol class="ranklist only-phone">…same rows as list items…</ol>
</div>
```

## CSS reference (from components.css)
```css
.tblbox { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; padding: var(--es-space-10) var(--es-space-14); border-bottom: var(--es-border-1) solid var(--es-line); color: var(--es-muted); font: var(--es-weight-semibold) var(--es-fs-11) var(--es-font-body); letter-spacing: var(--es-tracking-th); text-transform: uppercase; white-space: nowrap; }
.tbl th button { all: unset; cursor: pointer; display: inline-flex; gap: var(--es-space-4); align-items: center; }
.tbl th[aria-sort] { color: var(--es-text-2); }
.tbl td { padding: var(--es-space-9) var(--es-space-14); border-bottom: var(--es-border-1) solid var(--es-row-sep); white-space: nowrap; }
.tbl .r { text-align: right; }
.tbl .strong { font-weight: var(--es-weight-semibold); }
.tbl tbody tr:hover td, .tbl tr.is-hover td { background: color-mix(in oklab, var(--es-raised) 70%, transparent); }
.tbl tr.me td { background: var(--es-own-row); }
.tbl tr.sep td { text-align: center; color: var(--es-muted); letter-spacing: var(--es-tracking-sep); font-size: var(--es-fs-12); }
.rk { font: var(--es-weight-bold) var(--es-fs-15) var(--es-font-display); color: var(--es-text-2); width: var(--es-size-rank-col); font-variant-numeric: tabular-nums; }
.rk.r1 { color: var(--es-t-s); }
.rk.r2 { color: var(--es-text); }
.rk.r3 { color: var(--es-accent-2); }
.who { display: flex; align-items: center; gap: var(--es-space-10); }
.who a { color: var(--es-text) !important; font-weight: var(--es-weight-semibold); text-decoration: none; }
.who a:hover { text-decoration: underline; }
.av { width: var(--es-size-avatar); height: var(--es-size-avatar); border-radius: var(--es-radius-round); background: var(--es-raised); border: var(--es-border-1) solid var(--es-line-strong); display: grid; place-items: center; flex: none; color: var(--es-muted); font: var(--es-weight-semibold) var(--es-fs-11) var(--es-font-body); }
.ranklist { list-style: none; margin: 0; padding: 0; }
.ranklist a { display: grid; grid-template-columns: var(--es-space-40) minmax(0, 1fr) auto; gap: var(--es-space-2) var(--es-space-10); align-items: center; padding: var(--es-space-10) var(--es-space-14); min-height: var(--es-size-control-xl); border-bottom: var(--es-border-1) solid var(--es-row-sep); color: var(--es-text); text-decoration: none; }
.ranklist .rk { grid-row: span 2; width: auto; font-size: var(--es-fs-17); }
.ranklist li.me a { background: var(--es-own-row); }
.mini .ln .rk { width: auto; font-size: var(--es-fs-14); }

@media (max-width: 719px) {
  .tbl.to-list { display: none; }
}
```
