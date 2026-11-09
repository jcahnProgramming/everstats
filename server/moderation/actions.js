import { HttpError } from '../core/errors.js';
import { logAccountEvent } from '../auth/sessions.js';
import { getPlatform } from '../accounts/socials.js';
import { releaseHold, reclaimUsername } from '../accounts/usernames.js';
import { can, hasStrongSignIn, MODERATOR_MAX_BAN_DAYS } from './permissions.js';
import { activeBan, liftBans, startBan } from './bans.js';
import { getSetting } from '../admin/settings.js';

/**
 * Moderation actions (0.8.2). Each one: checks the actor's permission (permissions.js), needs a reason, may carry a
 * message to the player, runs in one transaction, and writes ONE moderation_actions row saying who (admin or a
 * moderator), when, why and what changed. Actions that the player should know about set notice = true: they see it
 * once, the next time they load Everstats signed in, and acknowledge it (moderation/player.js).
 *
 * Nothing here deletes an account or a character. A ban hides; lifting it restores.
 */
export const BAN_PRESETS = Object.freeze([1, 3, 7, 30]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function cleanReason(raw, { label = 'A reason' } = {}) {
  const v = String(raw ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();
  if (v.length < 3) throw new HttpError(400, `${label} is required (it is saved to the log, and the player sees it).`, 'reason_required');
  if (v.length > 500) throw new HttpError(400, `${label} is up to 500 characters.`, 'invalid');
  return v;
}

export function cleanPlayerMessage(raw) {
  const v = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[‪-‮⁦-⁩‎‏]/g, '').replace(/[^\P{Cc}\n]/gu, '').trim();
  if (!v) return null;
  if (v.length > 1000) throw new HttpError(400, 'The message to the player is up to 1,000 characters.', 'invalid');
  return v;
}

const forbid = () => new HttpError(403, 'You can’t do that.', 'forbidden');
export function need(actor, permission) {
  if (!can(actor, permission)) throw forbid();
}

/** The target, locked. A moderator can't act on themselves or on another moderator. */
async function target(q, actor, accountId) {
  const a = await q.one('SELECT id, username, username_claimed, display_name, role FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  if (!a) throw new HttpError(404, 'No such account.');
  if (actor.kind === 'moderator' && (Number(a.id) === actor.accountId || a.role === 'moderator')) {
    throw new HttpError(403, 'Moderators can’t act on their own account or another moderator’s. Ask the admin.', 'forbidden');
  }
  return a;
}

export async function logAction(q, { accountId = null, guildId = null, type, actor, reason = null, message = null, detail = {}, notice = false }) {
  return q.one(
    `INSERT INTO moderation_actions (account_id, guild_id, type, actor, actor_account_id, reason, message, detail, notice)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
    [accountId, guildId, type, actor.kind, actor.accountId ?? null, reason, message, JSON.stringify(detail), notice],
  );
}

/** Open reports about this account (or guild) become 'actioned'. Returns how many. */
export async function closeReports(q, { accountId = null, guildId = null, actor, state = 'actioned' }) {
  const rows = await q.query(
    `UPDATE reports SET state = $3, resolved_at = now(), resolved_actor = $4, resolved_by = $5
      WHERE state = 'open' AND (($1::bigint IS NOT NULL AND target_account_id = $1) OR ($2::bigint IS NOT NULL AND target_guild_id = $2)) RETURNING 1`,
    [accountId, guildId, state, actor.kind, actor.accountId ?? null],
  );
  return rows.length;
}

const common = (body) => ({ reason: cleanReason(body?.reason), message: cleanPlayerMessage(body?.message), close: body?.closeReports !== false });

export async function warn(db, actor, accountId, body) {
  need(actor, 'warn');
  const { reason, message, close } = common(body);
  return db.tx(async (q) => {
    await target(q, actor, accountId);
    const closed = close ? await closeReports(q, { accountId, actor }) : 0;
    await logAction(q, { accountId, type: 'warning', actor, reason, message, detail: { reportsClosed: closed }, notice: true });
    await logAccountEvent(q, accountId, 'moderation.warned', {});
  });
}

/** Force a username change: the existing reclaim (a placeholder, prompted again, no rename used). Hold or release the old name. */
export async function forceRename(db, actor, accountId, body) {
  need(actor, 'username.reset');
  const { reason, message, close } = common(body);
  const hold = body?.hold !== false;
  const before = await db.one('SELECT username, username_claimed, role FROM accounts WHERE id = $1', [accountId]);
  if (!before) throw new HttpError(404, 'No such account.');
  if (actor.kind === 'moderator' && (Number(accountId) === actor.accountId || before.role === 'moderator')) throw forbid();
  if (!before.username_claimed) throw new HttpError(409, 'That account hasn’t chosen a username, so there is nothing to reset.', 'not_claimed');
  await reclaimUsername(db, accountId, `${actor.kind}: ${reason}`.slice(0, 200));
  if (!hold) await releaseHold(db, before.username);
  await db.tx(async (q) => {
    const closed = close ? await closeReports(q, { accountId, actor }) : 0;
    await logAction(q, { accountId, type: 'username_reset', actor, reason, message, detail: { from: before.username, held: hold, reportsClosed: closed }, notice: true });
  });
}

/** The fields a reset can clear on an account, with their current values (for the admin panel). */
export async function resettableFields(db, accountId) {
  const a = await db.one('SELECT display_name, profile_bio FROM accounts WHERE id = $1', [accountId]);
  const links = await db.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 ORDER BY platform LIMIT 50', [accountId]);
  const { managedGuilds } = await import('./guilds.js');
  const guilds = await managedGuilds(db, accountId);
  const fields = [];
  if (a?.display_name) fields.push({ id: 'display_name', label: 'Display name', value: a.display_name });
  if (a?.profile_bio) fields.push({ id: 'bio', label: 'Bio', value: a.profile_bio });
  for (const l of links) fields.push({ id: `social:${l.platform}`, label: `${getPlatform(l.platform)?.label ?? l.platform} handle`, value: l.handle });
  for (const g of guilds) {
    if (g.description) fields.push({ id: `guild:${g.id}:description`, label: `${g.name}: description (${g.role})`, value: g.description });
    if (g.links.length) fields.push({ id: `guild:${g.id}:links`, label: `${g.name}: links (${g.role})`, value: g.links.map((l) => `${l.label} — ${l.host}`).join(' · ') });
    if (g.discord) fields.push({ id: `guild:${g.id}:discord`, label: `${g.name}: Discord invite (${g.role})`, value: g.discord });
  }
  return fields;
}

export async function resetField(db, actor, accountId, body) {
  need(actor, 'fields.reset');
  const { reason, message, close } = common(body);
  const field = String(body?.field ?? '');
  const guildField = /^guild:(\d{1,19}):(description|links|discord)$/.exec(field);
  if (guildField) {
    const { managedGuilds, resetGuildField } = await import('./guilds.js');
    const guildId = Number(guildField[1]);
    const g = (await managedGuilds(db, accountId)).find((x) => x.id === guildId);
    if (!g) throw new HttpError(404, 'That account doesn’t manage that guild page.');
    await db.tx(async (q) => {
      await target(q, actor, accountId);
      await resetGuildField(q, { guildId, part: guildField[2], actor, reason });
      const closed = close ? await closeReports(q, { accountId, actor }) : 0;
      await logAction(q, { accountId, guildId, type: 'field_reset', actor, reason, message, notice: true,
        detail: { field: `guild.${guildField[2]}`, guildName: g.name, guildSlug: g.slug, reportsClosed: closed } });
    });
    return;
  }
  await db.tx(async (q) => {
    await target(q, actor, accountId);
    let detail;
    if (field === 'display_name') {
      const a = await q.one('SELECT display_name FROM accounts WHERE id = $1', [accountId]);
      if (!a.display_name) throw new HttpError(409, 'There is no display name to reset.', 'nothing');
      await q.query('UPDATE accounts SET display_name = NULL WHERE id = $1', [accountId]);
      detail = { field, was: a.display_name };
    } else if (field === 'bio') {
      const a = await q.one('SELECT profile_bio FROM accounts WHERE id = $1', [accountId]);
      if (!a.profile_bio) throw new HttpError(409, 'There is no bio to reset.', 'nothing');
      await q.query('UPDATE accounts SET profile_bio = NULL WHERE id = $1', [accountId]);
      detail = { field, was: a.profile_bio };
    } else if (field.startsWith('social:')) {
      const platform = field.slice(7);
      const row = await q.one('DELETE FROM account_social_links WHERE account_id = $1 AND platform = $2 RETURNING handle', [accountId, platform]);
      if (!row) throw new HttpError(409, 'That handle isn’t on the profile any more.', 'nothing');
      // A Verified Content Creator mark on that handle goes with it, as when the player changes it (badges/creators.js).
      const { handlesChanged } = await import('../badges/creators.js');
      const left = await q.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 LIMIT 50', [accountId]);
      await handlesChanged(q, accountId, new Map(left.map((l) => [l.platform, l.handle])));
      detail = { field: 'social', platform, platformLabel: getPlatform(platform)?.label ?? platform, handle: row.handle };
    } else {
      throw new HttpError(400, 'Choose a field to reset.', 'invalid');
    }
    const closed = close ? await closeReports(q, { accountId, actor }) : 0;
    await logAction(q, { accountId, type: 'field_reset', actor, reason, message, detail: { ...detail, reportsClosed: closed }, notice: true });
    await logAccountEvent(q, accountId, 'moderation.field_reset', { field: detail.field });
  });
}

/** When a ban asked for ends: a preset number of days, or a custom end (ISO date-time, in the future). */
export function banEnd(body, actor, now = Date.now()) {
  let end;
  if (body?.days !== undefined && body?.days !== null) {
    if (!BAN_PRESETS.includes(body.days)) throw new HttpError(400, `Choose ${BAN_PRESETS.join(', ')} days, or a custom end.`, 'invalid');
    end = now + body.days * DAY_MS;
  } else {
    end = Date.parse(String(body?.until ?? ''));
    if (!Number.isFinite(end)) throw new HttpError(400, 'Choose how long the ban lasts.', 'invalid');
    if (end <= now + 60_000) throw new HttpError(400, 'The end has to be in the future.', 'invalid');
    if (end > now + 3650 * DAY_MS) throw new HttpError(400, 'For longer than ten years, ban permanently.', 'invalid');
  }
  if (actor.kind === 'moderator' && end > now + MODERATOR_MAX_BAN_DAYS * DAY_MS + 60_000) {
    throw new HttpError(403, `Moderators can ban for up to ${MODERATOR_MAX_BAN_DAYS} days.`, 'forbidden');
  }
  return new Date(end);
}

export async function ban(db, actor, accountId, body, { onChanged = () => {} } = {}) {
  const permanent = body?.kind === 'permanent';
  need(actor, permanent ? 'ban.permanent' : 'ban.temporary');
  const { reason, message, close } = common(body);
  const endsAt = permanent ? null : banEnd(body, actor);
  const out = await db.tx(async (q) => {
    await target(q, actor, accountId);
    const started = await startBan(q, { accountId, kind: permanent ? 'permanent' : 'temporary', endsAt, reason, message, actor });
    const closed = close ? await closeReports(q, { accountId, actor }) : 0;
    await logAction(q, { accountId, type: 'ban', actor, reason, message,
      detail: { ban: started.id, kind: permanent ? 'permanent' : 'temporary', until: endsAt, sessionsEnded: started.sessionsEnded, identities: started.identities, reportsClosed: closed } });
    return started;
  });
  onChanged();
  return out;
}

export async function unban(db, actor, accountId, body, { onChanged = () => {} } = {}) {
  need(actor, 'unban.temporary');
  const { reason, message } = common(body);
  await db.tx(async (q) => {
    await target(q, actor, accountId);
    const lifted = await liftBans(q, { accountId, reason, actor, allowPermanent: can(actor, 'unban.permanent') });
    // The player sees why on their next sign-in.
    await logAction(q, { accountId, type: 'unban', actor, reason, message, detail: { bans: lifted }, notice: true });
  });
  onChanged();
}

/** Admin only: the BattleTags / Discord names on an account. Every reveal is logged. */
export async function reveal(db, actor, accountId) {
  need(actor, 'identities.reveal');
  const rows = await db.query('SELECT provider, display_name, linked_at, last_used_at FROM account_identities WHERE account_id = $1 ORDER BY linked_at LIMIT 20', [accountId]);
  await db.tx(async (q) => {
    await logAction(q, { accountId, type: 'identities_revealed', actor, detail: { providers: rows.map((r) => r.provider) } });
    await q.query("INSERT INTO admin_events (type, detail) VALUES ('moderation.identities_revealed', $1::jsonb)", [JSON.stringify({ account: accountId })]);
  });
  return rows.map((r) => ({ provider: r.provider, displayName: r.display_name, linkedAt: r.linked_at, lastUsedAt: r.last_used_at }));
}

/**
 * Admin only, and only while the setting moderation.moderators is on: give or take the moderator role. Giving it needs a
 * claimed username, 2FA or a passkey on the account, and no live ban. `badge: true` also grants (or, when removing,
 * revokes) the cosmetic Everstats Moderator badge.
 */
export async function setRole(db, actor, accountId, body) {
  need(actor, 'roles.grant');
  if (!(await getSetting(db, 'moderation.moderators'))) throw new HttpError(409, 'Moderators are switched off. Turn the setting on first.', 'moderators_off');
  const role = body?.role === 'moderator' ? 'moderator' : body?.role === 'player' ? 'player' : null;
  if (!role) throw new HttpError(400, 'Moderator or player?', 'invalid');
  const reason = cleanReason(body?.reason);
  const withBadge = body?.badge === true;
  await db.tx(async (q) => {
    const a = await q.one('SELECT id, role, username_claimed FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!a) throw new HttpError(404, 'No such account.');
    if (a.role === role) throw new HttpError(409, role === 'moderator' ? 'That account is a moderator already.' : 'That account isn’t a moderator.', 'unchanged');
    if (role === 'moderator') {
      if (!a.username_claimed) throw new HttpError(409, 'The account needs a username first.', 'not_claimed');
      if (!(await hasStrongSignIn(q, accountId))) throw new HttpError(409, 'The account needs 2FA or a passkey before it can be a moderator.', 'needs_2fa');
      if (await activeBan(q, accountId)) throw new HttpError(409, 'That account is banned.', 'banned');
    }
    await q.query('UPDATE accounts SET role = $2, role_since = CASE WHEN $2 = \'moderator\' THEN now() ELSE NULL END WHERE id = $1', [accountId, role]);
    if (withBadge) {
      const { award, revoke, definitionById } = await import('../badges/store.js');
      const def = await definitionById(q, 'moderator');
      if (def && role === 'moderator') await award(q, { accountId, def, source: 'admin', reason, actor: 'admin' });
      if (def && role === 'player') await revoke(q, { accountId, badgeId: 'moderator', by: 'admin', reason, actor: 'admin' });
    }
    await logAction(q, { accountId, type: role === 'moderator' ? 'role_granted' : 'role_removed', actor, reason, detail: { role, badge: withBadge } });
    await logAccountEvent(q, accountId, role === 'moderator' ? 'role.granted' : 'role.removed', { role });
    await q.query("INSERT INTO admin_events (type, detail) VALUES ($1, $2::jsonb)", [role === 'moderator' ? 'moderation.role_granted' : 'moderation.role_removed', JSON.stringify({ account: accountId, badge: withBadge })]);
  });
}
