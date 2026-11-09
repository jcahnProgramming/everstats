# Standing bar

Eight segments, Hated → Exalted.

- **Segments:** reached standings are filled; the current one is part-filled by progress within that standing.
- **Header:** faction name, standing name, "step N of 8"; Exalted adds a star.
- **Footer:** "have / total" and "N steps to Exalted" ("Maxed" at Exalted).
- **Colours:** `--es-standing-*`, from theme tokens. Colour is never the only cue: count of filled segments, name, step number and star all say the same thing.
- **Accessibility:** `role="group"` with `aria-label="{faction}: {standing}, step N of 8"`.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.standing { --st: var(--es-standing-neutral); display: flex; flex-direction: column; gap: var(--es-space-6); min-width: 0; }
.standing .hd { display: flex; align-items: baseline; gap: var(--es-space-8); flex-wrap: wrap; }
.standing .hd .nm { font-weight: var(--es-weight-semibold); font-size: var(--es-fs-14); min-width: 0; }
.standing .hd .lv { margin-left: auto; display: inline-flex; align-items: center; gap: var(--es-space-6); font-size: var(--es-fs-12-5); font-weight: var(--es-weight-semibold); white-space: nowrap; }
.standing .hd .lv i { font-style: normal; color: var(--es-muted); font-weight: var(--es-weight-medium); }
.standing .hd .lv svg { width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); stroke: var(--es-accent-2); fill: var(--es-accent-2); }
.standing .track { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: var(--es-coll-standing-gap); }
.standing .track i { height: var(--es-coll-standing-h); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); position: relative; overflow: hidden; }
.standing .track i:first-child { border-radius: var(--es-radius-pill) 0 0 var(--es-radius-pill); }
.standing .track i:last-child { border-radius: 0 var(--es-radius-pill) var(--es-radius-pill) 0; }
.standing .track i.on { background: var(--st); border-color: var(--st); }
.standing .track i.cur { border-color: var(--st); }
.standing .track i.cur > b { position: absolute; inset: 0 auto 0 0; background: var(--st); }
.standing .ft { display: flex; justify-content: space-between; gap: var(--es-space-8); font-size: var(--es-fs-11-5); color: var(--es-muted); }
.standing.st-hated { --st: var(--es-standing-hated); } .standing.st-hostile { --st: var(--es-standing-hostile); }
.standing.st-unfriendly { --st: var(--es-standing-unfriendly); } .standing.st-neutral { --st: var(--es-standing-neutral); }
.standing.st-friendly { --st: var(--es-standing-friendly); } .standing.st-honored { --st: var(--es-standing-honored); }
.standing.st-revered { --st: var(--es-standing-revered); } .standing.st-exalted { --st: var(--es-standing-exalted); }
.standing-scale { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: var(--es-coll-standing-gap); font-size: var(--es-fs-10); color: var(--es-muted); text-align: center; letter-spacing: var(--es-tracking-tag); text-transform: uppercase; }
.repgroup { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--es-size-col-min-lg), 100%), 1fr)); gap: var(--es-space-14) var(--es-space-28); }
  .standing-scale { display: none; }
```
