# Manage guild → Badges

For the Guild Master and the officers they add. **Nobody can award a badge here.** Badges are automatic or granted by staff.

## Sections
- **Shown on the guild page:** drag to reorder (grip handle; keyboard: Space to pick up, arrow keys to move, Space to drop). Each row has a Show toggle and a **Pin** radio; exactly one badge is pinned. Levelled rows show progress toward the next level.
- **Unlocked, hidden:** unlocked badges the guild chose not to show. Standing badges that are held but hidden also sit here, and **lost** standing badges move here with "Lost [Date]". A lost badge can't be shown or pinned until it's regained.
- **Not yet:** standing badges not currently held, with the reason (e.g. "average tier is B, needs A"), and closed Heritage windows marked "No longer available".

## Rules
- If a pinned badge is lost, the pin falls back to the next shown badge, and the GM gets the "lost" toast.
- Automatic defaults until the guild has a GM: the first 6 unlocked badges ordered by family (Recognition, Standing, Roster, Deeds, Heritage), highest level first; the top one is pinned.

## Phone
Each row becomes: grip | pill + Pin on the first line | status + toggle on the second.

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.mrows { display: flex; flex-direction: column; }
.mrow { display: grid; grid-template-columns: var(--es-space-24) minmax(0, 1.4fr) minmax(0, 1.3fr) auto auto; gap: var(--es-space-14); align-items: center; padding: var(--es-space-10) var(--es-space-16); border-bottom: var(--es-border-1) solid var(--es-row-sep); }
.mrow:last-child { border-bottom: 0; }
.mrow .drag { color: var(--es-muted); cursor: grab; display: grid; place-items: center; }
.mrow .drag svg { width: var(--es-space-16); height: var(--es-space-16); fill: currentColor; }
.mrow .st { display: flex; flex-direction: column; gap: var(--es-space-4); min-width: 0; font-size: var(--es-fs-12); color: var(--es-muted); }
.mrow.dragging { background: var(--es-raised); box-shadow: var(--es-shadow-toast); }
.pinradio { display: inline-flex; align-items: center; gap: var(--es-space-6); min-height: var(--es-size-control); font-size: var(--es-fs-12-5); color: var(--es-text-2); cursor: pointer; }
.pinradio input { width: var(--es-size-checkbox); height: var(--es-size-checkbox); accent-color: var(--es-accent); margin: 0; }

@media (max-width: 719px) {
  .mrow { grid-template-columns: var(--es-space-24) minmax(0, 1fr) auto; }
  .mrow .st { grid-column: 2; grid-row: 2; }
  .mrow .drag { grid-row: span 2; }
  .mrow .pinradio { grid-column: 3; grid-row: 1; }
  .mrow .toggle { grid-column: 3; grid-row: 2; justify-self: end; }
}
```
