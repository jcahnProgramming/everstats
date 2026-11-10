// The design's 35 original stroke icons (design/v1/assets/icons, 24x24, currentColor), generated from the SVG files.
// Regenerate rather than hand-edit. Colour comes from the surrounding text; size from the .ico classes.

const ICONS = {
  'arrow-left': "<path d=\"M19 12H5M11 6l-6 6 6 6\"/>",
  'chart': "<path d=\"M6 20V10M12 20V4M18 20v-7\"/>",
  'check': "<path d=\"M5 12.5l4.5 4.5L19 7.5\"/>",
  'chevron-down': "<path d=\"M6 9l6 6 6-6\"/>",
  'chevron-right': "<path d=\"M9 6l6 6-6 6\"/>",
  'chevron-up': "<path d=\"M6 15l6-6 6 6\"/>",
  'clock': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  'close': "<path d=\"M6 6l12 12M18 6L6 18\"/>",
  'copy': "<rect x=\"8\" y=\"8\" width=\"12\" height=\"12\" rx=\"2\"/><path d=\"M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3\"/>",
  'download': "<path d=\"M12 4v11M7 10l5 5 5-5M5 20h14\"/>",
  'error': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v6M12 16.5h.01\"/>",
  'external': "<path d=\"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/>",
  'filter': "<path d=\"M4 6h16M7 12h10M10 18h4\"/>",
  'guild': "<path d=\"M5 4h14v9l-7 7-7-7z\"/>",
  'info': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7.5h.01\"/>",
  'item-slot': "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\"/>",
  'key': "<circle cx=\"8\" cy=\"9\" r=\"4\"/><path d=\"M11 12h9M17 12v4M20 12v3\"/>",
  'lock': "<rect x=\"5\" y=\"11\" width=\"14\" height=\"9\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/>",
  'menu': "<path d=\"M4 7h16M4 12h16M4 17h16\"/>",
  'no-coverage': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6l12.8 12.8\"/>",
  'passkey': "<circle cx=\"9\" cy=\"8\" r=\"4\"/><path d=\"M3 20c1-3.5 3.3-5.5 6-5.5 1.2 0 2.3.3 3.2 1M17 13a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM17 18v3M17 21h2\"/>",
  'pause': "<path d=\"M9 5v14M15 5v14\"/>",
  'pin': "<path d=\"M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z\"/>",
  'play': "<path d=\"M7 5l12 7-12 7z\"/>",
  'plus': "<path d=\"M12 5v14M5 12h14\"/>",
  'print': "<path d=\"M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z\"/>",
  'provider-account': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 12h8M12 8v8\"/>",
  'provider-chat': "<path d=\"M5 6h14v10H9l-4 3z\"/>",
  'refresh': "<path d=\"M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7\"/>",
  'search': "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.5-3.5\"/>",
  'share': "<path d=\"M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13\"/>",
  'sort': "<path d=\"M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4\"/>",
  'theme': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3a9 9 0 0 0 0 18z\"/>",
  'trend-up': "<path d=\"M3 17l6-6 4 4 8-8M15 7h6v6\"/>",
  'user': "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6\"/>",
  // 0.7.1, from design/v2-guild-badges (the Standing badges' "kept while held" mark).
  'hourglass': "<path d=\"M7 3h10M7 21h10M8 3c0 5 8 6 8 9s-8 4-8 9M16 3c0 5-8 6-8 9s8 4 8 9\"/>",
  // 0.10.3, from design/v5-admin (the admin sidebar, chips and tools).
  'sidebar': "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M9 4v16\"/>",
  'dashboard': "<rect x=\"3\" y=\"3\" width=\"8\" height=\"10\" rx=\"1.5\"/><rect x=\"13\" y=\"3\" width=\"8\" height=\"6\" rx=\"1.5\"/><rect x=\"13\" y=\"11\" width=\"8\" height=\"10\" rx=\"1.5\"/><rect x=\"3\" y=\"15\" width=\"8\" height=\"6\" rx=\"1.5\"/>",
  'inbox': "<path d=\"M3 13l3-8h12l3 8v6H3z\"/><path d=\"M3 13h5l1 3h6l1-3h5\"/>",
  'directory': "<circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5\"/><path d=\"M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.6 3 5.2\"/>",
  'badge': "<path d=\"M12 2.5l2.4 2.1 3.2-.3.6 3.1 2.8 1.6-1.3 2.9 1.3 2.9-2.8 1.6-.6 3.1-3.2-.3L12 21.5l-2.4-2.1-3.2.3-.6-3.1-2.8-1.6 1.3-2.9L3 9.2l2.8-1.6.6-3.1 3.2.3z\"/><path d=\"M9 12l2 2 4-4\"/>",
  'tiers': "<path d=\"M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z\"/><path d=\"M9 15l3-7 3 7M10 12.5h4\"/>",
  'discovery': "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-4-4\"/><path d=\"M11 8v6M8 11h6\"/>",
  'data': "<ellipse cx=\"12\" cy=\"5.5\" rx=\"8\" ry=\"2.5\"/><path d=\"M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13\"/><path d=\"M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5\"/>",
  'retention': "<circle cx=\"12\" cy=\"13\" r=\"8\"/><path d=\"M12 9v4l2.5 2.5M9 2h6M12 2v3\"/>",
  'features': "<rect x=\"2.5\" y=\"5\" width=\"19\" height=\"6\" rx=\"3\"/><circle cx=\"17.5\" cy=\"8\" r=\"1.8\"/><rect x=\"2.5\" y=\"13\" width=\"19\" height=\"6\" rx=\"3\"/><circle cx=\"6.5\" cy=\"16\" r=\"1.8\"/>",
  'settings': "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>",
  'audit': "<path d=\"M6 3h9l4 4v14H6z\"/><path d=\"M15 3v4h4M9 11h7M9 15h7M9 19h4\"/>",
  'sign-out': "<path d=\"M10 4H5v16h5M15 8l4 4-4 4M19 12H9\"/>",
  'globe': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18\"/>",
  'edit': "<path d=\"M4 20l1-4L16 5l3 3L8 19z\"/><path d=\"M14 7l3 3\"/>",
  'eye': "<path d=\"M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  'eye-off': "<path d=\"M3 3l18 18M10.6 6.1c.5-.1.9-.1 1.4-.1 6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.9M6.4 6.9C3.7 8.6 2 12 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1\"/>",
  'archive': "<rect x=\"3\" y=\"4\" width=\"18\" height=\"5\" rx=\"1\"/><path d=\"M5 9v11h14V9M10 13h4\"/>",
  'check-circle': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 12.5l3 3 5-6\"/>",
  'x-circle': "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9 9l6 6M15 9l-6 6\"/>",
  'grip': "<circle cx=\"9\" cy=\"6\" r=\"1.4\"/><circle cx=\"15\" cy=\"6\" r=\"1.4\"/><circle cx=\"9\" cy=\"12\" r=\"1.4\"/><circle cx=\"15\" cy=\"12\" r=\"1.4\"/><circle cx=\"9\" cy=\"18\" r=\"1.4\"/><circle cx=\"15\" cy=\"18\" r=\"1.4\"/>",
  'sync': "<path d=\"M4 7a8 8 0 0 1 14.5-2M20 3v4h-4\"/><path d=\"M20 17a8 8 0 0 1-14.5 2M4 21v-4h4\"/><ellipse cx=\"12\" cy=\"10\" rx=\"4\" ry=\"1.5\"/><path d=\"M8 10v4c0 .8 1.8 1.5 4 1.5s4-.7 4-1.5v-4\"/>",
  'link': "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  'grid': "<rect x=\"4\" y=\"4\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13\" y=\"4\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"4\" y=\"13\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13\" y=\"13\" width=\"7\" height=\"7\" rx=\"1\"/>",
  'shield-check': "<path d=\"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z\"/><path d=\"M8.5 12l2.5 2.5 4.5-5\"/>",
  'reply': "<path d=\"M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6\"/>",
  'flags': "<path d=\"M5 21V4M5 4h8l-1.5 3L13 10H5\"/><path d=\"M19 21V9M19 9h-5l1.2 2.5L14 14h5\"/>",
  'warning': "<path d=\"M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z\"/>",
};

/** <Icon name="search" size="sm" />: an inline design icon. size: sm (16), default (18), md (20), xl (44). */
export function Icon({ name, size, className = '', label }) {
  const cls = ['ico', size, className].filter(Boolean).join(' ');
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label} dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}

export const ICON_NAMES = Object.keys(ICONS);
