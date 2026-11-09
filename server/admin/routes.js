import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { newToken, sha256Hex } from '../credentials/crypto.js';
import { listPublic, removeCredential, saveCredential, testCredential } from '../credentials/store.js';
import { clearCookie, COOKIE, readCookie, setCookie } from '../auth/cookies.js';
import { startFlow, takeFlow } from '../auth/flows.js';
import { authenticationOptions, claimedCredentialId, registrationOptions, verifyAuthentication, verifyRegistration } from '../auth/passkeys.js';
import { listSettings, setSetting } from './settings.js';
import { crawlerStatus } from './crawler.js';

/**
 * The admin area, under /api/admin. The admin is NOT an account: one person, passkeys only (admin_passkeys),
 * enrolled with a one-time invite printed on the server (`node server/tools/admin-invite.js` inside the web
 * container). Visitors never see it: no link anywhere, and every admin route answers a plain 404 without an admin
 * session, exactly like a path that doesn't exist. Only enrolment and sign-in answer without one.
 */
export const ADMIN_TTL_MS = 2 * 60 * 60 * 1000;

const notFound = () => new HttpError(404, 'Not found');

async function isAdmin(db, req) {
  const token = readCookie(req, COOKIE.admin);
  if (!token) return false;
  return Boolean(await db.one('SELECT 1 AS x FROM admin_sessions WHERE id_hash = $1 AND expires_at > now()', [sha256Hex(token)]));
}

async function startAdminSession(db, res) {
  const token = newToken();
  await db.query(`INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + ($2 || ' milliseconds')::interval)`, [sha256Hex(token), String(ADMIN_TTL_MS)]);
  setCookie(res, COOKIE.admin, token, { maxAgeMs: ADMIN_TTL_MS, sameSite: 'Strict' });
}

export function createAdminRouter({ db, limits, networkOf, fetch = globalThis.fetch }) {
  const r = express.Router();
  const adminLimit = limitBy(limits.admin, networkOf);
  const writes = limitBy(limits.writes, networkOf);

  // ---- Enrolment: a one-time invite (from the server) → register an admin passkey ----
  r.post('/enroll/options', adminLimit, route(async (req, res) => {
    const token = typeof req.body?.invite === 'string' ? req.body.invite : '';
    const invite = token && (await db.one('SELECT token_hash FROM admin_invites WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256Hex(token)]));
    if (!invite) throw new HttpError(400, 'That invite link is used up or expired. Make a new one on the server.', 'invite_invalid');
    const existing = await db.query('SELECT credential_id, transports FROM admin_passkeys LIMIT 20');
    const options = await registrationOptions({ userId: 'everstats-admin', userName: 'Everstats admin', existing });
    await startFlow(db, res, 'admin_enroll', { data: { challenge: options.challenge, invite: invite.token_hash } });
    res.json({ options });
  }));

  r.post('/enroll/verify', adminLimit, route(async (req, res) => {
    const flow = await takeFlow(db, req, res, ['admin_enroll']);
    if (!flow) throw new HttpError(400, 'That took too long. Open the invite link again.', 'expired');
    const reg = await verifyRegistration(req.body?.response, flow.data.challenge);
    if (!reg) throw new HttpError(400, "The passkey didn't verify.", 'passkey_failed');
    await db.tx(async (q) => {
      const used = await q.query('UPDATE admin_invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING 1', [flow.data.invite]);
      if (used.length !== 1) throw new HttpError(400, 'That invite link is used up or expired.', 'invite_invalid');
      await q.query('INSERT INTO admin_passkeys (credential_id, public_key, sign_count, transports) VALUES ($1, $2, $3, $4)', [reg.credentialId, reg.publicKey, reg.counter, reg.transports]);
      await q.query("INSERT INTO admin_events (type) VALUES ('admin.passkey_enrolled')");
    });
    await startAdminSession(db, res);
    res.json({ ok: true });
  }));

  // ---- Sign-in ----
  r.post('/sign-in/options', adminLimit, route(async (req, res) => {
    const options = await authenticationOptions();
    await startFlow(db, res, 'admin_auth', { data: { challenge: options.challenge } });
    res.json({ options });
  }));

  r.post('/sign-in/verify', adminLimit, route(async (req, res) => {
    const flow = await takeFlow(db, req, res, ['admin_auth']);
    if (!flow) throw new HttpError(400, 'That took too long. Try again.', 'expired');
    const id = claimedCredentialId(req.body?.response);
    const row = id && (await db.one('SELECT * FROM admin_passkeys WHERE credential_id = $1', [id]));
    const counter = row ? await verifyAuthentication(req.body.response, flow.data.challenge, row) : null;
    if (counter === null) throw new HttpError(401, "That passkey isn't an admin passkey.", 'passkey_failed');
    await db.query('UPDATE admin_passkeys SET sign_count = $2, last_used_at = now() WHERE id = $1', [row.id, counter]);
    await startAdminSession(db, res);
    res.json({ ok: true });
  }));

  // ---- Everything below needs an admin session, and 404s without one ----
  r.use(route(async (req, res, next) => {
    if (!(await isAdmin(db, req))) throw notFound();
    next();
  }));

  r.get('/state', route(async (req, res) => {
    res.json({
      credentials: await listPublic(db),
      settings: await listSettings(db),
      crawler: await crawlerStatus(db),
    });
  }));

  r.put('/credentials/:id', writes, route(async (req, res) => res.json({ credential: await saveCredential(db, req.params.id, req.body) })));
  r.delete('/credentials/:id', writes, route(async (req, res) => res.json({ credential: await removeCredential(db, req.params.id) })));
  r.post('/credentials/:id/test', writes, route(async (req, res) => res.json({ result: await testCredential(db, req.params.id, { fetch }) })));

  r.put('/settings/:key', writes, route(async (req, res) => {
    await setSetting(db, req.params.key, req.body?.value);
    res.json({ settings: await listSettings(db) });
  }));

  r.post('/sign-out', route(async (req, res) => {
    const token = readCookie(req, COOKIE.admin);
    if (token) await db.query('DELETE FROM admin_sessions WHERE id_hash = $1', [sha256Hex(token)]);
    clearCookie(res, COOKIE.admin, { sameSite: 'Strict' });
    res.json({ ok: true });
  }));

  return r;
}
