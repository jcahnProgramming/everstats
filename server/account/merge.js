import { HttpError } from '../core/errors.js';
import { logAccountEvent } from '../auth/sessions.js';

/**
 * "Merge this account into another account": cleans up a second account made by signing in with an unlinked
 * provider. The person proves they own BOTH: they are signed in as the source, and they sign in again (provider or
 * passkey, plus the target's 2FA code if it has 2FA on) as the target. Nothing is ever merged on a guess.
 *
 * Every table that belongs to an account declares how it merges, here. A feature that adds account-owned data (the
 * characters someone claimed, say) adds a step; mergeAccounts runs them all, in order, in one transaction.
 *
 *   { id, describe, run(q, sourceId, targetId) }
 *
 * After the steps, the source account is DELETED (its sessions, 2FA secret and recovery codes go with it; the target
 * keeps its own 2FA as it was). This is one of the named exceptions to "keep everything" (CLAUDE.md, "Data rules").
 */
export const MERGE_STEPS = [
  {
    id: 'identities',
    describe: 'Sign-in providers (Battle.net, Discord) move to the account you keep.',
    run: (q, from, to) => q.query('UPDATE account_identities SET account_id = $2 WHERE account_id = $1', [from, to]),
  },
  {
    id: 'passkeys',
    describe: 'Passkeys move to the account you keep.',
    run: (q, from, to) => q.query('UPDATE passkeys SET account_id = $2 WHERE account_id = $1', [from, to]),
  },
];

export async function mergeAccounts(q, sourceId, targetId) {
  if (sourceId === targetId) throw new HttpError(400, "That's the account you're signed in to.", 'same_account');
  const both = await q.query('SELECT id FROM accounts WHERE id = ANY($1) FOR UPDATE', [[sourceId, targetId]]);
  if (both.length !== 2) throw new HttpError(409, 'One of the two accounts no longer exists.', 'gone');
  for (const step of MERGE_STEPS) await step.run(q, sourceId, targetId);
  await logAccountEvent(q, targetId, 'account.merged_in', { from: sourceId, steps: MERGE_STEPS.map((s) => s.id) });
  await q.query('DELETE FROM accounts WHERE id = $1', [sourceId]);
}
