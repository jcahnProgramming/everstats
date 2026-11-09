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
