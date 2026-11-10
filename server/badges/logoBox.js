/**
 * Where a badge LOGO sits inside the partner frame (0.10.4). Browser-safe plain data: the site (client/src/badges/art.jsx)
 * and share cards (server/cards/badgeSvg.js) draw from the same numbers, so a logo looks the same everywhere.
 *
 * Every logo badge uses the partner plaque (an octagon, viewBox -3 -3 70 70). With a logo, the drawing keeps ONLY the
 * frame (its rim, fill, metal ring and, on the full-size art, the inner ring: every path whose outline is FRAME_D) and
 * puts the logo in the box below; the template's glyph, monogram or placeholder is left out. The box sits inside the
 * inner ring (full art) or the metal ring (inline art), so the logo never touches the frame; the pill around the badge
 * then gives every badge the same inner box and padding (0.8.2, theme/app.css). 'plate' adds a rounded backing in the
 * partner ink (light in every theme) for a dark logo; its corners are rounded so they stay inside the ring's cut corners.
 */
export const FRAME_D = 'M15 4 H49 L60 15 V49 L49 60 H15 L4 49 V15 Z';

export const LOGO_BOX = Object.freeze({
  full: { none: { x: 15, y: 15, size: 34 }, plate: { x: 16, y: 16, size: 32, plate: { x: 13, y: 13, size: 38, r: 7 } } },
  inline: { none: { x: 10, y: 10, size: 44 }, plate: { x: 11.5, y: 11.5, size: 41, plate: { x: 9, y: 9, size: 46, r: 9 } } },
});

export const logoBox = (inline, backing) => LOGO_BOX[inline ? 'inline' : 'full'][backing === 'plate' ? 'plate' : 'none'];

/** Which re-encoded size to draw for a badge size: 64 px for the 18px inline badge, 128 for pills, 256 for large and cards. */
export const logoSizeFor = (size) => (size === 'inline' ? 64 : size === 'lg' || size === 'xl' || size === 'card' ? 256 : 128);
