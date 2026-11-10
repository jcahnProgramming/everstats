import { findGuild, guildKey } from '../characters/find.js';
import express from 'express';
import { requireAccount } from '../auth/sessions.js';
import { HttpError, route } from '../core/errors.js';
import { cleanMessage } from '../feedback/routes.js';
import { getPlatform } from '../accounts/socials.js';
import { resolveProfileName } from '../accounts/usernames.js';
import { activeBan, banNotice } from './bans.js';
import { noticeView } from './notices.js';
import { featureOn } from '../features/registry.js';

// 0.10.3: the Player reports switch (features/registry.js 'reports'). Off: new reports are refused in plain words; the
// queue and its decisions stay. (Guild-link reports: guilds/manage.js, same switch.)
export const REPORTS_OFF = 'Reporting is switched off for now.';

/**
 * The player's side of moderation (0.8.2), under /api:
 *
 *   GET  /banned                       a 'banned' session: the ban notice and its appeal thread (with Everstats' replies)
 *   POST /banned/appeal                a 'banned' session: send an appeal (or add to it). It lands in Admin → Feedback as
 *                                      type 'appeal', linked to the account and the ban.
 *   GET  /account/notices              warnings and other moderation notes not acknowledged yet
 *   POST /account/notices/:id/ack      "I understand": shown once
 *   POST /users/:username/report       anyone: report a profile (what's wrong + an optional note)
 *   POST /guilds/:slug/report          anyone: report a guild's description
 *
 * Reports: per network (10 / 15 min, shared with "Report this link") AND, signed in, per account (20 / hour). A filled
 * honeypot field ('website') is answered "sent" and nothing is stored. No reporter is stored, only whether they were
 * signed in, so the reported person can never learn who it was. Notes are plain text; links are never made clickable.
 */
export const REPORT_WHAT = Object.freeze({
  username: 'Their username',
  display_name: 'Their display name',
  bio: 'Their bio',
  social: 'A social handle',
  badges: 'Badge misuse',
  other: 'Something else',
});
const NOTE_MAX = 500;

const cleanNote = (raw) => {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const clean = cleanMessage(v, { min: 1, label: 'Your note' });
  if ([...clean].length > NOTE_MAX) throw new HttpError(400, `Your note is up to ${NOTE_MAX} characters.`, 'too_long');
  return clean;
};

function takeReportLimits(limits, networkOf, req) {
  const net = limits.reports.take(networkOf(req));
  const acct = net && (req.session?.stage === 'full' ? limits.reportsByAccount.take(`account:${req.session.accountId}`) : true);
  if (!net || !acct) {
    limits.reports.refund(net);
    throw new HttpError(429, 'You’ve sent a lot of reports just now. Wait a little and try again.', 'rate_limited');
  }
}

async function appealThread(db, accountId, banId) {
  const t = await db.one("SELECT id, created_at, player_unread FROM feedback_threads WHERE account_id = $1 AND type = 'appeal' AND ban_id = $2 ORDER BY id DESC LIMIT 1", [accountId, banId]);
  if (!t) return null;
  const messages = await db.query('SELECT id, author, body, created_at FROM feedback_messages WHERE thread_id = $1 ORDER BY created_at, id LIMIT 200', [t.id]);
  return { id: Number(t.id), createdAt: t.created_at, messages: messages.map((m) => ({ id: Number(m.id), author: m.author, body: m.body, at: m.created_at })) };
}

export function createModerationPlayerRouter({ db, limits, networkOf }) {
  const r = express.Router();

  const bannedSession = async (req) => {
    if (req.session?.stage !== 'banned') throw new HttpError(401, 'Sign in first.', 'signed_out');
    const ban = await activeBan(db, req.session.accountId);
    if (!ban) throw new HttpError(409, 'Your ban has ended. Sign in again.', 'ban_ended');
    return ban;
  };

  r.get('/banned', route(async (req, res) => {
    const ban = await bannedSession(req);
    const appeal = await appealThread(db, req.session.accountId, ban.id);
    if (appeal) await db.query('UPDATE feedback_threads SET player_unread = false WHERE id = $1', [appeal.id]);
    res.json({ ban: banNotice(ban), appeal });
  }));

  r.post('/banned/appeal', route(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.website === 'string' && body.website.trim() !== '') return res.json({ ok: true });
    const ban = await bannedSession(req);
    const message = cleanMessage(body.message);
    const net = limits.feedbackByNetwork.take(networkOf(req));
    const acct = net && limits.feedbackByAccount.take(`account:${req.session.accountId}`);
    if (!net || !acct) {
      limits.feedbackByNetwork.refund(net);
      throw new HttpError(429, 'You’ve sent a lot just now. Wait a little and try again.', 'rate_limited');
    }
    const accountId = req.session.accountId;
    await db.tx(async (q) => {
      const t = await q.one("SELECT id FROM feedback_threads WHERE account_id = $1 AND type = 'appeal' AND ban_id = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE", [accountId, ban.id]);
      const id = t ? t.id : (await q.one("INSERT INTO feedback_threads (account_id, type, ban_id) VALUES ($1, 'appeal', $2) RETURNING id", [accountId, ban.id])).id;
      await q.query("INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'player', $2)", [id, message]);
      await q.query("UPDATE feedback_threads SET state = 'unread', player_unread = false, updated_at = now() WHERE id = $1", [id]);
    });
    res.json({ ok: true, appeal: await appealThread(db, accountId, ban.id) });
  }));

  r.get('/account/notices', requireAccount, route(async (req, res) => {
    const rows = await db.query(
      'SELECT id, at, type, reason, message, detail FROM moderation_actions WHERE account_id = $1 AND notice AND acknowledged_at IS NULL ORDER BY at LIMIT 20',
      [req.session.accountId],
    );
    res.json({ notices: rows.map(noticeView) });
  }));

  r.post('/account/notices/:id/ack', requireAccount, route(async (req, res) => {
    const id = Number(req.params.id);
    const rows = Number.isSafeInteger(id)
      ? await db.query('UPDATE moderation_actions SET acknowledged_at = now() WHERE id = $1 AND account_id = $2 AND notice AND acknowledged_at IS NULL RETURNING 1', [id, req.session.accountId])
      : [];
    if (!rows.length) throw new HttpError(404, 'That note isn’t waiting for you.');
    res.json({ ok: true });
  }));

  // ---- Reports
  r.post('/users/:username/report', route(async (req, res) => {
    if (!(await featureOn(db, 'reports'))) throw new HttpError(503, REPORTS_OFF, 'feature_off');
    const body = req.body ?? {};
    if (typeof body.website === 'string' && body.website.trim() !== '') return res.json({ ok: true });
    const what = Object.hasOwn(REPORT_WHAT, body.what) ? body.what : null;
    if (!what) throw new HttpError(400, 'Choose what’s wrong.', 'invalid');
    const note = cleanNote(body.note);
    const who = await resolveProfileName(db, req.params.username);
    const target = who?.account ? await db.one('SELECT id, username, display_name, profile_bio, everstats_banned(id) AS banned FROM accounts WHERE id = $1', [who.account]) : null;
    if (!target || target.banned) throw new HttpError(404, 'This profile isn’t available.', 'no_user');
    if (req.session?.stage === 'full' && Number(req.session.accountId) === Number(target.id)) throw new HttpError(400, 'That’s your own profile.', 'own');
    let platform = null;
    const snapshot = { username: target.username, displayName: target.display_name ?? null };
    if (what === 'bio') snapshot.bio = target.profile_bio ?? null;
    if (what === 'social') {
      platform = typeof body.platform === 'string' ? body.platform : '';
      const link = getPlatform(platform) ? await db.one('SELECT handle FROM account_social_links WHERE account_id = $1 AND platform = $2', [target.id, platform]) : null;
      if (!link) throw new HttpError(400, 'Choose one of the handles on this profile.', 'invalid');
      snapshot.handle = link.handle;
    }
    if (what === 'badges') {
      snapshot.badges = (await db.query("SELECT badge_id FROM badge_awards WHERE account_id = $1 AND state = 'held' AND shown ORDER BY badge_id LIMIT 50", [target.id])).map((x) => x.badge_id);
    }
    takeReportLimits(limits, networkOf, req);
    await db.query(
      `INSERT INTO reports (target_kind, target_account_id, what, platform, note, snapshot, reporter_signed_in)
       VALUES ('account', $1, $2, $3, $4, $5::jsonb, $6)`,
      [target.id, what, platform, note, JSON.stringify(snapshot), req.session?.stage === 'full'],
    );
    res.json({ ok: true });
  }));

  r.post('/guilds/:slug/report', route(async (req, res) => {
    if (!(await featureOn(db, 'reports'))) throw new HttpError(503, REPORTS_OFF, 'feature_off');
    const body = req.body ?? {};
    if (typeof body.website === 'string' && body.website.trim() !== '') return res.json({ ok: true });
    const note = cleanNote(body.note);
    const key = guildKey(req.params.slug);
    const g = key ? await findGuild(db, key, { cols: 'id, name' }) : null;
    if (!g) throw new HttpError(404, 'Everstats doesn’t know this guild.', 'no_guild');
    const page = await db.one('SELECT description FROM guild_pages WHERE guild_id = $1', [g.id]);
    if (!page?.description) throw new HttpError(400, 'This guild page has no description to report.', 'invalid');
    takeReportLimits(limits, networkOf, req);
    await db.query(
      `INSERT INTO reports (target_kind, target_guild_id, what, note, snapshot, reporter_signed_in)
       VALUES ('guild', $1, 'guild_description', $2, $3::jsonb, $4)`,
      [g.id, note, JSON.stringify({ guild: g.name, description: page.description }), req.session?.stage === 'full'],
    );
    res.json({ ok: true });
  }));

  return r;
}
