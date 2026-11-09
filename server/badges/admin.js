import express from 'express';
import { isProfaneText } from '../accounts/names.js';
import { HttpError, route } from '../core/errors.js';
import { FAMILIES, TEMPLATES, templateById } from './catalog.js';
import { MAX_BYTES, processMark } from './marks.js';
import { classList, evaluateAccount } from './rules.js';
import {
  award, badgeContext, definitionById, definitionId, holderCounts, loadDefinitions, logEvent, markUrl, publicBadge, revoke, sha256,
} from './store.js';

/**
 * /api/admin/badges… (0.7.0), mounted inside the admin router AFTER its gate: a plain 404 without an admin session.
 * The admin is not a player and can't hold a badge; every grant, revoke and mark change needs a reason and is logged
 * in badge_events (append-only). Only MANUAL badges can be granted or revoked here: automatic ones follow their rule.
 */
const REASON_MAX = 500;
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};
const reasonOf = (raw) => {
  const r = String(raw ?? '').trim();
  if (!r) throw new HttpError(400, 'A reason is required: it is saved to the log.', 'reason_required');
  if (r.length > REASON_MAX) throw new HttpError(400, `A reason is up to ${REASON_MAX} characters.`, 'invalid');
  return r;
};
const text = (raw, { label, min = 1, max }) => {
  const v = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (v.length < min || v.length > max) throw new HttpError(400, `${label}: ${min}–${max} characters.`, 'invalid');
  if (/[\p{Cc}\p{Cf}]/u.test(v)) throw new HttpError(400, `${label} has invisible or control characters in it.`, 'invalid');
  if (isProfaneText(v)) throw new HttpError(400, `${label} has a word in it that isn’t allowed.`, 'invalid');
  return v;
};

/** Whether an account made at `createdAt` may be granted beta membership: the window is open, or it was made before it closed. */
async function betaGrantable(db, createdAt) {
  if (await db.one('SELECT 1 AS x FROM beta_windows WHERE closed_at IS NULL')) return true;
  const last = (await db.one('SELECT max(closed_at) AS t FROM beta_windows'))?.t ?? null;
  return Boolean(last) && Date.parse(createdAt) < Date.parse(last);
}

async function accountBadges(db, accountId) {
  const a = await db.one(
    `SELECT a.id, a.created_at, a.username, a.username_claimed, a.display_name, a.beta_member, a.beta_since,
            (SELECT array_agg(provider ORDER BY linked_at) FROM account_identities WHERE account_id = a.id) AS providers
       FROM accounts a WHERE a.id = $1`,
    [accountId],
  );
  if (!a) throw new HttpError(404, 'No such account.');
  const ctx = await badgeContext(db);
  const rows = await db.query(
    `SELECT d.*, aw.state, aw.earned_at, aw.source, aw.reason, aw.revoked_at, aw.revoked_by, aw.revoked_reason
       FROM badge_awards aw JOIN badge_definitions d ON d.id = aw.badge_id WHERE aw.account_id = $1 ORDER BY aw.state, d.sort LIMIT 500`,
    [accountId],
  );
  return {
    id: a.id, createdAt: a.created_at, username: a.username, claimed: a.username_claimed, displayName: a.display_name, providers: a.providers ?? [],
    beta: { member: a.beta_member, since: a.beta_since, grantable: !a.beta_member && await betaGrantable(db, a.created_at) },
    badges: rows.map((r) => ({
      ...publicBadge(r, ctx), state: r.state, earnedAt: r.earned_at, source: r.source, reason: r.reason,
      revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokedReason: r.revoked_reason,
    })),
  };
}

export function createAdminBadgeRouter({ db, writes }) {
  const r = express.Router();

  r.get('/badges', route(async (req, res) => {
    const ctx = await badgeContext(db);
    const defs = await loadDefinitions(db);
    const counts = await holderCounts(db);
    const pending = new Map((await db.query('SELECT id, mark_pending_at FROM badge_definitions WHERE mark_pending IS NOT NULL LIMIT 500')).map((x) => [x.id, x.mark_pending_at]));
    const log = await db.query(
      `SELECT e.id, e.at, e.type, e.badge_id, e.account_id, e.actor, e.reason, e.detail, ac.username, ac.username_claimed
         FROM badge_events e LEFT JOIN accounts ac ON ac.id = e.account_id
        WHERE e.actor = 'admin' OR e.type = 'backfill' ORDER BY e.at DESC LIMIT 100`,
    );
    const backfill = await db.one("SELECT at, detail FROM badge_events WHERE type = 'backfill' ORDER BY at DESC LIMIT 1");
    const classes = await classList(db, defs);
    const named = new Set(defs.filter((d) => d.rule?.type === 'class').map((d) => d.rule.class));
    res.json({
      families: FAMILIES,
      templates: TEMPLATES,
      earlySupporter: ctx.early.set ? { start: ctx.early.start, end: ctx.early.end, closed: ctx.early.closed } : null,
      definitions: defs.map((d) => ({
        ...publicBadge(d, ctx), heldBy: counts.get(d.id) ?? 0, rule: d.rule, createdBy: d.created_by, createdAt: d.created_at,
        markSetAt: d.mark_set_at, pendingMarkAt: pending.get(d.id) ?? null,
        grantable: d.award === 'manual' && !(d.template === 'partner-pro' && !d.mark_sha),
      })),
      // Blizzard class names on stored characters that no class badge names yet (make one from the class template).
      classesWithoutBadge: classes.filter((c) => !named.has(c)),
      backfill: backfill ? { at: backfill.at, accounts: backfill.detail.accounts ?? null, awarded: backfill.detail.awarded ?? {} } : null,
      log: log.map((e) => ({
        id: e.id, at: e.at, type: e.type, badgeId: e.badge_id, accountId: e.account_id, actor: e.actor, reason: e.reason, detail: e.detail,
        username: e.username_claimed ? e.username : null,
      })),
    });
  }));

  r.get('/badges/accounts/:id', route(async (req, res) => res.json({ account: await accountBadges(db, idParam(req.params.id)) })));

  r.post('/badges/accounts/:id/grant', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    const reason = reasonOf(req.body?.reason);
    const def = await definitionById(db, String(req.body?.badgeId ?? ''));
    if (!def) throw new HttpError(404, 'No such badge.');
    if (def.award !== 'manual') throw new HttpError(409, `${def.name} is automatic: it follows its rule and can’t be granted by hand.`, 'automatic');
    if (def.template === 'partner-pro' && !def.mark_sha) throw new HttpError(409, `Upload and save ${def.name}’s mark before granting it.`, 'needs_mark');
    await db.tx(async (q) => {
      if (!(await q.one('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]))) throw new HttpError(404, 'No such account.');
      const changed = await award(q, { accountId, def, source: 'admin', reason, notify: req.body?.notify === true, actor: 'admin' });
      if (!changed) throw new HttpError(409, 'That account already has this badge.', 'already');
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.granted', $1::jsonb)", [JSON.stringify({ account: accountId, badge: def.id })]);
    });
    res.json({ account: await accountBadges(db, accountId) });
  }));

  r.post('/badges/accounts/:id/revoke', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    const reason = reasonOf(req.body?.reason);
    const def = await definitionById(db, String(req.body?.badgeId ?? ''));
    if (!def) throw new HttpError(404, 'No such badge.');
    if (def.award !== 'manual') throw new HttpError(409, `${def.name} is automatic: it follows its rule and can’t be revoked by hand.`, 'automatic');
    await db.tx(async (q) => {
      const changed = await revoke(q, { accountId, badgeId: def.id, by: 'admin', reason, notify: false, actor: 'admin' });
      if (!changed) throw new HttpError(409, 'That account doesn’t hold this badge.', 'not_held');
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.revoked', $1::jsonb)", [JSON.stringify({ account: accountId, badge: def.id })]);
    });
    res.json({ account: await accountBadges(db, accountId) });
  }));

  // A new definition from a template (no code change). Manual ones can be granted at once (a Pro Team Partner badge
  // once its mark is saved); a class badge is automatic and is evaluated for everyone on the worker's next sweep.
  r.post('/badges/definitions', writes, route(async (req, res) => {
    const t = templateById(req.body?.template);
    if (!t) throw new HttpError(400, 'Choose a template.', 'invalid');
    const id = definitionId(req.body?.id);
    const name = text(req.body?.name, { label: 'Name', max: 40 });
    const description = text(req.body?.description, { label: 'Description', max: 300 });
    let how = req.body?.how ? text(req.body.how, { label: 'How it’s earned', max: 200 }) : null;
    let monogram = null;
    let rule = null;
    if (t.id === 'platform-employee') {
      monogram = String(req.body?.monogram ?? '').trim().toUpperCase();
      if (!/^[A-Z]$/.test(monogram)) throw new HttpError(400, 'The monogram is one capital letter.', 'invalid');
      how ??= `Granted by Everstats staff after checking employment. Work-email verification comes later.`;
    }
    if (t.id === 'class') {
      const cls = text(req.body?.class, { label: 'Blizzard class name', max: 40 });
      rule = { type: 'class', class: cls };
      how = `Owns a level 10+ ${cls}.`;
    }
    if (t.id === 'partner-pro') how ??= 'Granted to verified professional WoW teams after a partnership agreement.';
    if (t.id === 'achievement') how ??= 'Granted by Everstats staff.';
    const sort = { 'partner-pro': 140, 'platform-employee': 150, class: 580, achievement: 690 }[t.id];
    await db.tx(async (q) => {
      if (await q.one('SELECT 1 AS x FROM badge_definitions WHERE id = $1', [id])) throw new HttpError(409, 'A badge with that id already exists.', 'exists');
      if (rule && await q.one("SELECT 1 AS x FROM badge_definitions WHERE rule->>'type' = 'class' AND rule->>'class' = $1", [rule.class])) {
        throw new HttpError(409, `There’s already a badge for ${rule.class}.`, 'exists');
      }
      await q.query(
        `INSERT INTO badge_definitions (id, family, name, description, how, art, template, monogram, award, rule, verified, sort, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, 'admin')`,
        [id, t.family, name, description, how, t.art, t.id, monogram, rule ? 'automatic' : 'manual', rule ? JSON.stringify(rule) : null, ['staff', 'partner'].includes(t.family), sort],
      );
      await logEvent(q, { type: 'created', badgeId: id, actor: 'admin', detail: { template: t.id } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.created', $1::jsonb)", [JSON.stringify({ badge: id, template: t.id })]);
    });
    res.json({ ok: true, id });
  }));

  // ---- Partner marks: upload (needs the permission checkbox) → preview in three themes → save (needs a reason and
  // the "I've checked the preview" checkbox). The upload is raw bytes; marks.js decides what it is.
  r.post('/badges/:id/mark', writes, express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), route(async (req, res) => {
    if (req.query.permission !== 'confirmed') throw new HttpError(400, 'Confirm that the partner has given written permission to use this mark.', 'permission_required');
    const def = await definitionById(db, String(req.params.id));
    if (!def || def.template !== 'partner-pro') throw new HttpError(404, 'Only badges made from the Pro Team Partner template take a mark.');
    const png = await processMark(Buffer.isBuffer(req.body) ? req.body : null);
    const sha = sha256(png);
    await db.tx(async (q) => {
      await q.query('UPDATE badge_definitions SET mark_pending = $2, mark_pending_sha = $3, mark_pending_at = now() WHERE id = $1', [def.id, png, sha]);
      await logEvent(q, { type: 'mark_uploaded', badgeId: def.id, actor: 'admin', detail: { bytes: png.length, permissionConfirmed: true } });
    });
    res.json({ preview: `data:image/png;base64,${png.toString('base64')}`, bytes: png.length });
  }));

  r.post('/badges/:id/mark/save', writes, route(async (req, res) => {
    const reason = reasonOf(req.body?.reason);
    if (req.body?.previewChecked !== true) throw new HttpError(400, 'Tick “I’ve checked the preview” first.', 'preview_required');
    const def = await definitionById(db, String(req.params.id));
    if (!def || def.template !== 'partner-pro') throw new HttpError(404, 'Not found');
    await db.tx(async (q) => {
      const rows = await q.query(
        `UPDATE badge_definitions SET mark = mark_pending, mark_sha = mark_pending_sha, mark_set_at = now(),
                mark_pending = NULL, mark_pending_sha = NULL, mark_pending_at = NULL
          WHERE id = $1 AND mark_pending IS NOT NULL RETURNING mark_sha`,
        [def.id],
      );
      if (!rows.length) throw new HttpError(409, 'Upload a mark first.', 'no_upload');
      await logEvent(q, { type: 'mark_saved', badgeId: def.id, actor: 'admin', reason });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.mark_saved', $1::jsonb)", [JSON.stringify({ badge: def.id })]);
    });
    const saved = await definitionById(db, def.id);
    res.json({ ok: true, mark: markUrl(saved) });
  }));

  r.delete('/badges/:id/mark/pending', writes, route(async (req, res) => {
    await db.query('UPDATE badge_definitions SET mark_pending = NULL, mark_pending_sha = NULL, mark_pending_at = NULL WHERE id = $1', [String(req.params.id)]);
    res.json({ ok: true });
  }));

  // 0.7.1 (owner's decision): "Grant beta membership" for an account made before the beta window opened, once, by
  // hand: reason required, logged (admin_events + the account's history), then Beta Tester follows from the rule like
  // any member's. Only for an account created before the window CLOSED (or while it is open); it never opens, extends
  // or edits a window. The database trigger (schema.js 016) allows this one change only inside this transaction.
  r.post('/badges/accounts/:id/beta', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    const reason = reasonOf(req.body?.reason);
    await db.tx(async (q) => {
      const a = await q.one('SELECT id, created_at, beta_member FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      if (!a) throw new HttpError(404, 'No such account.');
      if (a.beta_member) throw new HttpError(409, 'That account is already a beta member.', 'already');
      const open = await q.one('SELECT 1 AS x FROM beta_windows WHERE closed_at IS NULL');
      const lastClose = (await q.one('SELECT max(closed_at) AS t FROM beta_windows'))?.t ?? null;
      if (!open && !(lastClose && Date.parse(a.created_at) < Date.parse(lastClose))) {
        throw new HttpError(409, 'Only accounts created before the beta window closed can be granted beta membership.', 'after_window');
      }
      await q.query("SELECT set_config('everstats.granting_beta', 'on', true)");
      await q.query('UPDATE accounts SET beta_member = true, beta_since = now() WHERE id = $1', [accountId]);
      await q.query("SELECT set_config('everstats.granting_beta', 'off', true)");
      await q.query("INSERT INTO account_events (account_id, type, detail) VALUES ($1, 'beta.granted', $2::jsonb)", [accountId, JSON.stringify({ by: 'admin' })]);
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('beta.granted', $1::jsonb)", [JSON.stringify({ account: accountId, reason })]);
    });
    await evaluateAccount(db, accountId);
    res.json({ account: await accountBadges(db, accountId) });
  }));

  // Re-run the automatic rules for one account now (support: "I should have the Horde badge").
  r.post('/badges/accounts/:id/evaluate', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    const result = await evaluateAccount(db, accountId);
    res.json({ result, account: await accountBadges(db, accountId) });
  }));

  return r;
}
