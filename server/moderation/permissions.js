import { getSetting } from '../admin/settings.js';
import { sha256Hex } from '../credentials/crypto.js';
import { COOKIE, readCookie } from '../auth/cookies.js';

/**
 * Who may moderate, and what each role may do (0.8.2). ONE table: every moderation route asks `can(actor, permission)`,
 * never `actor.kind === 'admin'` inline.
 *
 *   admin      the admin identity (admin passkey, admin session). Everything here.
 *   moderator  a PLAYER account with accounts.role = 'moderator', while the admin setting moderation.moderators is ON
 *              and the account has 2FA or a passkey. The role is the permission; the "Everstats Moderator" badge is
 *              cosmetic and grants nothing. With the setting off (the default) a moderator account is an ordinary
 *              player everywhere, and nobody can be given the role.
 *
 * Moderators can never: ban permanently, lift a permanent ban, see BattleTags / Discord names, grant roles or badges,
 * see the accounts list, or reach anything else under /api/admin (the admin gate there checks the admin session only).
 */
export const MODERATOR_MAX_BAN_DAYS = 7;

export const PERMISSIONS = Object.freeze({
  'reports.view': { admin: true, moderator: true, label: 'See the Reports queue' },
  'reports.dismiss': { admin: true, moderator: true, label: 'Dismiss reports' },
  'account.view': { admin: true, moderator: true, label: 'Open a reported account’s moderation panel' },
  'accounts.list': { admin: true, moderator: false, label: 'Browse and search every account' },
  warn: { admin: true, moderator: true, label: 'Warn' },
  'username.reset': { admin: true, moderator: true, label: 'Force a username change' },
  'fields.reset': { admin: true, moderator: true, label: 'Reset a display name, bio, social handle or guild text' },
  'ban.temporary': { admin: true, moderator: true, label: `Ban temporarily (moderators: up to ${MODERATOR_MAX_BAN_DAYS} days)` },
  'ban.permanent': { admin: true, moderator: false, label: 'Ban permanently' },
  'unban.temporary': { admin: true, moderator: true, label: 'Lift a temporary ban' },
  'unban.permanent': { admin: true, moderator: false, label: 'Lift a permanent ban' },
  'identities.reveal': { admin: true, moderator: false, label: 'Reveal BattleTags and Discord names' },
  'roles.grant': { admin: true, moderator: false, label: 'Grant or remove the moderator role (and its badge)' },
});

/** May `actor` do `permission`? Unknown permissions are refused. */
export function can(actor, permission) {
  const p = PERMISSIONS[permission];
  return Boolean(actor && p && p[actor.kind] === true);
}

/** What the client needs to show or hide controls: { permission: boolean }. The server still checks every call. */
export const capabilities = (actor) => Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, can(actor, k)]));

/** Does the account have a second way to prove it's them: 2FA on, or a passkey? (Required for the moderator role.) */
export async function hasStrongSignIn(q, accountId) {
  const row = await q.one(
    `SELECT EXISTS (SELECT 1 FROM account_totp WHERE account_id = $1 AND state = 'enabled')
         OR EXISTS (SELECT 1 FROM passkeys WHERE account_id = $1) AS ok`,
    [accountId],
  );
  return Boolean(row?.ok);
}

/**
 * The actor behind this request: { kind: 'admin' } | { kind: 'moderator', accountId } | null.
 * A moderator needs: a full player session, role 'moderator', the setting on, 2FA or a passkey, and no active ban.
 */
export async function actorOf(db, req) {
  const token = readCookie(req, COOKIE.admin);
  if (token && (await db.one('SELECT 1 AS x FROM admin_sessions WHERE id_hash = $1 AND expires_at > now()', [sha256Hex(token)]))) {
    return { kind: 'admin', accountId: null };
  }
  if (req.session?.stage !== 'full') return null;
  if (!(await getSetting(db, 'moderation.moderators'))) return null;
  const a = await db.one('SELECT role, everstats_banned(id) AS banned FROM accounts WHERE id = $1', [req.session.accountId]);
  if (a?.role !== 'moderator' || a.banned) return null;
  if (!(await hasStrongSignIn(db, req.session.accountId))) return null;
  return { kind: 'moderator', accountId: Number(req.session.accountId) };
}
