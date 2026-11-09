import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { peekFlow, startFlow, takeFlow, updateFlowData } from '../auth/flows.js';
import { registrationOptions, verifyRegistration } from '../auth/passkeys.js';
import { getProvider } from '../auth/providers.js';
import { providerStatus, secondFactorAttempt } from '../auth/routes.js';
import { logAccountEvent, requireAccount, startSession } from '../auth/sessions.js';
import { beginSetup, checkCode, issueRecoveryCodes, recoveryCodesLeft, totpState } from '../auth/totp.js';
import { MERGE_STEPS, mergeAccounts } from './merge.js';

/** The three themes. Logged-out visitors always get Forever; a signed-in account's choice is stored on it. */
export const THEMES = ['forever', 'alliance', 'horde'];

const MAX_PASSKEYS = 20;

async function accountView(db, accountId) {
  const account = await db.one('SELECT id, created_at, theme FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw new HttpError(401, 'Sign in first.', 'signed_out');
  const identities = await db.query(
    'SELECT id, provider, display_name, linked_at, last_used_at FROM account_identities WHERE account_id = $1 ORDER BY linked_at LIMIT 20',
    [accountId],
  );
  const passkeys = await db.query(
    'SELECT id, name, created_at, last_used_at FROM passkeys WHERE account_id = $1 ORDER BY created_at LIMIT $2',
    [accountId, MAX_PASSKEYS],
  );
  const totp = await totpState(db, accountId);
  return {
    id: account.id,
    createdAt: account.created_at,
    theme: account.theme,
    identities: identities.map((i) => ({
      id: i.id,
      provider: i.provider,
      label: getProvider(i.provider)?.label ?? i.provider,
      displayName: i.display_name,
      linkedAt: i.linked_at,
      lastUsedAt: i.last_used_at,
    })),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, createdAt: p.created_at, lastUsedAt: p.last_used_at })),
    twoFactor: {
      state: totp.state === 'enabled' ? 'on' : 'off',
      enabledAt: totp.enabledAt,
      recoveryCodesLeft: totp.state === 'enabled' ? await recoveryCodesLeft(db, accountId) : 0,
    },
  };
}

/** How many ways the account has to sign in: providers + passkeys. Removing the last one is refused. */
async function signInMethods(q, accountId) {
  const row = await q.one(
    `SELECT (SELECT count(*) FROM account_identities WHERE account_id = $1)::int
          + (SELECT count(*) FROM passkeys WHERE account_id = $1)::int AS n`,
    [accountId],
  );
  return row.n;
}

export function createAccountRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const starts = limitBy(limits.authStarts, networkOf);

  // Public: who this browser is signed in as (if anyone), its theme, and which providers can sign in.
  r.get('/session', route(async (req, res) => {
    const providers = await providerStatus(db);
    if (!req.session) return res.json({ signedIn: false, stage: null, theme: 'forever', providers });
    if (req.session.stage !== 'full') return res.json({ signedIn: false, stage: req.session.stage, theme: 'forever', providers });
    const account = await db.one('SELECT theme FROM accounts WHERE id = $1', [req.session.accountId]);
    return res.json({ signedIn: true, stage: 'full', theme: account?.theme ?? 'forever', providers });
  }));

  r.use('/account', requireAccount);

  r.get('/account', route(async (req, res) => res.json({ account: await accountView(db, req.session.accountId) })));

  r.put('/account/theme', writes, route(async (req, res) => {
    const theme = req.body?.theme;
    if (!THEMES.includes(theme)) throw new HttpError(400, 'Unknown theme', 'invalid');
    await db.query('UPDATE accounts SET theme = $2 WHERE id = $1', [req.session.accountId, theme]);
    res.json({ theme });
  }));

  r.delete('/account/identities/:id', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (q) => {
      await q.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [req.session.accountId]);
      const row = await q.one('SELECT provider FROM account_identities WHERE id = $1 AND account_id = $2', [id, req.session.accountId]);
      if (!row) throw new HttpError(404, 'That sign-in method is not on this account.');
      if ((await signInMethods(q, req.session.accountId)) <= 1) {
        throw new HttpError(409, "That's the only way into this account. Link another provider or add a passkey first.", 'last_method');
      }
      await q.query('DELETE FROM account_identities WHERE id = $1', [id]);
      await logAccountEvent(q, req.session.accountId, 'identity.unlinked', { provider: row.provider });
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // ---- Passkeys (added only here, while signed in) ----
  r.post('/account/passkeys/options', starts, route(async (req, res) => {
    const existing = await db.query('SELECT credential_id, transports FROM passkeys WHERE account_id = $1 LIMIT $2', [req.session.accountId, MAX_PASSKEYS]);
    if (existing.length >= MAX_PASSKEYS) throw new HttpError(409, `An account can have up to ${MAX_PASSKEYS} passkeys.`, 'too_many');
    const options = await registrationOptions({
      userId: `account:${req.session.accountId}`,
      userName: `Everstats account ${req.session.accountId}`,
      existing,
    });
    await startFlow(db, res, 'passkey_register', { accountId: req.session.accountId, data: { challenge: options.challenge } });
    res.json({ options });
  }));

  r.post('/account/passkeys/verify', writes, route(async (req, res) => {
    const flow = await takeFlow(db, req, res, ['passkey_register']);
    if (!flow || flow.accountId !== req.session.accountId) throw new HttpError(400, 'That took too long. Try again.', 'expired');
    const reg = await verifyRegistration(req.body?.response, flow.data.challenge);
    if (!reg) throw new HttpError(400, "The passkey didn't verify. Try again.", 'passkey_failed');
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 60) : 'Passkey';
    await db.tx(async (q) => {
      const taken = await q.one('SELECT 1 AS x FROM passkeys WHERE credential_id = $1', [reg.credentialId]);
      if (taken) throw new HttpError(409, 'That passkey is already registered.', 'duplicate');
      await q.query(
        'INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.session.accountId, reg.credentialId, reg.publicKey, reg.counter, reg.transports, name],
      );
      await logAccountEvent(q, req.session.accountId, 'passkey.added', {});
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  r.delete('/account/passkeys/:id', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (q) => {
      await q.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [req.session.accountId]);
      const row = await q.one('SELECT 1 AS x FROM passkeys WHERE id = $1 AND account_id = $2', [id, req.session.accountId]);
      if (!row) throw new HttpError(404, 'That passkey is not on this account.');
      if ((await signInMethods(q, req.session.accountId)) <= 1) {
        throw new HttpError(409, "That's the only way into this account. Link a provider first.", 'last_method');
      }
      await q.query('DELETE FROM passkeys WHERE id = $1', [id]);
      await logAccountEvent(q, req.session.accountId, 'passkey.removed', {});
    });
    res.json({ account: await accountView(db, req.session.accountId) });
  }));

  // ---- 2FA ----
  r.post('/account/2fa/setup', writes, route(async (req, res) => {
    const setup = await db.tx((q) => beginSetup(q, req.session.accountId));
    res.json({ setup });
  }));

  // Confirms setup with a first code. Answers the recovery codes: the ONLY time they are ever shown.
  r.post('/account/2fa/enable', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    const codes = await db.tx(async (q) => {
      if (!(await checkCode(q, accountId, req.body?.code, { wantState: 'pending' }))) return null;
      await q.query("UPDATE account_totp SET state = 'enabled', enabled_at = now() WHERE account_id = $1", [accountId]);
      await logAccountEvent(q, accountId, 'two_factor.enabled', {});
      return issueRecoveryCodes(q, accountId);
    });
    if (!codes) throw new HttpError(400, "That code isn't right. Check your authenticator app and try the newest code.", 'wrong_code');
    res.json({ recoveryCodes: codes, account: await accountView(db, accountId) });
  }));

  r.post('/account/2fa/disable', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right.", 'wrong_code');
    }
    await db.tx(async (q) => {
      await q.query('DELETE FROM account_totp WHERE account_id = $1', [accountId]);
      await q.query('DELETE FROM recovery_codes WHERE account_id = $1', [accountId]);
      await logAccountEvent(q, accountId, 'two_factor.disabled', {});
    });
    res.json({ account: await accountView(db, accountId) });
  }));

  r.post('/account/2fa/recovery-codes', writes, route(async (req, res) => {
    const accountId = req.session.accountId;
    if ((await totpState(db, accountId)).state !== 'enabled') throw new HttpError(409, '2FA is off.', 'not_enabled');
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right.", 'wrong_code');
    }
    const codes = await db.tx(async (q) => {
      await logAccountEvent(q, accountId, 'recovery_codes.regenerated', {});
      return issueRecoveryCodes(q, accountId);
    });
    res.json({ recoveryCodes: codes, account: await accountView(db, accountId) });
  }));

  // ---- Merge this account into another ----
  const mergeFlow = async (req) => {
    const flow = await peekFlow(db, req, ['merge']);
    return flow && flow.accountId === req.session.accountId ? flow : null;
  };

  r.get('/account/merge', route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) return res.json({ merge: null, steps: MERGE_STEPS.map((s) => s.describe) });
    const target = await accountView(db, flow.data.target);
    return res.json({
      merge: {
        via: flow.data.via,
        needsCode: flow.data.needsCode,
        target: { id: target.id, createdAt: target.createdAt, identities: target.identities.map((i) => ({ label: i.label, displayName: i.displayName })), passkeys: target.passkeys.length },
      },
      steps: MERGE_STEPS.map((s) => s.describe),
    });
  }));

  r.post('/account/merge/code', route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) throw new HttpError(400, 'That merge expired. Start again.', 'expired');
    if (!flow.data.needsCode) return res.json({ ok: true });
    if (!(await secondFactorAttempt({ db, limits, networkOf, req, accountId: flow.data.target, code: req.body?.code }))) {
      throw new HttpError(401, "That code isn't right for the other account.", 'wrong_code');
    }
    await updateFlowData(db, flow.idHash, { ...flow.data, needsCode: false });
    res.json({ ok: true });
  }));

  r.post('/account/merge/confirm', writes, route(async (req, res) => {
    const flow = await mergeFlow(req);
    if (!flow) throw new HttpError(400, 'That merge expired. Start again.', 'expired');
    if (flow.data.needsCode) throw new HttpError(401, "Enter the other account's 2FA code first.", 'needs_code');
    await takeFlow(db, req, res, ['merge']);
    const source = req.session.accountId;
    const target = flow.data.target;
    await db.tx(async (q) => {
      await mergeAccounts(q, source, target);
      await startSession(q, res, target, { stage: 'full', method: flow.data.via });
    });
    res.json({ ok: true, account: await accountView(db, target) });
  }));

  r.delete('/account/merge', route(async (req, res) => {
    if (await mergeFlow(req)) await takeFlow(db, req, res, ['merge']);
    res.json({ ok: true });
  }));

  return r;
}

