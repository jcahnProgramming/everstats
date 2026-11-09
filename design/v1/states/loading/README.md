# Loading — character lookup in progress

**When:** Character page while the profile is fetched (render not yet available).

**Appears on:** Character page (first load and Refresh); any lookup from the top-bar search. Skeleton rows also apply to leaderboards and guild roster while loading.

**Design:** Name echoes what was searched. Badge `.is-loading`, gear/core stats/render as shimmering skeletons, spinner in the render frame. `aria-busy="true"` on the sheet, `role="status"` message. Shimmer stops under prefers-reduced-motion.

Mockup: `index.html` (open with `?theme=alliance` / `?theme=horde`). Screenshots: `desktop-{forever,alliance,horde}.png` (1440px) and `phone-{forever,alliance,horde}.png` (390px).
