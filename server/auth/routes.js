import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { resolveCredential } from '../credentials/store.js';
import { startFlow, takeFlow } from './flows.js';
import { authorizeUrl, exchange, newOAuthState, sameState } from './oauth.js';
import { authenticationOptions, claimedCredentialId, verifyAuthentication } from './passkeys.js';
import { getProvider, PROVIDERS } from './providers.js';
import { endSession, logAccountEvent, startSession } from './sessions.js';
import { checkSecondFactor, totpState } from './totp.js';
import { finishGrant } from '../discovery/grant.js';
import { importAccountCharacters } from '../crawler/account.js';
import { SOURCES } from '../sources/registry.js';

/**
 * Sign-in, under /api/auth, plus the OAuth callbacks under /auth (createCallbackRouter).
 *
 * The rules (CLAUDE.md, "Accounts"):
 *   - Signing in with a provider identity nobody has linked CREATES a new account. Nothing ever links by email,
 *     name or anything else: (provider, subject) is the only key.
 *   - Linking a second provider, and adding a passkey, happen only from Settings while signed in (intent 'link').
 *   - Passkeys sign in to an existing account; they never create one. A passkey sign-in skips the 2FA code.
 *   - With 2FA on, a provider sign-in gives a half session ('second_factor') until the code is given.
 *   - intent 'merge' proves ownership of a second account so the signed-in one can be merged into it.
 *   - intent 'characters' ("Refresh my characters"): re-authorizes a provider ALREADY linked to the signed-in account,
 *     only to read its character list again. It never signs in, links or creates anything.
 *   - 0.4.0: a sign-in, link or 'characters' round trip with a provider that a data source reads characters with
 *     (sources/registry.js userProvider) reads the account's character list with the token, once, then drops the token
 *     (crawler/account.js). A failure there never fails the sign-in: the dashboard says "couldn't check".
 */
const INTENTS = ['sign_in', 'link', 'merge', 'characters'];
const readsCharacters = (providerId) => SOURCES.some((x) => x.userProvider === providerId);

/** A same-site path to go back to after signing in, or '/'. Never another origin, never a protocol-relative URL. */
const safeReturn = (value) => (typeof value === 'string' && /^\/(?![/\\])[\w\-./?=&%~]*$/.test(value) && value.length <= 300 ? value : '/');

export async function providerStatus(db) {
  return Promise.all(
    PROVIDERS.map(async (p) => ({ id: p.id, label: p.label, configured: (await resolveCredential(db, p.credential)).state === 'configured' })),
  );
}

/** One second-factor attempt against both counters; a right code gives both slots back. */
async function secondFactorAttempt({ db, limits, networkOf, req, accountId, code }) {
  const net = limits.secondFactorByNetwork.take(networkOf(req));
  const acct = net && limits.secondFactorByAccount.take(`account:${accountId}`);
  if (!net || !acct) {
    limits.secondFactorByNetwork.refund(net);
    throw new HttpError(429, 'Too many wrong codes. Wait 15 minutes and try again.', 'rate_limited');
  }
  const used = await db.tx((q) => checkSecondFactor(q, accountId, code));
  if (used) {
    limits.secondFactorByNetwork.refund(net);
    limits.secondFactorByAccount.refund(acct);
  }
  return used;
}

export function createAuthRouter({ db, limits, networkOf, fetch = globalThis.fetch }) {
  const r = express.Router();
  const startLimit = limitBy(limits.authStarts, networkOf);

  r.get('/providers', route(async (req, res) => res.json({ providers: await providerStatus(db) })));

  // Starts an OAuth round trip. Answers { url }: the page navigates there (a plain navigation, so no CSP form-action
  // or CORS question arises). 409 not_configured when the provider has no keys yet: the page says so honestly.
  r.post('/:provider/start', startLimit, route(async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) throw new HttpError(404, 'Unknown sign-in provider');
    const intent = INTENTS.includes(req.body?.intent) ? req.body.intent : 'sign_in';
    if (intent !== 'sign_in' && req.session?.stage !== 'full') throw new HttpError(401, 'Sign in first.', 'signed_out');
    if (intent === 'characters' && !readsCharacters(provider.id)) throw new HttpError(400, `${provider.label} can't list characters.`, 'invalid');
    const cred = await resolveCredential(db, provider.credential);
    if (cred.state !== 'configured') throw new HttpError(409, `${provider.label} sign-in isn't configured yet.`, 'not_configured');
    const { state, verifier } = newOAuthState(provider);
    await startFlow(db, res, 'oauth', {
      accountId: intent === 'sign_in' ? null : req.session.accountId,
      data: { provider: provider.id, intent, state, verifier, returnTo: safeReturn(req.body?.returnTo) },
    });
    res.json({ url: authorizeUrl(provider, cred.values.clientId, { state, verifier }) });
  }));

  // Passkey sign-in (and passkey proof for a merge). Discoverable credentials: the browser offers the passkeys it has.
  r.post('/passkey/options', startLimit, route(async (req, res) => {
    const intent = req.body?.intent === 'merge' ? 'merge' : 'sign_in';
    if (intent === 'merge' && req.session?.stage !== 'full') throw new HttpError(401, 'Sign in first.', 'signed_out');
    const options = await authenticationOptions();
    await startFlow(db, res, 'passkey_auth', {
      accountId: intent === 'merge' ? req.session.accountId : null,
      data: { challenge: options.challenge, intent },
    });
    res.json({ options });
  }));

  r.post('/passkey/verify', route(async (req, res) => {
    const flow = await takeFlow(db, req, res, ['passkey_auth']);
    if (!flow) throw new HttpError(400, 'That sign-in took too long. Try again.', 'expired');
    const credentialId = claimedCredentialId(req.body?.response);
    const row = credentialId && (await db.one('SELECT * FROM passkeys WHERE credential_id = $1', [credentialId]));
    // Same answer for "no such passkey" and "didn't verify": an assertion is not a way to probe which passkeys exist.
    const counter = row ? await verifyAuthentication(req.body.response, flow.data.challenge, row) : null;
    if (counter === null) throw new HttpError(401, "That passkey isn't registered with Everstats, or didn't verify.", 'passkey_failed');

    await db.query('UPDATE passkeys SET sign_count = $2, last_used_at = now() WHERE id = $1', [row.id, counter]);
    if (flow.data.intent === 'merge') {
      if (req.session?.stage !== 'full' || req.session.accountId !== flow.accountId) throw new HttpError(401, 'Sign in first.', 'signed_out');
      if (row.account_id === flow.accountId) throw new HttpError(400, "That passkey belongs to the account you're signed in to.", 'same_account');
      await startFlow(db, res, 'merge', { accountId: flow.accountId, data: { target: row.account_id, via: 'passkey', needsCode: false } });
      return res.json({ next: '/settings/merge' });
    }
    await db.tx(async (q) => {
      await startSession(q, res, row.account_id, { stage: 'full', method: 'passkey' });
      await logAccountEvent(q, row.account_id, 'signed_in', { method: 'passkey' });
    });
    return res.json({ next: '/' });
  }));

  // The 2FA prompt after a provider sign-in. A TOTP code or a recovery code.
  r.post('/second-factor', route(async (req, res) => {
    if (req.session?.stage !== 'second_factor') throw new HttpError(401, 'That sign-in expired. Sign in again.', 'signed_out');
    const { accountId, method } = req.session;
    const used = await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code });
    if (!used) throw new HttpError(401, "That code isn't right. Check your authenticator app's clock, or use a recovery code.", 'wrong_code');
    await db.tx(async (q) => {
      await q.query('DELETE FROM sessions WHERE id_hash = $1', [req.session.idHash]);
      await startSession(q, res, accountId, { stage: 'full', method });
      await logAccountEvent(q, accountId, 'second_factor_passed', { with: used });
    });
    res.json({ ok: true, usedRecoveryCode: used === 'recovery_code' });
  }));

  r.post('/sign-out', route(async (req, res) => {
    await endSession(db, req, res);
    res.json({ ok: true });
  }));

  return r;
}

export { secondFactorAttempt };

/**
 * GET /auth/<provider>/callback: where Battle.net and Discord send the browser back. Always ends in a redirect to a
 * page that explains the outcome (?error=<code> or a success marker): never a raw error page.
 */
export function createCallbackRouter({ db, fetch = globalThis.fetch }) {
  const r = express.Router();

  r.get('/:provider/callback', route(async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.redirect(303, '/sign-in?error=unknown_provider');
    const flow = await takeFlow(db, req, res, ['oauth']);
    const back = (intent, error) => res.redirect(303, `${intent === 'sign_in' ? '/sign-in' : '/settings'}?error=${error}`);
    if (!flow || flow.data.provider !== provider.id) return back('sign_in', 'expired');
    const { intent } = flow.data;
    // The admin's discovery authorization (discovery/grant.js): only an admin request can start one. It ends on the
    // Discovery page and never touches accounts or sessions.
    if (intent === 'discovery') return finishGrant({ db, provider, flow, req, res, fetch });
    if (typeof req.query.error === 'string') return back(intent, 'cancelled');
    if (!sameState(req.query.state, flow.data.state) || typeof req.query.code !== 'string') return back(intent, 'state_mismatch');

    const cred = await resolveCredential(db, provider.credential);
    if (cred.state !== 'configured') return back(intent, 'not_configured');
    let identity;
    let token;
    try {
      token = await exchange(provider, cred.values, req.query.code, flow.data.verifier, { fetch });
      identity = await provider.identity(token, { fetch });
    } catch (err) {
      console.warn(`[auth] ${provider.id} sign-in failed: ${err.code ?? err.name}`);
      return back(intent, 'provider_failed');
    }

    const existing = await db.one('SELECT id, account_id FROM account_identities WHERE provider = $1 AND subject = $2', [provider.id, identity.subject]);
    // Reads the account's characters with this token (once), if this provider can; then the token goes out of scope.
    const bringCharacters = async (accountId) => {
      if (!readsCharacters(provider.id)) return null;
      try {
        return await importAccountCharacters({ db, accountId, providerId: provider.id, userToken: token, fetch });
      } catch (err) {
        console.warn(`[auth] reading characters after ${provider.id} failed: ${err.code ?? err.name}`);
        return null;
      }
    };

    if (intent === 'characters') {
      if (req.session?.stage !== 'full' || req.session.accountId !== flow.accountId) return back('sign_in', 'expired');
      if (!existing || existing.account_id !== flow.accountId) return res.redirect(303, '/?error=characters_other_account');
      await bringCharacters(flow.accountId);
      return res.redirect(303, '/?characters=refreshed');
    }

    if (intent === 'link') {
      if (req.session?.stage !== 'full' || req.session.accountId !== flow.accountId) return back('sign_in', 'expired');
      if (existing && existing.account_id === flow.accountId) return res.redirect(303, `/settings?linked=${provider.id}`);
      if (existing) return back('link', 'linked_elsewhere');
      await db.tx(async (q) => {
        await q.query('INSERT INTO account_identities (account_id, provider, subject, display_name, last_used_at) VALUES ($1, $2, $3, $4, now())', [flow.accountId, provider.id, identity.subject, identity.displayName]);
        await logAccountEvent(q, flow.accountId, 'identity.linked', { provider: provider.id });
      });
      await bringCharacters(flow.accountId);
      return res.redirect(303, `/settings?linked=${provider.id}`);
    }

    if (intent === 'merge') {
      if (req.session?.stage !== 'full' || req.session.accountId !== flow.accountId) return back('sign_in', 'expired');
      if (!existing) return back('merge', 'merge_no_account');
      if (existing.account_id === flow.accountId) return back('merge', 'same_account');
      const needsCode = (await totpState(db, existing.account_id)).state === 'enabled';
      await startFlow(db, res, 'merge', { accountId: flow.accountId, data: { target: existing.account_id, via: provider.id, needsCode } });
      return res.redirect(303, '/settings/merge');
    }

    // Sign in, or create an account for an identity nobody has linked.
    const accountId = await db.tx(async (q) => {
      let id = existing?.account_id;
      if (id) {
        await q.query('UPDATE account_identities SET display_name = $2, last_used_at = now() WHERE id = $1', [existing.id, identity.displayName]);
      } else {
        id = (await q.one('INSERT INTO accounts DEFAULT VALUES RETURNING id')).id;
        await q.query('INSERT INTO account_identities (account_id, provider, subject, display_name, last_used_at) VALUES ($1, $2, $3, $4, now())', [id, provider.id, identity.subject, identity.displayName]);
        await logAccountEvent(q, id, 'account.created', { provider: provider.id });
      }
      const twoFactor = (await totpState(q, id)).state === 'enabled';
      await startSession(q, res, id, { stage: twoFactor ? 'second_factor' : 'full', method: provider.id });
      await logAccountEvent(q, id, twoFactor ? 'signed_in_awaiting_code' : 'signed_in', { method: provider.id });
      return { id, twoFactor };
    });
    const imported = await bringCharacters(accountId.id);
    // 0.7.0: account-level badges (Beta Tester, Early Supporter) on every sign-in; the character import above already
    // evaluated everything when it ran (a Discord sign-in reads no characters).
    if (!imported || imported.outcome !== 'ok') {
      const { evaluateQuietly } = await import('../badges/rules.js');
      await evaluateQuietly(db, accountId.id);
    }
    const next = flow.data.returnTo ?? '/';
    if (accountId.twoFactor) return res.redirect(303, `/sign-in/2fa?next=${encodeURIComponent(next)}`);
    return res.redirect(303, next);
  }));

  return r;
}

