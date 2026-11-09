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
  {
    id: 'characters',
    describe: 'Your characters (and whether each is hidden) move to the account you keep.',
    run: (q, from, to) => q.query('UPDATE characters SET owner_account_id = $2 WHERE owner_account_id = $1', [from, to]),
  },
  {
    // 0.7.1
    id: 'feedback',
    describe: 'Your feedback messages and Everstats’ replies move to the account you keep.',
    run: (q, from, to) => q.query('UPDATE feedback_threads SET account_id = $2 WHERE account_id = $1', [from, to]),
  },
  {
    // 0.7.1: who hid a render (the choice stays with the character either way).
    id: 'render_hidden',
    describe: 'Renders you hid stay hidden.',
    run: (q, from, to) => q.query('UPDATE character_render_hidden SET account_id = $2 WHERE account_id = $1', [from, to]),
  },
  {
    // 0.8.0: share-card defaults this account saved stay saved, now by the kept account.
    id: 'share_card_defaults',
    describe: 'Share cards you saved as the default for your characters or guild stay saved.',
    run: (q, from, to) => q.query('UPDATE share_card_defaults SET saved_by = $2 WHERE saved_by = $1', [from, to]),
  },
  {
    id: 'character_checks',
    describe: 'The record of each time Battle.net listed your characters moves too.',
    run: (q, from, to) => q.query('UPDATE account_character_checks SET account_id = $2 WHERE account_id = $1', [from, to]),
  },
  {
    id: 'dashboard',
    describe: 'Pinned statistics and the featured character: the account you keep keeps its own, unless it never chose any.',
    async run(q, from, to) {
      const [src, dst] = [await q.one('SELECT pins_customised, featured_character_id FROM accounts WHERE id = $1', [from]), await q.one('SELECT pins_customised, featured_character_id FROM accounts WHERE id = $1', [to])];
      if (src.pins_customised && !dst.pins_customised) {
        await q.query('DELETE FROM account_pins WHERE account_id = $1', [to]);
        await q.query('UPDATE account_pins SET account_id = $2 WHERE account_id = $1', [from, to]);
        await q.query('UPDATE accounts SET pins_customised = true WHERE id = $1', [to]);
      }
      if (!dst.featured_character_id && src.featured_character_id) await q.query('UPDATE accounts SET featured_character_id = $2 WHERE id = $1', [to, src.featured_character_id]);
    },
  },
  {
    id: 'username',
    describe: 'Usernames: the account you keep keeps its own. If it never chose one, it takes this account’s. A username this account gives up is held for 30 days and its profile address points to the kept account.',
    async run(q, from, to) {
      const [src, dst] = [
        await q.one('SELECT username, username_claimed, display_name FROM accounts WHERE id = $1', [from]),
        await q.one('SELECT username, username_claimed FROM accounts WHERE id = $1', [to]),
      ];
      if (!src.username_claimed) return;
      if (!dst.username_claimed) {
        // The source's row still holds the name (unique): free it first, then give it to the kept account.
        const tmp = (await q.one('SELECT everstats_placeholder_username() AS n')).n;
        await q.query('UPDATE accounts SET username = $2, username_claimed = false WHERE id = $1', [from, tmp]);
        await q.query('UPDATE accounts SET username = $2, username_claimed = true, display_name = coalesce(display_name, $3) WHERE id = $1', [to, src.username, src.display_name]);
        await q.query("INSERT INTO username_history (account_id, old_name, new_name, kind) VALUES ($1, $2, $3, 'merge')", [to, dst.username, src.username]);
        return;
      }
      const { holdName } = await import('../accounts/usernames.js');
      await holdName(q, src.username, to, 'merged');
    },
  },
  {
    id: 'badges',
    describe: 'Badges: the account you keep gets every badge this account has (the earlier date wins when both have one). Its own choices of what to show stay as they are.',
    async run(q, from, to) {
      // A badge only the source holds moves over (not featured or pinned: the kept account's display choices stand).
      await q.query(
        `UPDATE badge_awards s SET account_id = $2, featured = false, pinned = false, position = NULL
          WHERE s.account_id = $1 AND NOT EXISTS (SELECT 1 FROM badge_awards t WHERE t.account_id = $2 AND t.badge_id = s.badge_id)`,
        [from, to],
      );
      // Both hold it: the kept one keeps its row, held if either was, with the earlier date.
      await q.query(
        `UPDATE badge_awards t SET state = 'held', earned_at = least(t.earned_at, s.earned_at), revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL
           FROM badge_awards s WHERE t.account_id = $2 AND s.account_id = $1 AND s.badge_id = t.badge_id AND s.state = 'held'
            AND NOT (t.state = 'revoked' AND t.revoked_by = 'admin')`,
        [from, to],
      );
      await q.query("INSERT INTO badge_events (type, account_id, actor, reason, detail) VALUES ('restored', $1, 'rule', 'accounts merged', $2::jsonb)", [to, JSON.stringify({ mergedFrom: from })]);
      const { tidyDisplay } = await import('../badges/store.js');
      await tidyDisplay(q, to);
    },
  },
  {
    id: 'creator',
    describe: 'Creator verification: if only this account was verified as a content creator, the account you keep takes it over. A Verified mark moves only where the kept account’s profile has exactly the same handle.',
    async run(q, from, to) {
      // creator_verifications / creator_handles (0.8.1). The kept account's own verification wins.
      if (await q.one('SELECT 1 AS x FROM creator_verifications WHERE account_id = $1', [to])) return;
      await q.query('UPDATE creator_verifications SET account_id = $2 WHERE account_id = $1', [from, to]);
      await q.query(
        `UPDATE creator_handles h SET account_id = $2 WHERE h.account_id = $1
            AND EXISTS (SELECT 1 FROM account_social_links l WHERE l.account_id = $2 AND l.platform = h.platform AND l.handle = h.handle)`,
        [from, to],
      );
    },
  },
  {
    id: 'guild_officers',
    describe: 'Guild officer roles move to the account you keep.',
    run: (q, from, to) => q.query(
      `UPDATE guild_editors s SET account_id = $2 WHERE s.account_id = $1
          AND NOT EXISTS (SELECT 1 FROM guild_editors t WHERE t.account_id = $2 AND t.guild_id = s.guild_id)`,
      [from, to],
    ),
  },
  {
    id: 'beta',
    describe: 'Beta membership: if either account was made during the beta, the account you keep is a beta member, from the earlier date.',
    async run(q, from, to) {
      // The only change the database's beta guard allows (schema.js 009_beta): an earlier, real membership.
      await q.query("SELECT set_config('everstats.merging', 'on', true)");
      await q.query(
        `UPDATE accounts t SET beta_member = true, beta_since = s.beta_since FROM accounts s
          WHERE t.id = $2 AND s.id = $1 AND s.beta_member AND (NOT t.beta_member OR s.beta_since < t.beta_since)`,
        [from, to],
      );
      await q.query("SELECT set_config('everstats.merging', 'off', true)");
    },
  },
];

export async function mergeAccounts(q, sourceId, targetId) {
  if (sourceId === targetId) throw new HttpError(400, "That's the account you're signed in to.", 'same_account');
  const both = await q.query('SELECT id FROM accounts WHERE id = ANY($1) FOR UPDATE', [[sourceId, targetId]]);
  if (both.length !== 2) throw new HttpError(409, 'One of the two accounts no longer exists.', 'gone');
  // 0.8.2: a merge never moves a banned account's identities, passkeys or anything else out, nor a clean account into a
  // banned one (moderation/bans.js). Checked here, inside the transaction, whatever started the merge.
  const { accountTouchesBan } = await import('../moderation/bans.js');
  if ((await accountTouchesBan(q, sourceId)) || (await accountTouchesBan(q, targetId))) {
    throw new HttpError(403, 'One of these accounts is banned, so they can’t be merged.', 'merge_banned');
  }
  for (const step of MERGE_STEPS) await step.run(q, sourceId, targetId);
  await logAccountEvent(q, targetId, 'account.merged_in', { from: sourceId, steps: MERGE_STEPS.map((s) => s.id) });
  await q.query('DELETE FROM accounts WHERE id = $1', [sourceId]);
}
