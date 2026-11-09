import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { keyedHash, open, seal } from '../credentials/crypto.js';
import { HttpError } from '../core/errors.js';

/**
 * TOTP 2FA (RFC 6238: SHA-1, 6 digits, 30 s, the defaults every authenticator app understands) and recovery codes.
 *
 * - The secret is sealed with the root key in account_totp (slot "totp.<account id>").
 * - A code is accepted one step either side of now (clock drift), and never twice: last_step only moves forward.
 * - Recovery codes: 10, each 10 characters from an alphabet with no look-alikes, shown exactly once when 2FA is
 *   turned on (or regenerated). Only an HMAC of each is stored; a used one is marked, never reusable.
 */
const PERIOD = 30;
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const slot = (accountId) => `totp.${accountId}`;
const totpFor = (secretBase32, label = 'Everstats') =>
  new OTPAuth.TOTP({ issuer: 'Everstats', label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret: OTPAuth.Secret.fromBase32(secretBase32) });

export async function totpState(q, accountId) {
  const row = await q.one('SELECT state, enabled_at FROM account_totp WHERE account_id = $1', [accountId]);
  return row ? { state: row.state, enabledAt: row.enabled_at } : { state: 'off', enabledAt: null };
}

/** Starts (or restarts) setup: a new pending secret. Refused while 2FA is on. */
export async function beginSetup(q, accountId) {
  const current = await totpState(q, accountId);
  if (current.state === 'enabled') throw new HttpError(409, '2FA is already on.', 'already_enabled');
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const s = seal(slot(accountId), secret);
  await q.query(
    `INSERT INTO account_totp (account_id, state, ciphertext, iv, auth_tag, key_fp) VALUES ($1, 'pending', $2, $3, $4, $5)
     ON CONFLICT (account_id) DO UPDATE SET state = 'pending', ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag, key_fp = EXCLUDED.key_fp, last_step = 0, created_at = now(), enabled_at = NULL`,
    [accountId, s.ciphertext, s.iv, s.authTag, s.keyFp],
  );
  const uri = totpFor(secret, `Account ${accountId}`).toString();
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}` };
}

/**
 * Checks a 6-digit code against the account's secret in `wantState`. On success records the step (so it can't be
 * replayed) and returns true. Call inside a transaction: the row is locked while checking.
 */
export async function checkCode(q, accountId, code, { wantState = 'enabled', now = Date.now() } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.replace(/\s/g, ''))) return false;
  const row = await q.one('SELECT * FROM account_totp WHERE account_id = $1 FOR UPDATE', [accountId]);
  if (!row || row.state !== wantState) return false;
  const secret = open(slot(accountId), { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyFp: row.key_fp });
  const delta = totpFor(secret).validate({ token: code.replace(/\s/g, ''), timestamp: now, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(now / 1000 / PERIOD) + delta;
  if (step <= Number(row.last_step)) return false;
  await q.query('UPDATE account_totp SET last_step = $2 WHERE account_id = $1', [accountId, step]);
  return true;
}

function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const normalizeRecovery = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Replaces the account's recovery codes with a fresh set and returns them (the only time they are ever readable). */
export async function issueRecoveryCodes(q, accountId) {
  await q.query('DELETE FROM recovery_codes WHERE account_id = $1', [accountId]);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  for (const code of codes) {
    await q.query('INSERT INTO recovery_codes (account_id, code_hash) VALUES ($1, $2)', [accountId, keyedHash('recovery', normalizeRecovery(code))]);
  }
  return codes;
}

/** Uses a recovery code if it is one of the account's unused ones. */
export async function useRecoveryCode(q, accountId, code) {
  const norm = normalizeRecovery(code);
  if (norm.length !== 10) return false;
  const rows = await q.query(
    'UPDATE recovery_codes SET used_at = now() WHERE account_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
    [accountId, keyedHash('recovery', norm)],
  );
  return rows.length === 1;
}

export async function recoveryCodesLeft(q, accountId) {
  const row = await q.one('SELECT count(*)::int AS n FROM recovery_codes WHERE account_id = $1 AND used_at IS NULL', [accountId]);
  return row.n;
}

/** A 6-digit code or a recovery code, whichever it looks like. */
export async function checkSecondFactor(q, accountId, code) {
  const clean = String(code ?? '').trim();
  if (/^\d{3}\s?\d{3}$/.test(clean)) return (await checkCode(q, accountId, clean)) ? 'totp' : null;
  return (await useRecoveryCode(q, accountId, clean)) ? 'recovery_code' : null;
}
