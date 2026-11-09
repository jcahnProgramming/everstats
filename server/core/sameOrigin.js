import { HttpError } from './errors.js';

/**
 * CSRF protection for every state-changing /api request (anything but GET, HEAD, OPTIONS): the browser's Origin
 * header must be exactly PUBLIC_ORIGIN. Browsers always send Origin on a cross-origin or non-GET fetch, and a page
 * on another site can't forge it. A request with no Origin at all is refused too: that is a script, not a browser
 * on this site. SameSite cookies are a second layer, not the protection.
 *
 * The OAuth callbacks (/auth/*) are GETs and are protected by their state parameter and flow cookie instead.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireSameOrigin(publicOrigin) {
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    if (req.headers.origin === publicOrigin) return next();
    return next(new HttpError(403, 'This request has to come from the Everstats site itself.', 'cross_origin'));
  };
}
