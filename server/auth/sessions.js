import { newToken, sha256Hex } from '../credentials/crypto.js';
import { HttpError } from '../core/errors.js';
import { clearCookie, COOKIE, readCookie, setCookie } from './cookies.js';

/**
 * Account sessions. The cookie holds a random token; the database holds only its SHA-256, so a database leak is not
 * a session leak. Every sign-in mints a NEW token (no fixation), and finishing 2FA mints another.
 *
 *   stage 'second_factor'  signed in with Battle.net / Discord on an account with 2FA on, code not yet given. It can
 *                          only answer the 2FA prompt or sign out; everything else treats it as signed out.
 *   stage 'full'           signed in.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SECOND_FACTOR_TTL_MS = 10 * 60 * 1000;

export async function startSession(q, res, accountId, { stage, method }) {
  const token = newToken();
  const ttl = stage === 'full' ? SESSION_TTL_MS : SECOND_FACTOR_TTL_MS;
  await q.query(
    `INSERT INTO sessions (id_hash, account_id, stage, method, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [sha256Hex(token), accountId, stage, method, String(ttl)],
  );
  setCookie(res, COOKIE.session, token, { maxAgeMs: ttl });
  return token;
}

/** Ends the browser's current session, if any (both the row and the cookie). */
export async function endSession(db, req, res) {
  const token = readCookie(req, COOKIE.session);
  if (token) await db.query('DELETE FROM sessions WHERE id_hash = $1', [sha256Hex(token)]);
  clearCookie(res, COOKIE.session);
}

/**
 * Middleware: req.session = { accountId, stage, method, idHash } or null. Expired rows count as none. last_seen_at
 * is refreshed at most every 10 minutes.
 */
export function loadSession(db) {
  return async (req, res, next) => {
    req.session = null;
    const token = readCookie(req, COOKIE.session);
    if (!token) return next();
    const idHash = sha256Hex(token);
    const row = await db.one(
      `SELECT account_id, stage, method, last_seen_at < now() - interval '10 minutes' AS stale
         FROM sessions WHERE id_hash = $1 AND expires_at > now()`,
      [idHash],
    );
    if (!row) {
      clearCookie(res, COOKIE.session);
      return next();
    }
    if (row.stale) await db.query('UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1', [idHash]);
    req.session = { accountId: row.account_id, stage: row.stage, method: row.method, idHash };
    return next();
  };
}

export function requireAccount(req, res, next) {
  if (req.session?.stage !== 'full') return next(new HttpError(401, 'Sign in first.', 'signed_out'));
  return next();
}

export async function logAccountEvent(q, accountId, type, detail = {}) {
  await q.query('INSERT INTO account_events (account_id, type, detail) VALUES ($1, $2, $3)', [accountId, type, JSON.stringify(detail)]);
}
