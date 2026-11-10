import express from 'express';
import { requireAccount } from '../auth/sessions.js';
import { config } from '../core/config.js';
import { HttpError, route } from '../core/errors.js';
import { featureOn } from '../features/registry.js';

/**
 * Feedback and contact, with replies (0.7.1). One inbox for bug reports, ideas, questions and partnership requests.
 *
 *   POST /api/feedback                      anyone. Signed in: linked to the account, replies appear in "Your feedback".
 *                                           Signed out: kept with the Discord name they left (if any), the only way back.
 *   GET  /api/account/feedback              the player's threads (newest activity first)
 *   GET  /api/account/feedback/:id          one thread (opening it clears its unread mark)
 *   POST /api/account/feedback/:id/reply    the player answers in the thread
 *   …/api/admin/feedback…                   the admin inbox (createAdminFeedbackRouter, behind the admin gate)
 *
 * Abuse protection: per network (5 / 15 min) AND per account (10 / hour) limits, a hidden honeypot field (a filled one
 * is answered "sent" and stored nowhere), length limits (10–4,000 characters), no HTML anywhere (plain text, rendered
 * as text, links never clickable), invisible direction-override characters removed, no third-party CAPTCHA. Not
 * profanity-filtered, on purpose: people should be able to vent. Logs never contain a message.
 */
export const TYPES = Object.freeze(['bug', 'idea', 'question', 'partnership', 'other']);
/** 0.8.2: 'appeal' threads come only from the ban notice (moderation/player.js); the public form can't send one. */
export const ADMIN_TYPES = Object.freeze([...TYPES, 'appeal']);
export const MIN_LEN = 10;
export const MAX_LEN = 4000;

/** Plain text, normalised: control characters (but newlines and tabs) and bidirectional overrides removed. */
export function cleanMessage(raw, { min = MIN_LEN, label = 'Your message' } = {}) {
  const v = String(raw ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[‪-‮⁦-⁩‎‏]/g, '')
    .replace(/[^\P{Cc}\n\t]/gu, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  const n = [...v].length;
  if (n < min) throw new HttpError(400, `${label} needs at least ${min} characters.`, 'too_short');
  if (n > MAX_LEN) throw new HttpError(400, `${label} is ${n.toLocaleString('en-US')} characters: the most is ${MAX_LEN.toLocaleString('en-US')}.`, 'too_long');
  return v;
}

/** The page it's about: a path on Everstats (an absolute address on this origin is shortened to its path), or null. */
export function cleanPage(raw) {
  let v = String(raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(v, config.publicOrigin);
    if (u.origin !== new URL(config.publicOrigin).origin) throw new Error('other origin');
    v = `${u.pathname}${u.search}`;
  } catch {
    throw new HttpError(400, 'The page has to be an address on Everstats (like /c/name-surname).', 'invalid');
  }
  if (!v.startsWith('/') || v.startsWith('//')) throw new HttpError(400, 'The page has to be an address on Everstats (like /c/name-surname).', 'invalid');
  return v.slice(0, 300);
}

/** A Discord username: 2–32 of a–z 0–9 _ . (or an old-style name#1234), or null. */
export function cleanDiscord(raw) {
  const v = String(raw ?? '').trim().replace(/^@/, '');
  if (!v) return null;
  if (!/^(?:[A-Za-z0-9_.]{2,32}|[^\s#@:`]{2,32}#\d{4})$/u.test(v)) throw new HttpError(400, 'That doesn’t look like a Discord username (2–32 letters, numbers, dots and underscores).', 'invalid');
  return v;
}

/** Both limits at once; a refused message is never stored. */
function takeLimits(limits, networkOf, req) {
  const net = limits.feedbackByNetwork.take(networkOf(req));
  const acct = net && (req.session?.stage === 'full' ? limits.feedbackByAccount.take(`account:${req.session.accountId}`) : true);
  if (!net || !acct) {
    limits.feedbackByNetwork.refund(net);
    throw new HttpError(429, 'You’ve sent a lot of feedback just now. Wait a little and try again.', 'rate_limited');
  }
}

const threadView = (t, messages) => ({
  id: t.id, type: t.type, page: t.page, discord: t.discord, createdAt: t.created_at, updatedAt: t.updated_at, unread: t.player_unread,
  messages: messages.map((m) => ({ id: m.id, author: m.author, body: m.body, at: m.created_at })),
});

export function createFeedbackRouter({ db, limits, networkOf }) {
  const r = express.Router();

  r.post('/feedback', route(async (req, res) => {
    // 0.10.3: the Feedback form switch (features/registry.js). Off: no new threads from the public form; ban appeals
    // (moderation/player.js) and replies in existing threads (/account/feedback/:id/reply) are separate routes and still work.
    if (!(await featureOn(db, 'feedback'))) throw new HttpError(503, 'Feedback is closed for now. Try again later.', 'feature_off');
    const body = req.body ?? {};
    // The honeypot: a field people never see. A bot that fills it is told "sent", and nothing is stored or counted.
    if (typeof body.website === 'string' && body.website.trim() !== '') return res.json({ ok: true, signedIn: false });
    const type = TYPES.includes(body.type) ? body.type : null;
    if (!type) throw new HttpError(400, 'Choose what kind of message this is.', 'invalid');
    const message = cleanMessage(body.message);
    const page = cleanPage(body.page);
    const discord = cleanDiscord(body.discord);
    takeLimits(limits, networkOf, req);
    const accountId = req.session?.stage === 'full' ? req.session.accountId : null;
    const id = await db.tx(async (q) => {
      const t = await q.one('INSERT INTO feedback_threads (account_id, type, page, discord) VALUES ($1, $2, $3, $4) RETURNING id', [accountId, type, page, discord]);
      await q.query("INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'player', $2)", [t.id, message]);
      return t.id;
    });
    res.json({ ok: true, signedIn: Boolean(accountId), id: accountId ? id : null });
  }));

  r.use('/account/feedback', requireAccount);

  r.get('/account/feedback', route(async (req, res) => {
    const threads = await db.query(
      'SELECT * FROM feedback_threads WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 100',
      [req.session.accountId],
    );
    const ids = threads.map((t) => t.id);
    const messages = ids.length ? await db.query('SELECT id, thread_id, author, body, created_at FROM feedback_messages WHERE thread_id = ANY($1::bigint[]) ORDER BY created_at, id LIMIT 5000', [ids]) : [];
    res.json({ threads: threads.map((t) => threadView(t, messages.filter((m) => m.thread_id === t.id))) });
  }));

  const ownThread = async (req) => {
    const id = Number(req.params.id);
    const t = Number.isSafeInteger(id) ? await db.one('SELECT * FROM feedback_threads WHERE id = $1 AND account_id = $2', [id, req.session.accountId]) : null;
    if (!t) throw new HttpError(404, 'That isn’t one of your messages.', 'not_found');
    return t;
  };

  r.get('/account/feedback/:id', route(async (req, res) => {
    const t = await ownThread(req);
    if (t.player_unread) await db.query('UPDATE feedback_threads SET player_unread = false WHERE id = $1', [t.id]);
    const messages = await db.query('SELECT id, author, body, created_at FROM feedback_messages WHERE thread_id = $1 ORDER BY created_at, id LIMIT 500', [t.id]);
    res.json({ thread: threadView({ ...t, player_unread: false }, messages) });
  }));

  r.post('/account/feedback/:id/read', route(async (req, res) => {
    const t = await ownThread(req);
    await db.query('UPDATE feedback_threads SET player_unread = false WHERE id = $1', [t.id]);
    res.json({ ok: true });
  }));

  r.post('/account/feedback/:id/reply', route(async (req, res) => {
    const t = await ownThread(req);
    const message = cleanMessage(req.body?.message, { min: 1, label: 'Your reply' });
    takeLimits(limits, networkOf, req);
    await db.tx(async (q) => {
      await q.query("INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'player', $2)", [t.id, message]);
      // A player's answer puts the thread back in the admin's unread pile, archived or not.
      await q.query("UPDATE feedback_threads SET state = 'unread', player_unread = false, updated_at = now() WHERE id = $1", [t.id]);
    });
    const fresh = await db.one('SELECT * FROM feedback_threads WHERE id = $1', [t.id]);
    const messages = await db.query('SELECT id, author, body, created_at FROM feedback_messages WHERE thread_id = $1 ORDER BY created_at, id LIMIT 500', [t.id]);
    res.json({ thread: threadView(fresh, messages) });
  }));

  return r;
}

/** /api/admin/feedback…: behind the admin gate (a plain 404 without an admin session). */
export function createAdminFeedbackRouter({ db, writes }) {
  const r = express.Router();
  const STATES = ['unread', 'read', 'replied', 'archived'];

  const sender = (t) => ({ username: t.username_claimed ? t.username : null, signedIn: t.account_id !== null, accountId: t.account_id === null ? null : Number(t.account_id) });

  // 0.10.3: state 'all' (the v5 Inbox's default view) and a search over the sender's username, Discord name and messages.
  r.get('/feedback', route(async (req, res) => {
    const state = STATES.includes(req.query.state) || req.query.state === 'all' ? req.query.state : 'unread';
    const type = ADMIN_TYPES.includes(req.query.type) ? req.query.type : null;
    const q = typeof req.query.q === 'string' ? req.query.q.normalize('NFC').trim().toLowerCase().replace(/^@/, '').slice(0, 60) : '';
    const like = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await db.query(
      `SELECT t.*, a.username, a.username_claimed,
              (SELECT body FROM feedback_messages m WHERE m.thread_id = t.id ORDER BY created_at, id LIMIT 1) AS first_body,
              (SELECT count(*)::int FROM feedback_messages m WHERE m.thread_id = t.id) AS messages
         FROM feedback_threads t LEFT JOIN accounts a ON a.id = t.account_id
        WHERE ($1 = 'all' OR t.state = $1) AND ($2::text IS NULL OR t.type = $2)
          AND ($3 = '' OR (a.username_claimed AND a.username LIKE $3 || '%') OR lower(coalesce(t.discord, '')) LIKE '%' || $3 || '%'
               OR EXISTS (SELECT 1 FROM feedback_messages m WHERE m.thread_id = t.id AND lower(m.body) LIKE '%' || $3 || '%'))
        ORDER BY t.updated_at DESC LIMIT 200`,
      [state, type, like],
    );
    const counts = await db.query('SELECT state, count(*)::int AS n FROM feedback_threads GROUP BY state LIMIT 10');
    res.json({
      state, type, q, types: ADMIN_TYPES,
      counts: Object.fromEntries(STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0])),
      threads: rows.map((t) => ({
        id: t.id, type: t.type, page: t.page, discord: t.discord, state: t.state, createdAt: t.created_at, updatedAt: t.updated_at,
        sender: sender(t), preview: String(t.first_body ?? '').slice(0, 160), messages: t.messages,
      })),
    });
  }));

  // 0.10.3: the Inbox tab count (registered before /feedback/:id).
  r.get('/feedback/counts', route(async (req, res) => {
    const counts = await db.query('SELECT state, count(*)::int AS n FROM feedback_threads GROUP BY state LIMIT 10');
    const appeals = await db.one("SELECT count(*)::int AS n FROM feedback_threads WHERE type = 'appeal' AND state IN ('unread', 'read')");
    res.json({ counts: Object.fromEntries(STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0])), openAppeals: appeals.n });
  }));

  const threadOf = async (raw) => {
    const id = Number(raw);
    const t = Number.isSafeInteger(id) ? await db.one('SELECT t.*, a.username, a.username_claimed FROM feedback_threads t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.id = $1', [id]) : null;
    if (!t) throw new HttpError(404, 'No such message.');
    return t;
  };
  const full = async (id) => {
    const t = await threadOf(id);
    const messages = await db.query('SELECT id, author, body, created_at FROM feedback_messages WHERE thread_id = $1 ORDER BY created_at, id LIMIT 500', [t.id]);
    const notes = await db.query('SELECT id, body, created_at FROM feedback_notes WHERE thread_id = $1 ORDER BY created_at, id LIMIT 500', [t.id]);
    // 0.10.3: an appeal shows the ban it appeals (design/v5-admin inbox-feedback "Linked moderation").
    const ban = t.ban_id === null || t.ban_id === undefined ? null : await db.one(
      `SELECT b.id, b.account_id, b.kind, b.starts_at, b.ends_at, b.reason, b.actor, b.lifted_at, b.lifted_reason,
              (b.lifted_at IS NULL AND (b.ends_at IS NULL OR b.ends_at > now())) AS live
         FROM account_bans b WHERE b.id = $1`,
      [t.ban_id],
    );
    return {
      ban: ban ? {
        id: Number(ban.id), accountId: Number(ban.account_id), kind: ban.kind, live: ban.live, startsAt: ban.starts_at, endsAt: ban.ends_at,
        reason: ban.reason, by: ban.actor === 'admin' ? 'Admin' : ban.actor === 'moderator' ? 'a moderator' : 'Everstats', liftedAt: ban.lifted_at, liftedReason: ban.lifted_reason,
      } : null,
      id: t.id, type: t.type, page: t.page, discord: t.discord, state: t.state, createdAt: t.created_at, updatedAt: t.updated_at,
      playerUnread: t.player_unread, sender: sender(t), banId: t.ban_id === null || t.ban_id === undefined ? null : Number(t.ban_id),
      messages: messages.map((m) => ({ id: m.id, author: m.author, body: m.body, at: m.created_at })),
      notes: notes.map((n) => ({ id: n.id, body: n.body, at: n.created_at })),
    };
  };

  r.get('/feedback/:id', route(async (req, res) => {
    const t = await threadOf(req.params.id);
    if (t.state === 'unread') await db.query("UPDATE feedback_threads SET state = 'read' WHERE id = $1 AND state = 'unread'", [t.id]);
    res.json({ thread: await full(t.id) });
  }));

  // A reply is shown to the player as from "Everstats", never a person. Signed-out senders can't see replies here.
  r.post('/feedback/:id/reply', writes, route(async (req, res) => {
    const t = await threadOf(req.params.id);
    if (t.account_id === null) throw new HttpError(409, 'This was sent signed out, so a reply here would reach nobody. Reply on Discord instead.', 'signed_out');
    const message = cleanMessage(req.body?.message, { min: 1, label: 'The reply' });
    await db.tx(async (q) => {
      await q.query("INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'everstats', $2)", [t.id, message]);
      await q.query("UPDATE feedback_threads SET state = 'replied', player_unread = true, updated_at = now() WHERE id = $1", [t.id]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('feedback.replied', $1::jsonb)", [JSON.stringify({ thread: t.id })]);
    });
    res.json({ thread: await full(t.id) });
  }));

  r.post('/feedback/:id/notes', writes, route(async (req, res) => {
    const t = await threadOf(req.params.id);
    const body = cleanMessage(req.body?.body, { min: 1, label: 'The note' });
    await db.query('INSERT INTO feedback_notes (thread_id, body) VALUES ($1, $2)', [t.id, body]);
    res.json({ thread: await full(t.id) });
  }));

  r.put('/feedback/:id/state', writes, route(async (req, res) => {
    const t = await threadOf(req.params.id);
    if (!STATES.includes(req.body?.state)) throw new HttpError(400, 'Unknown state.', 'invalid');
    await db.query('UPDATE feedback_threads SET state = $2 WHERE id = $1', [t.id, req.body.state]);
    res.json({ thread: await full(t.id) });
  }));

  // The owner deleting a message (CLAUDE.md names it: feedback is kept until the owner deletes it or the account goes).
  r.delete('/feedback/:id', writes, route(async (req, res) => {
    const t = await threadOf(req.params.id);
    await db.tx(async (q) => {
      await q.query('DELETE FROM feedback_threads WHERE id = $1', [t.id]);
      // 0.10.3: the v5 admin asks why (the Audit log shows it); the message itself is never logged.
      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 500) : null;
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('feedback.deleted', $1::jsonb)", [JSON.stringify({ thread: t.id, ...(reason ? { reason } : {}) })]);
    });
    res.json({ ok: true });
  }));

  return r;
}
