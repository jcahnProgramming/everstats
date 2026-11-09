import { HttpError } from '../core/errors.js';
import { logAccountEvent } from '../auth/sessions.js';
import { checkUsername, normalForms } from './names.js';

/**
 * Claiming, renaming and the admin's grant / reclaim. Every change is one transaction that locks the account row and
 * writes username_history; nothing here touches sessions, sign-in links, passkeys, 2FA, characters, pins or beta
 * membership (all keyed by account id, never by name).
 *
 *   claim    the first chosen name: free, no allowance used
 *   rename   any later change: uses one rename_allowance; the old name is held HOLD_DAYS and /u/{old} redirects
 *   grant    admin: gives an account a name the rules would refuse (a reserved one, for a verified partner). Logged.
 *   reclaim  admin: takes a name back (impersonation, abuse). The account drops to a new placeholder and is prompted
 *            again; its allowance is untouched. The name is held until the admin releases it.
 */
export const HOLD_DAYS = 30;

/** Is `name` held for someone other than `accountId`? → the hold row or null. */
async function activeHold(q, name, accountId) {
  return q.one(
    `SELECT name, account_id, reason FROM username_holds
      WHERE name = $1 AND (held_until IS NULL OR held_until > now()) AND account_id IS DISTINCT FROM $2`,
    [name, accountId],
  );
}

/**
 * Whether `raw` could be claimed by `accountId` right now: the rules, then taken / held.
 *   → { ok: true, name } | { ok: false, reason, message }
 */
export async function availability(q, raw, accountId, reserved) {
  const rule = checkUsername(raw, reserved);
  if (!rule.ok) return rule;
  const owner = await q.one('SELECT id FROM accounts WHERE username = $1', [rule.name]);
  if (owner && owner.id === accountId) return { ok: false, reason: 'yours', message: 'That’s already your username.' };
  if (owner) return { ok: false, reason: 'taken', message: 'That name is taken.' };
  if (await activeHold(q, rule.name, accountId)) return { ok: false, reason: 'held', message: 'That name was in use recently and isn’t free yet.' };
  return { ok: true, name: rule.name };
}

/** Claim (first name, free) or rename (uses one allowance). → the account's { username, renamesLeft }. */
export async function changeUsername(db, accountId, raw, reserved) {
  return db.tx(async (q) => {
    const acct = await q.one('SELECT username, username_claimed, rename_allowance FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!acct) throw new HttpError(401, 'Sign in first.', 'signed_out');
    const a = await availability(q, raw, accountId, reserved);
    if (!a.ok) throw new HttpError(a.reason === 'taken' || a.reason === 'held' ? 409 : 400, a.message, a.reason);
    const renaming = acct.username_claimed;
    if (renaming && acct.rename_allowance < 1) {
      throw new HttpError(409, 'Renames aren’t available on your account right now.', 'no_renames');
    }
    await q.query(
      `UPDATE accounts SET username = $2, username_claimed = true, rename_allowance = rename_allowance - $3 WHERE id = $1`,
      [accountId, a.name, renaming ? 1 : 0],
    );
    // A hold on this name for this same account (renaming back within 30 days) is used up now.
    await q.query('DELETE FROM username_holds WHERE name = $1 AND account_id = $2', [a.name, accountId]);
    if (renaming) await holdName(q, acct.username, accountId, 'renamed');
    await q.query(
      'INSERT INTO username_history (account_id, old_name, new_name, kind) VALUES ($1, $2, $3, $4)',
      [accountId, acct.username, a.name, renaming ? 'rename' : 'claim'],
    );
    await logAccountEvent(q, accountId, renaming ? 'username.renamed' : 'username.claimed', {});
    const after = await q.one('SELECT username, rename_allowance FROM accounts WHERE id = $1', [accountId]);
    return { username: after.username, renamesLeft: after.rename_allowance };
  });
}

/** Holds a released name: HOLD_DAYS for a rename or merge, until released by the admin for a reclaim. */
export async function holdName(q, name, accountId, reason) {
  await q.query(
    `INSERT INTO username_holds (name, account_id, reason, held_at, held_until)
     VALUES ($1, $2, $3, now(), CASE WHEN $3 = 'reclaimed' THEN NULL ELSE now() + ($4 || ' days')::interval END)
     ON CONFLICT (name) DO UPDATE SET account_id = EXCLUDED.account_id, reason = EXCLUDED.reason, held_at = now(), held_until = EXCLUDED.held_until`,
    [name, accountId, reason, String(HOLD_DAYS)],
  );
}

/** Admin: give `accountId` the name `raw`, past the reserved / pattern rules (format and uniqueness still hold). */
export async function grantUsername(db, accountId, raw, note = '') {
  const name = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z](?:[a-z0-9]|[-_](?=[a-z0-9]))*$/.test(name) || name.length < 3 || name.length > 20) throw new HttpError(400, 'Not a valid username shape.', 'format');
  return db.tx(async (q) => {
    const acct = await q.one('SELECT username, username_claimed FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!acct) throw new HttpError(404, 'No such account.');
    const owner = await q.one('SELECT id FROM accounts WHERE username = $1', [name]);
    if (owner && owner.id !== accountId) throw new HttpError(409, 'Another account has that name. Reclaim it first.', 'taken');
    await q.query('UPDATE accounts SET username = $2, username_claimed = true WHERE id = $1', [accountId, name]);
    await q.query('DELETE FROM username_holds WHERE name = $1', [name]);
    if (acct.username_claimed && acct.username !== name) await holdName(q, acct.username, accountId, 'renamed');
    await q.query('INSERT INTO username_history (account_id, old_name, new_name, kind, by_admin, note) VALUES ($1, $2, $3, $4, true, $5)', [accountId, acct.username, name, 'grant', String(note).slice(0, 200)]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('username.granted', $1::jsonb)", [JSON.stringify({ account: accountId, name })]);
    await logAccountEvent(q, accountId, 'username.granted', {});
    return name;
  });
}

/** Admin: take an account's name back. It gets a fresh placeholder (prompted again), and its display name is cleared. */
export async function reclaimUsername(db, accountId, note = '') {
  return db.tx(async (q) => {
    const acct = await q.one('SELECT username, username_claimed FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!acct) throw new HttpError(404, 'No such account.');
    if (!acct.username_claimed) throw new HttpError(409, 'That account hasn’t chosen a name.', 'not_claimed');
    const fresh = (await q.one('SELECT everstats_placeholder_username() AS n')).n;
    await q.query('UPDATE accounts SET username = $2, username_claimed = false, display_name = NULL WHERE id = $1', [accountId, fresh]);
    await holdName(q, acct.username, null, 'reclaimed');
    await q.query('UPDATE sessions SET username_prompt_dismissed = false WHERE account_id = $1', [accountId]);
    await q.query('INSERT INTO username_history (account_id, old_name, new_name, kind, by_admin, note) VALUES ($1, $2, $3, $4, true, $5)', [accountId, acct.username, fresh, 'reclaim', String(note).slice(0, 200)]);
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('username.reclaimed', $1::jsonb)", [JSON.stringify({ account: accountId, name: acct.username })]);
    await logAccountEvent(q, accountId, 'username.reclaimed', {});
    return fresh;
  });
}

/** Admin: release a held name (a reclaimed one, or a rename's 30-day hold) so it can be claimed again. */
export async function releaseHold(db, name) {
  const rows = await db.query('DELETE FROM username_holds WHERE name = $1 RETURNING name', [String(name).toLowerCase()]);
  if (rows.length) await db.query("INSERT INTO admin_events (type, detail) VALUES ('username.hold_released', $1::jsonb)", [JSON.stringify({ name })]);
  return rows.length > 0;
}

/**
 * Who /u/{name} is: { account } for a claimed name, { redirect } for a held name (rename / merge) whose account now
 * has another claimed name, or null. Placeholders never resolve.
 */
export async function resolveProfileName(db, raw) {
  const name = String(raw ?? '').toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) return null;
  const acct = await db.one('SELECT id, username, username_claimed FROM accounts WHERE username = $1', [name]);
  if (acct) return acct.username_claimed ? { account: acct.id } : { placeholder: true };
  const hold = await db.one(
    `SELECT h.reason, a.username, a.username_claimed FROM username_holds h JOIN accounts a ON a.id = h.account_id
      WHERE h.name = $1 AND h.reason IN ('renamed', 'merged') AND h.held_until > now() AND NOT everstats_banned(a.id)`,
    [name],
  );
  if (hold?.username_claimed) return { redirect: hold.username };
  return null;
}

export { normalForms };
