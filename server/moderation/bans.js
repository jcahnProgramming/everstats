import { HttpError } from '../core/errors.js';
import { logAccountEvent } from '../auth/sessions.js';
import { getProvider } from '../auth/providers.js';

/**
 * Bans (0.8.2). A ban is a row in account_bans: temporary (ends_at) or permanent. It is LIVE while not lifted and not past
 * its end; a temporary ban lifts by itself at ends_at (nothing has to run). Nothing is deleted by a ban: the account,
 * its characters, its hidden-character choices and its data all stay, so lifting it puts everything back.
 *
 * What a live ban does:
 *   - every session of the account ends when the ban starts; a sign-in then gets a 'banned' session that can only read
 *     this notice, appeal (feedback type 'appeal') and sign out (auth/routes.js, account/routes.js)
 *   - the account's public presence is hidden (everstats_banned() in SQL: profile, "Claimed by", inline badges, badge
 *     holder lists, share-card defaults and link previews, guild management). Its characters stay as Blizzard data.
 *   - ban evasion: the Battle.net / Discord identities and passkeys the account had when the ban started are copied to
 *     ban_identities. While the ban is live, each of them is refused for signing in to, linking to, or merging with
 *     ANY account (identityBan / passkeyBan below), on top of the account's own ban.
 */
export const LIVE = 'b.lifted_at IS NULL AND (b.ends_at IS NULL OR b.ends_at > now())';
const COLUMNS = 'b.id, b.account_id, b.kind, b.starts_at, b.ends_at, b.reason, b.message, b.actor';

/** The account's live ban, or null. */
export async function activeBan(q, accountId) {
  if (!accountId) return null;
  return q.one(`SELECT ${COLUMNS} FROM account_bans b WHERE b.account_id = $1 AND ${LIVE} ORDER BY b.ends_at DESC NULLS FIRST LIMIT 1`, [accountId]);
}

/** A live ban this provider identity is attached to (by its own account, or copied when a ban started), or null. */
export async function identityBan(q, provider, subject) {
  const own = await q.one('SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2', [provider, subject]);
  const byAccount = own ? await activeBan(q, own.account_id) : null;
  if (byAccount) return byAccount;
  return q.one(
    `SELECT ${COLUMNS} FROM ban_identities i JOIN account_bans b ON b.id = i.ban_id
      WHERE i.kind = 'provider' AND i.provider = $1 AND i.subject = $2 AND ${LIVE} ORDER BY b.ends_at DESC NULLS FIRST LIMIT 1`,
    [provider, String(subject)],
  );
}

/** A live ban this passkey is attached to, or null. */
export async function passkeyBan(q, credentialId) {
  const own = await q.one('SELECT account_id FROM passkeys WHERE credential_id = $1', [credentialId]);
  const byAccount = own ? await activeBan(q, own.account_id) : null;
  if (byAccount) return byAccount;
  return q.one(
    `SELECT ${COLUMNS} FROM ban_identities i JOIN account_bans b ON b.id = i.ban_id
      WHERE i.kind = 'passkey' AND i.credential_id = $1 AND ${LIVE} ORDER BY b.ends_at DESC NULLS FIRST LIMIT 1`,
    [credentialId],
  );
}

/**
 * Is any way into this account attached to a live ban (its own, or an identity/passkey copied into another account's
 * ban)? Used by merges, which must never move a banned identity out or a clean account into a banned one.
 */
export async function accountTouchesBan(q, accountId) {
  if (await activeBan(q, accountId)) return true;
  const row = await q.one(
    `SELECT EXISTS (
        SELECT 1 FROM ban_identities i JOIN account_bans b ON b.id = i.ban_id
         WHERE ${LIVE} AND (
           (i.kind = 'provider' AND (i.provider, i.subject) IN (SELECT provider, subject FROM account_identities WHERE account_id = $1))
           OR (i.kind = 'passkey' AND i.credential_id IN (SELECT credential_id FROM passkeys WHERE account_id = $1)))) AS x`,
    [accountId],
  );
  return Boolean(row?.x);
}

/** The notice a banned player sees, in player terms. Never says who banned them. */
export function banNotice(ban) {
  if (!ban) return null;
  return {
    id: Number(ban.id),
    permanent: ban.kind === 'permanent',
    since: ban.starts_at,
    until: ban.ends_at ?? null,
    reason: ban.reason,
    message: ban.message ?? null,
  };
}

/**
 * Starts a ban (inside the caller's transaction). Ends every session of the account, copies its identities and passkeys
 * to ban_identities, logs it. An account that is already banned has the new ban added; the longest one decides.
 */
export async function startBan(q, { accountId, kind, endsAt, reason, message, actor }) {
  const ban = await q.one(
    `INSERT INTO account_bans (account_id, kind, ends_at, reason, message, actor, actor_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, starts_at, ends_at`,
    [accountId, kind, kind === 'permanent' ? null : endsAt, reason, message, actor.kind, actor.accountId ?? null],
  );
  await q.query(
    `INSERT INTO ban_identities (ban_id, kind, provider, subject)
     SELECT $1, 'provider', provider, subject FROM account_identities WHERE account_id = $2`,
    [ban.id, accountId],
  );
  await q.query(
    `INSERT INTO ban_identities (ban_id, kind, credential_id)
     SELECT $1, 'passkey', credential_id FROM passkeys WHERE account_id = $2`,
    [ban.id, accountId],
  );
  const ids = await q.one(
    `SELECT count(*) FILTER (WHERE kind = 'provider')::int AS providers, count(*) FILTER (WHERE kind = 'passkey')::int AS passkeys,
            array_agg(DISTINCT provider) FILTER (WHERE kind = 'provider') AS which FROM ban_identities WHERE ban_id = $1`,
    [ban.id],
  );
  const ended = await q.query('DELETE FROM sessions WHERE account_id = $1 RETURNING 1', [accountId]);
  await logAccountEvent(q, accountId, 'moderation.banned', { ban: Number(ban.id), kind });
  return {
    id: Number(ban.id),
    endsAt: ban.ends_at,
    sessionsEnded: ended.length,
    identities: { providers: (ids.which ?? []).map((p) => getProvider(p)?.label ?? p), passkeys: ids.passkeys },
  };
}

/** Lifts every live ban of the account. Ends its 'banned' sessions so the next sign-in is a normal one. */
export async function liftBans(q, { accountId, reason, actor, allowPermanent }) {
  const live = await q.query(`SELECT b.id, b.kind FROM account_bans b WHERE b.account_id = $1 AND ${LIVE} LIMIT 20 FOR UPDATE`, [accountId]);
  if (!live.length) throw new HttpError(409, 'That account isn’t banned.', 'not_banned');
  if (!allowPermanent && live.some((b) => b.kind === 'permanent')) throw new HttpError(403, 'Only the admin can lift a permanent ban.', 'forbidden');
  await q.query(
    'UPDATE account_bans SET lifted_at = now(), lifted_reason = $2, lifted_actor = $3, lifted_by = $4 WHERE id = ANY($1::bigint[])',
    [live.map((b) => b.id), reason, actor.kind, actor.accountId ?? null],
  );
  await q.query("DELETE FROM sessions WHERE account_id = $1 AND stage = 'banned'", [accountId]);
  await logAccountEvent(q, accountId, 'moderation.unbanned', { bans: live.map((b) => Number(b.id)) });
  return live.map((b) => Number(b.id));
}
