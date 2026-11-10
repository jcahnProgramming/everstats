/**
 * Grids that fill their rows (0.9.2). An auto-fill grid leaves the last row short ("Camping & Hearth" alone on a second
 * row, an empty slot after the count cards, one lonely guild card next to a big gap). A `.fillgrid` is a wrapping flex
 * row: each item's basis is one column of `cols` (minus the gaps), and the items of a short last row grow to share its
 * whole width, so every row is full. Full rows don't grow (their bases already add up to the width), so they stay equal.
 * Columns are chosen per breakpoint by the caller, never more than there are items:
 *   lg  ≥ 1100 px · md 720–1099 px · sm < 720 px (the site's breakpoints).
 *
 *   <div className="fillgrid">{items.map((x) => <div style={fillStyle(items.length, { lg: 5, md: 3, sm: 2 })} … />)}</div>
 *
 * (A first version used a 60-track CSS grid: its 59 column gaps alone were wider than a phone.) Styles go through the
 * CSSOM (React style objects), which the CSP allows; the column counts are custom properties read by theme/app.css.
 */
export const fillCols = (n, cols) => Math.max(1, Math.min(cols, n));

export const fillStyle = (n, { lg, md, sm }) => ({ '--fg-lg': fillCols(n, lg), '--fg-md': fillCols(n, md), '--fg-sm': fillCols(n, sm) });
