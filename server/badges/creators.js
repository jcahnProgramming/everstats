import { randomInt } from 'node:crypto';
import { getPlatform } from '../accounts/socials.js';
import { HttpError } from '../core/errors.js';
import { award, definitionById, logEvent } from './store.js';

/**
 * Verified Content Creators (0.8.1). Everything here is Everstats' own data (retention/registry.js OURS).
 *
 * The method, end to end. Everstats never fetches or scrapes a creator's channel: the admin checks by hand.
 *   1. The admin opens the grant form on /admin/badges, picks the account and starts a verification: Everstats makes a
 *      short code for that account (ES-XXXX-XXXX, creator_verifications, state 'pending').
 *   2. The creator sees the code in Settings → Profile, with what to do: put it in the bio or a panel of the channel
 *      whose handle is on their Everstats profile.
 *   3. The admin looks at that channel, sees the code, ticks which of the profile's handles are verified (only the
 *      CREATOR_PLATFORMS, and only handles the profile has right now), writes a reason and grants. The badge is awarded
 *      (badges/store.js award: logged), the ticked handles are stored AS THEY ARE (creator_handles), the state becomes
 *      'verified'. Granting again later changes the set of verified handles (logged too).
 *   4. A profile shows "Verified" next to a handle only while the stored handle and the profile's handle are the same
 *      and the badge is held. If the creator changes or removes a verified handle, its row is deleted at once
 *      (handlesChanged: logged, and the admin is told on /admin and /admin/badges until they mark it checked). The
 *      badge itself stays until the admin decides.
 *   5. Revoking the badge (the usual revoke, with a reason) removes every Verified mark and sets the state 'revoked'.
 */
export const CREATOR_BADGE = 'verified-creator';
export const CREATOR_PLATFORMS = Object.freeze(['twitch', 'youtube', 'kick', 'tiktok']);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off a channel page by eye

export function newCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `ES-${part()}-${part()}`;
}

/** How a handle is shown: with the @ the platform uses on its own pages. */
export const shownHandle = (platform, handle) => (['youtube', 'tiktok', 'twitch', 'kick'].includes(platform) ? `@${handle}` : handle);

/** The verification of one account → { state, code, startedAt, verifiedAt, revokedAt, alert, handles: [...] } or null. */
export async function creatorState(db, accountId) {
  const v = await db.one('SELECT * FROM creator_verifications WHERE account_id = $1', [accountId]);
  if (!v) return null;
  const handles = await db.query('SELECT platform, handle, verified_at FROM creator_handles WHERE account_id = $1 ORDER BY platform LIMIT 20', [accountId]);
  return {
    state: v.state, code: v.code, startedAt: v.started_at, verifiedAt: v.verified_at, revokedAt: v.revoked_at,
    alert: v.handle_alert_at ? { at: v.handle_alert_at, changes: v.handle_alert ?? [] } : null,
    handles: handles.map((h) => ({ platform: h.platform, label: getPlatform(h.platform)?.label ?? h.platform, handle: h.handle, verifiedAt: h.verified_at })),
  };
}

/**
 * Verified handles that still count, for many accounts at once: Map(accountId → Map(platform → handle)). A handle
 * counts only while the badge is held, the verification is 'verified', and the profile still has exactly that handle.
 */
export async function verifiedHandles(db, accountIds) {
  const ids = [...new Set(accountIds.filter((x) => x !== null && x !== undefined).map(Number))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.query(
    `SELECT h.account_id, h.platform, h.handle FROM creator_handles h
       JOIN creator_verifications v ON v.account_id = h.account_id AND v.state = 'verified'
       JOIN badge_awards a ON a.account_id = h.account_id AND a.badge_id = $2 AND a.state = 'held'
       JOIN account_social_links l ON l.account_id = h.account_id AND l.platform = h.platform AND l.handle = h.handle
      WHERE h.account_id = ANY($1::bigint[]) LIMIT 5000`,
    [ids, CREATOR_BADGE],
  );
  for (const r of rows) {
    if (!out.has(Number(r.account_id))) out.set(Number(r.account_id), new Map());
    out.get(Number(r.account_id)).set(r.platform, r.handle);
  }
  return out;
}

/** The popover lines for a held creator badge: [{ platform: 'Twitch', handle: '@name' }] in the platforms' order. */
export async function creatorLines(db, accountId) {
  const m = (await verifiedHandles(db, [accountId])).get(Number(accountId)) ?? new Map();
  return CREATOR_PLATFORMS.filter((p) => m.has(p)).map((p) => ({ platform: getPlatform(p)?.label ?? p, handle: shownHandle(p, m.get(p)) }));
}

/** Step 1: start (or restart after a revoke) a verification; an existing pending or verified one keeps its code. */
export async function startVerification(q, accountId) {
  const v = await q.one('SELECT state, code FROM creator_verifications WHERE account_id = $1 FOR UPDATE', [accountId]);
  if (v && v.state !== 'revoked') return { code: v.code, started: false };
  const code = newCode();
  await q.query(
    `INSERT INTO creator_verifications (account_id, code, state, started_at) VALUES ($1, $2, 'pending', now())
     ON CONFLICT (account_id) DO UPDATE SET code = EXCLUDED.code, state = 'pending', started_at = now(), verified_at = NULL, revoked_at = NULL,
       handle_alert_at = NULL, handle_alert = NULL`,
    [accountId, code],
  );
  await logEvent(q, { type: 'creator_started', badgeId: CREATOR_BADGE, accountId, actor: 'admin' });
  await q.query("INSERT INTO account_events (account_id, type, detail) VALUES ($1, 'creator.verification_started', '{}'::jsonb)", [accountId]);
  return { code, started: true };
}

/** Step 3: grant (or re-grant) with the ticked platforms. → the platforms stored. */
export async function grantCreator(q, { accountId, platforms, reason, notify = true }) {
  const v = await q.one('SELECT state FROM creator_verifications WHERE account_id = $1 FOR UPDATE', [accountId]);
  if (!v || v.state === 'revoked') throw new HttpError(409, 'Start a verification first: the creator needs a code to show on their channel.', 'no_verification');
  const wanted = [...new Set((Array.isArray(platforms) ? platforms : []).map(String))];
  if (!wanted.length) throw new HttpError(400, 'Tick at least one handle you checked.', 'no_platforms');
  const bad = wanted.filter((p) => !CREATOR_PLATFORMS.includes(p));
  if (bad.length) throw new HttpError(400, 'Only Twitch, YouTube, Kick and TikTok handles can be verified.', 'invalid');
  const links = new Map((await q.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 LIMIT 50', [accountId])).map((l) => [l.platform, l.handle]));
  const missing = wanted.filter((p) => !links.has(p));
  if (missing.length) throw new HttpError(409, 'That profile doesn’t have a handle for every platform you ticked any more. Reload and check again.', 'stale');
  const def = await definitionById(q, CREATOR_BADGE);
  if (!def) throw new HttpError(404, 'No such badge.');
  await award(q, { accountId, def, source: 'admin', reason, notify, actor: 'admin' });
  await q.query('DELETE FROM creator_handles WHERE account_id = $1 AND NOT (platform = ANY($2::text[]))', [accountId, wanted]);
  for (const p of wanted) {
    await q.query(
      `INSERT INTO creator_handles (account_id, platform, handle, verified_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (account_id, platform) DO UPDATE SET handle = EXCLUDED.handle, verified_at = CASE WHEN creator_handles.handle = EXCLUDED.handle THEN creator_handles.verified_at ELSE now() END`,
      [accountId, p, links.get(p)],
    );
  }
  await q.query("UPDATE creator_verifications SET state = 'verified', verified_at = coalesce(verified_at, now()) WHERE account_id = $1", [accountId]);
  const handles = Object.fromEntries(wanted.map((p) => [p, links.get(p)]));
  await logEvent(q, { type: 'creator_verified', badgeId: CREATOR_BADGE, accountId, actor: 'admin', reason, detail: { handles } });
  await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.creator_verified', $1::jsonb)", [JSON.stringify({ account: accountId, platforms: wanted })]);
  await q.query("INSERT INTO account_events (account_id, type, detail) VALUES ($1, 'creator.verified', $2::jsonb)", [accountId, JSON.stringify({ platforms: wanted })]);
  return wanted;
}

/**
 * Step 4: the player saved new social handles. Every verified handle that is no longer exactly on the profile loses its
 * mark now (row deleted: the mark belongs to the handle that was checked), the change is logged, and the admin is told.
 * `next`: Map(platform → handle) as just saved.
 */
export async function handlesChanged(q, accountId, next) {
  const rows = await q.query('SELECT platform, handle FROM creator_handles WHERE account_id = $1 LIMIT 20', [accountId]);
  const gone = rows.filter((r) => next.get(r.platform) !== r.handle);
  if (!gone.length) return [];
  await q.query('DELETE FROM creator_handles WHERE account_id = $1 AND platform = ANY($2::text[])', [accountId, gone.map((r) => r.platform)]);
  const changes = gone.map((r) => ({ platform: r.platform, from: r.handle, to: next.get(r.platform) ?? null }));
  for (const c of changes) {
    await logEvent(q, { type: 'creator_handle_changed', badgeId: CREATOR_BADGE, accountId, actor: 'player', detail: c });
  }
  await q.query(
    `UPDATE creator_verifications SET handle_alert_at = now(), handle_alert = coalesce(handle_alert, '[]'::jsonb) || $2::jsonb WHERE account_id = $1`,
    [accountId, JSON.stringify(changes.map((c) => ({ ...c, at: new Date().toISOString() })))],
  );
  return changes;
}

/** The admin looked at a handle-change alert ("Mark as checked"). The badge and the remaining marks are untouched. */
export async function clearAlert(q, accountId) {
  const rows = await q.query('UPDATE creator_verifications SET handle_alert_at = NULL, handle_alert = NULL WHERE account_id = $1 AND handle_alert_at IS NOT NULL RETURNING 1', [accountId]);
  if (rows.length) await logEvent(q, { type: 'creator_alert_checked', badgeId: CREATOR_BADGE, accountId, actor: 'admin' });
  return rows.length > 0;
}

/** Step 5, called by the admin's revoke of the creator badge (inside its transaction): every mark goes. */
export async function revokeCreator(q, { accountId, reason }) {
  const marks = await q.query('DELETE FROM creator_handles WHERE account_id = $1 RETURNING platform, handle', [accountId]);
  await q.query("UPDATE creator_verifications SET state = 'revoked', revoked_at = now(), handle_alert_at = NULL, handle_alert = NULL WHERE account_id = $1", [accountId]);
  await logEvent(q, { type: 'creator_revoked', badgeId: CREATOR_BADGE, accountId, actor: 'admin', reason, detail: { removed: marks.map((m) => m.platform) } });
}

/** Open handle-change alerts for the admin: [{ accountId, username, at, changes }]. */
export async function creatorAlerts(db) {
  const rows = await db.query(
    `SELECT v.account_id, v.handle_alert_at, v.handle_alert, a.username, a.username_claimed FROM creator_verifications v JOIN accounts a ON a.id = v.account_id
      WHERE v.handle_alert_at IS NOT NULL ORDER BY v.handle_alert_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({ accountId: Number(r.account_id), username: r.username_claimed ? r.username : null, at: r.handle_alert_at, changes: r.handle_alert ?? [] }));
}

