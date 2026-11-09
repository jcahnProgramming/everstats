/**
 * Security headers on every answer from the web app (pages, API, /api/health).
 *
 * The client is built by Vite into same-origin files: scripts (the theme boot is /api/theme-boot.js, not inline),
 * stylesheets and fonts. Nothing is ever loaded from another origin. Sign-in sends the browser to Battle.net or
 * Discord with a plain navigation (location.assign), which CSP doesn't govern.
 *
 * Differences from next-up, on purpose:
 *   - Permissions-Policy ALLOWS publickey-credentials-get/create for this origin: next-up denies them, which would
 *     switch passkeys off entirely.
 *   - Referrer-Policy is same-origin (next-up: no-referrer, because its URLs held board keys). Everstats URLs are
 *     public character names; same-origin still tells no other site anything.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // Character renders come from Blizzard's render host (character-media), and only from there (crawler/parse.js).
  "img-src 'self' data: https://render.worldofwarcraft.com",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': [
    'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()', 'geolocation=()', 'gyroscope=()',
    'magnetometer=()', 'microphone=()', 'midi=()', 'payment=()', 'usb=()', 'browsing-topics=()',
    'publickey-credentials-get=(self)', 'publickey-credentials-create=(self)',
  ].join(', '),
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function securityHeaders({ hsts = false } = {}) {
  const headers = hsts ? { ...SECURITY_HEADERS, 'Strict-Transport-Security': 'max-age=31536000' } : SECURITY_HEADERS;
  return (req, res, next) => {
    res.set(headers);
    next();
  };
}
