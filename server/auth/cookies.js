import { config } from '../core/config.js';

/**
 * Cookie names and attributes in one place. Over HTTPS (production) every cookie uses the __Host- prefix: the
 * browser then refuses it unless it is Secure, Path=/ and has no Domain, so nothing on another subdomain can plant
 * or read one. Local dev over http://localhost uses the plain names.
 *
 *   session  the signed-in account     httpOnly, SameSite=Lax (the OAuth callback is a cross-site top-level GET
 *                                       that must carry the flow cookie; Lax allows exactly that, nothing more)
 *   flow     one in-progress sign-in   httpOnly, SameSite=Lax, 10 minutes
 *   admin    the admin session          httpOnly, SameSite=Strict, 2 hours
 *
 * CSRF does not rely on SameSite alone: every state-changing /api request must carry this site's Origin
 * (core/sameOrigin.js).
 */
const prefix = config.secureCookies ? '__Host-' : '';
export const COOKIE = {
  session: `${prefix}es_session`,
  flow: `${prefix}es_flow`,
  admin: `${prefix}es_admin`,
};

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function setCookie(res, name, value, { maxAgeMs, sameSite = 'Lax' }) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: sameSite.toLowerCase(),
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearCookie(res, name, { sameSite = 'Lax' } = {}) {
  res.clearCookie(name, { httpOnly: true, secure: config.secureCookies, sameSite: sameSite.toLowerCase(), path: '/' });
}
