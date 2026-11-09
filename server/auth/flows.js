import { newToken, sha256Hex } from '../credentials/crypto.js';
import { clearCookie, COOKIE, readCookie, setCookie } from './cookies.js';

/**
 * Short-lived state between two requests (auth_flows): an OAuth round trip, a passkey challenge, a merge waiting
 * for confirmation. The browser holds a random token in the flow cookie; the row holds its hash, the purpose, the
 * account it was started from (if any) and its data. A flow is bound to the browser that started it, used once,
 * and gone after FLOW_TTL_MS. One browser has one flow at a time: starting another replaces it.
 */
export const FLOW_TTL_MS = 10 * 60 * 1000;

export async function startFlow(db, res, purpose, { accountId = null, data = {} } = {}) {
  const token = newToken();
  await db.query(
    `INSERT INTO auth_flows (id_hash, purpose, account_id, data, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [sha256Hex(token), purpose, accountId, JSON.stringify(data), String(FLOW_TTL_MS)],
  );
  setCookie(res, COOKIE.flow, token, { maxAgeMs: FLOW_TTL_MS });
}

/** Reads the browser's flow without using it up. Null unless it exists, is unexpired and has one of `purposes`. */
export async function peekFlow(db, req, purposes) {
  const token = readCookie(req, COOKIE.flow);
  if (!token) return null;
  const row = await db.one('SELECT * FROM auth_flows WHERE id_hash = $1 AND expires_at > now()', [sha256Hex(token)]);
  if (!row || !purposes.includes(row.purpose)) return null;
  return { purpose: row.purpose, accountId: row.account_id, data: row.data, idHash: row.id_hash };
}

/** Uses the flow up: deletes it (whatever happens next) and returns it, or null. */
export async function takeFlow(db, req, res, purposes) {
  const token = readCookie(req, COOKIE.flow);
  clearCookie(res, COOKIE.flow);
  if (!token) return null;
  const rows = await db.query('DELETE FROM auth_flows WHERE id_hash = $1 RETURNING *', [sha256Hex(token)]);
  const row = rows[0];
  if (!row || row.expires_at <= new Date() || !purposes.includes(row.purpose)) return null;
  return { purpose: row.purpose, accountId: row.account_id, data: row.data };
}

export async function updateFlowData(db, idHash, data) {
  await db.query('UPDATE auth_flows SET data = $2 WHERE id_hash = $1', [idHash, JSON.stringify(data)]);
}
