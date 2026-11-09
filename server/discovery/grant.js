import { HttpError } from '../core/errors.js';
import { open, seal } from '../credentials/crypto.js';
import { resolveCredential } from '../credentials/store.js';
import { startFlow } from '../auth/flows.js';
import { authorizeUrl, exchangeForToken, newOAuthState, sameState } from '../auth/oauth.js';
import { getProvider } from '../auth/providers.js';
import { getSource } from '../sources/registry.js';

/**
 * The admin's Battle.net authorization for discovery: a user token that reads /profile/user/wow (scope wow.profile).
 *
 * Why not the token from the admin's own Everstats sign-in: sign-in uses its token once for the identity call and
 * drops it (auth/oauth.js), and the admin isn't an account anyway. So discovery asks for its own, from the admin
 * page, through the same registered callback (/auth/battlenet/callback) with the OAuth intent 'discovery':
 *
 *   1. POST /api/admin/discovery/authorize (admin session) → an 'oauth' flow with intent 'discovery' → { url }
 *   2. Battle.net → /auth/battlenet/callback. The admin cookie is SameSite=Strict, so it doesn't arrive on that
 *      cross-site redirect; the proof is the flow itself: only an admin request can create a 'discovery' flow, and
 *      the flow is bound to that browser, used once and gone after 10 minutes.
 *   3. The token is sealed with the root key into discovery_grants (one at a time) and lives until it expires
 *      (Battle.net: ~24 h), deleted by sweepExpired. It is never sent to a browser or logged.
 */
const SOURCE = getSource('blizzard');
const provider = () => getProvider(SOURCE.userProvider);
const slot = (id) => `discovery.grant.${id}`;
export const DISCOVERY_RETURN = '/admin/discovery';

export async function startGrant(db, res) {
  const p = provider();
  const cred = await resolveCredential(db, p.credential);
  if (cred.state !== 'configured') throw new HttpError(409, `${p.label} keys aren't configured yet.`, 'not_configured');
  const { state, verifier } = newOAuthState(p);
  await startFlow(db, res, 'oauth', { data: { provider: p.id, intent: 'discovery', state, verifier, returnTo: DISCOVERY_RETURN } });
  return authorizeUrl(p, cred.values.clientId, { state, verifier });
}

/** The callback's 'discovery' branch (auth/routes.js). Always ends in a redirect to the Discovery page. */
export async function finishGrant({ db, provider: p, flow, req, res, fetch }) {
  const back = (error) => res.redirect(303, `${DISCOVERY_RETURN}?${error ? `error=${error}` : 'authorized=1'}`);
  if (typeof req.query.error === 'string') return back('cancelled');
  if (!sameState(req.query.state, flow.data.state) || typeof req.query.code !== 'string') return back('state_mismatch');
  const cred = await resolveCredential(db, p.credential);
  if (cred.state !== 'configured') return back('not_configured');
  let tokenResponse;
  let identity;
  try {
    tokenResponse = await exchangeForToken(p, cred.values, req.query.code, flow.data.verifier, { fetch });
    identity = await p.identity(tokenResponse.access_token, { fetch });
  } catch (err) {
    console.warn(`[discovery] ${p.id} authorization failed: ${err.code ?? err.name}`);
    return back('provider_failed');
  }
  const seconds = Math.min(Math.max(Number(tokenResponse.expires_in) || 3600, 60), 7 * 24 * 3600);
  await db.tx(async (q) => {
    await q.query('DELETE FROM discovery_grants');
    const row = await q.one(
      `INSERT INTO discovery_grants (battletag, ciphertext, iv, auth_tag, key_fp, scope, expires_at)
       VALUES ($1, '\\x00', '\\x00', '\\x00', '', $2, now() + ($3 || ' seconds')::interval) RETURNING id`,
      [identity.displayName, String(tokenResponse.scope ?? '').slice(0, 200), String(seconds)],
    );
    const s = seal(slot(row.id), tokenResponse.access_token);
    await q.query('UPDATE discovery_grants SET ciphertext = $2, iv = $3, auth_tag = $4, key_fp = $5 WHERE id = $1', [row.id, s.ciphertext, s.iv, s.authTag, s.keyFp]);
    await q.query("INSERT INTO admin_events (type) VALUES ('discovery.authorized')");
  });
  return back(null);
}

/** For the page: who authorized and until when. Never the token. */
export async function grantStatus(db) {
  const row = await db.one('SELECT battletag, scope, created_at, expires_at FROM discovery_grants WHERE expires_at > now() ORDER BY id DESC LIMIT 1');
  return row ? { battletag: row.battletag, scope: row.scope, createdAt: row.created_at, expiresAt: row.expires_at } : null;
}

/** For the worker: the live token, or null (none, expired, or sealed under another root key). */
export async function grantToken(db) {
  const row = await db.one('SELECT * FROM discovery_grants WHERE expires_at > now() ORDER BY id DESC LIMIT 1');
  if (!row) return null;
  try {
    return { token: open(slot(row.id), { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyFp: row.key_fp }), battletag: row.battletag, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}

export async function forgetGrant(db) {
  await db.tx(async (q) => {
    await q.query('DELETE FROM discovery_grants');
    await q.query("INSERT INTO admin_events (type) VALUES ('discovery.forgotten')");
  });
}
