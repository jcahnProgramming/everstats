import { PRIMARY_VERSION } from '../core/gameVersions.js';
import express from 'express';
import { isProfaneText } from '../accounts/names.js';
import { HttpError, route } from '../core/errors.js';
import { FAMILIES, LOGO_TEMPLATES, TEMPLATES, takesLogo, templateById } from './catalog.js';
import { CREATOR_BADGE, CREATOR_PLATFORMS, clearAlert, creatorAlerts, creatorState, grantCreator, revokeCreator, startVerification } from './creators.js';
import { MAX_BYTES, MIN_SIDE, SIZES, backingOf, permissionNote, processLogo } from './logos.js';
import { getPlatform } from '../accounts/socials.js';
import { GAME_DATA_RULES, classList, evaluateAccount } from './rules.js';
import {
  DEF_COLUMNS, award, badgeContext, definitionById, definitionId, holderCounts, loadDefinitions, logEvent, logoView, publicBadge, revoke, sha256, tidyDisplay,
} from './store.js';

/**
 * /api/admin/badges… (0.7.0), mounted inside the admin router AFTER its gate: a plain 404 without an admin session.
 * The admin is not a player and can't hold a badge; every grant, revoke and logo change needs a reason and is logged
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
    `SELECT ${DEF_COLUMNS}, aw.state, aw.earned_at, aw.source, aw.reason, aw.revoked_at, aw.revoked_by, aw.revoked_reason
       FROM badge_awards aw JOIN badge_definitions d ON d.id = aw.badge_id WHERE aw.account_id = $1 ORDER BY aw.state, d.sort LIMIT 500`,
    [accountId],
  );
  // 0.8.1: the creator verification, and the profile's handles with which can be ticked (creator platforms only)
  const links = await db.query('SELECT platform, handle FROM account_social_links WHERE account_id = $1 ORDER BY platform LIMIT 50', [accountId]);
  const creator = await creatorState(db, accountId);
  const verified = new Map((creator?.handles ?? []).map((h) => [h.platform, h.handle]));
  return {
    creator,
    socials: links.filter((l) => getPlatform(l.platform)).map((l) => ({
      platform: l.platform, label: getPlatform(l.platform).label, handle: l.handle,
      creatorPlatform: CREATOR_PLATFORMS.includes(l.platform), verified: verified.get(l.platform) === l.handle,
    })),
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
    // 0.10.4: logos. The permission note is the admin's (never on a public page); a pending upload waits for Save.
    const logoRows = await db.query('SELECT badge_id, stage, permission_by, permission_at, permission_how, reason, created_at FROM badge_logos ORDER BY badge_id LIMIT 1000');
    const savedNote = new Map(logoRows.filter((x) => x.stage === 'saved').map((x) => [x.badge_id, { by: x.permission_by, at: x.permission_at, how: x.permission_how, reason: x.reason, setAt: x.created_at }]));
    const pending = new Map(logoRows.filter((x) => x.stage === 'pending').map((x) => [x.badge_id, x.created_at]));
    const log = await db.query(
      `SELECT e.id, e.at, e.type, e.badge_id, e.account_id, e.actor, e.reason, e.detail, ac.username, ac.username_claimed
         FROM badge_events e LEFT JOIN accounts ac ON ac.id = e.account_id
        WHERE e.actor = 'admin' OR e.type IN ('backfill', 'logo_carried_over') ORDER BY e.at DESC LIMIT 100`,
    );
    const backfill = await db.one("SELECT at, detail FROM badge_events WHERE type = 'backfill' ORDER BY at DESC LIMIT 1");
    const classes = await classList(db, defs);
    const named = new Set(defs.filter((d) => d.rule?.type === 'class').map((d) => d.rule.class));
    res.json({
      families: FAMILIES,
      templates: TEMPLATES,
      logoTemplates: LOGO_TEMPLATES,
      logoRules: { maxBytes: MAX_BYTES, minSide: MIN_SIDE, sizes: SIZES },
      earlySupporter: ctx.early.set ? { start: ctx.early.start, end: ctx.early.end, closed: ctx.early.closed } : null,
      definitions: defs.map((d) => ({
        ...publicBadge(d, ctx), heldBy: counts.get(d.id) ?? 0, rule: d.rule, createdBy: d.created_by, createdAt: d.created_at,
        takesLogo: takesLogo(d), logoNote: savedNote.get(d.id) ?? null, pendingLogoAt: pending.get(d.id) ?? null,
        grantable: d.award === 'manual' && !(d.template === 'partner-pro' && !d.logo),
      })),
      // Blizzard class names on stored characters that no class badge names yet (make one from the class template).
      classesWithoutBadge: classes.filter((c) => !named.has(c)),
      creator: { badgeId: CREATOR_BADGE, platforms: CREATOR_PLATFORMS.map((p) => ({ id: p, label: getPlatform(p)?.label ?? p })), alerts: await creatorAlerts(db) },
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
    if (def.template === 'partner-pro' && !def.logo) throw new HttpError(409, `Upload and save ${def.name}’s logo before granting it.`, 'needs_logo');
    if (def.id === CREATOR_BADGE) throw new HttpError(409, 'Verified Content Creator is granted from the creator form: it needs the handles you checked.', 'use_creator_form');
    await db.tx(async (q) => {
      if (!(await q.one('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]))) throw new HttpError(404, 'No such account.');
      const firstAward = !(await q.one('SELECT 1 AS x FROM badge_awards WHERE account_id = $1 AND badge_id = $2', [accountId, def.id]));
      const changed = await award(q, { accountId, def, source: 'admin', reason, notify: req.body?.notify === true, actor: 'admin' });
      if (!changed) throw new HttpError(409, 'That account already has this badge.', 'already');
      // 0.10.3: a badge whose definition says shown_by_default = false (Dev Tester) starts HIDDEN on a NEW award: the
      // holder shows it from Settings → Badges if they want. A re-grant keeps whatever the holder chose before.
      if (firstAward) {
        const shownByDefault = (await q.one('SELECT shown_by_default FROM badge_definitions WHERE id = $1', [def.id]))?.shown_by_default !== false;
        if (!shownByDefault) {
          await q.query('UPDATE badge_awards SET shown = false, featured = false, pinned = false, position = NULL WHERE account_id = $1 AND badge_id = $2', [accountId, def.id]);
          await tidyDisplay(q, accountId);
        }
      }
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
      if (def.id === CREATOR_BADGE) await revokeCreator(q, { accountId, reason });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.revoked', $1::jsonb)", [JSON.stringify({ account: accountId, badge: def.id })]);
    });
    res.json({ account: await accountBadges(db, accountId) });
  }));

  // A new definition from a template (no code change). Manual ones can be granted at once (a Pro Team Partner badge
  // once its logo is saved); a class badge is automatic and is evaluated for everyone on the worker's next sweep.
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
    if (t.id === 'partner-community') how ??= 'Granted to the people behind a partner site or community after a partnership agreement.';
    if (t.id === 'achievement') how ??= 'Granted by Everstats staff.';
    const sort = { 'partner-pro': 140, 'partner-community': 145, 'platform-employee': 150, class: 580, achievement: 690 }[t.id];
    await db.tx(async (q) => {
      if (await q.one('SELECT 1 AS x FROM badge_definitions WHERE id = $1', [id])) throw new HttpError(409, 'A badge with that id already exists.', 'exists');
      if (rule && await q.one("SELECT 1 AS x FROM badge_definitions WHERE rule->>'type' = 'class' AND rule->>'class' = $1", [rule.class])) {
        throw new HttpError(409, `There’s already a badge for ${rule.class}.`, 'exists');
      }
      await q.query(
        `INSERT INTO badge_definitions (id, family, name, description, how, art, template, monogram, award, rule, verified, sort, created_by, game_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, 'admin', $13)`,
        // 0.10.0: a badge whose rule reads characters belongs to the primary version (the only one with players yet).
        [id, t.family, name, description, how, t.art, t.id, monogram, rule ? 'automatic' : 'manual', rule ? JSON.stringify(rule) : null, ['staff', 'partner'].includes(t.family), sort, GAME_DATA_RULES.includes(rule?.type) ? PRIMARY_VERSION.id : null],
      );
      await logEvent(q, { type: 'created', badgeId: id, actor: 'admin', detail: { template: t.id } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.created', $1::jsonb)", [JSON.stringify({ badge: id, template: t.id })]);
    });
    res.json({ ok: true, id });
  }));

  // ---- Badge logos (0.10.4, badges/logos.js): upload (with the permission note) → the re-encoded result at every size
  // as a preview → save (the note again, a reason, "I've checked the preview") or Cancel. Remove at any time (reason): the
  // badge falls back to its own art and every holder keeps it. The upload is raw bytes; logos.js decides what it is.
  const logoBadge = async (id) => {
    const def = await definitionById(db, String(id));
    if (!def || !takesLogo(def)) throw new HttpError(404, 'Only Pro Team, Platform Employee and Community Partner badges take a logo.', 'no_logo_slot');
    return def;
  };
  const noteText = (n) => `${n.by}, ${n.at}: ${n.how}`;
  const dataUri = (png) => `data:image/png;base64,${png.toString('base64')}`;

  r.post('/badges/:id/logo', writes, express.raw({ type: () => true, limit: MAX_BYTES * 2 }), route(async (req, res) => {
    const note = permissionNote(req.query);
    const def = await logoBadge(req.params.id);
    const sizes = await processLogo(Buffer.isBuffer(req.body) ? req.body : null);
    const sha = sha256(sizes[256]);
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO badge_logos (badge_id, stage, png_64, png_128, png_256, sha, permission_by, permission_at, permission_how)
         VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (badge_id, stage) DO UPDATE SET png_64 = EXCLUDED.png_64, png_128 = EXCLUDED.png_128, png_256 = EXCLUDED.png_256, sha = EXCLUDED.sha,
           permission_by = EXCLUDED.permission_by, permission_at = EXCLUDED.permission_at, permission_how = EXCLUDED.permission_how, created_at = now()`,
        [def.id, sizes[64], sizes[128], sizes[256], sha, note.by, note.at, note.how],
      );
      await logEvent(q, { type: 'logo_uploaded', badgeId: def.id, actor: 'admin', detail: { bytes: sizes[256].length, permission: note } });
    });
    res.json({ preview: Object.fromEntries(SIZES.map((px) => [px, dataUri(sizes[px])])), sizes: SIZES });
  }));

  r.post('/badges/:id/logo/save', writes, route(async (req, res) => {
    const note = permissionNote(req.body);
    const reason = reasonOf(req.body?.reason);
    if (req.body?.previewChecked !== true) throw new HttpError(400, 'Tick “I’ve checked the preview” first.', 'preview_required');
    const backing = backingOf(req.body?.backing);
    const def = await logoBadge(req.params.id);
    let replaced = null;
    await db.tx(async (q) => {
      const pend = await q.one("SELECT sha FROM badge_logos WHERE badge_id = $1 AND stage = 'pending' FOR UPDATE", [def.id]);
      if (!pend) throw new HttpError(409, 'Upload a logo first.', 'no_upload');
      const old = await q.one("SELECT permission_by, permission_at, permission_how FROM badge_logos WHERE badge_id = $1 AND stage = 'saved' FOR UPDATE", [def.id]);
      replaced = old ? { by: old.permission_by, at: old.permission_at, how: old.permission_how } : null;
      await q.query("DELETE FROM badge_logos WHERE badge_id = $1 AND stage = 'saved'", [def.id]);
      await q.query(
        `UPDATE badge_logos SET stage = 'saved', backing = $2, permission_by = $3, permission_at = $4, permission_how = $5, reason = $6, created_at = now()
          WHERE badge_id = $1 AND stage = 'pending'`,
        [def.id, backing, note.by, note.at, note.how, reason],
      );
      await logEvent(q, { type: old ? 'logo_replaced' : 'logo_saved', badgeId: def.id, actor: 'admin', reason, detail: { permission: note, backing } });
      // The Audit log: the badge, the permission note (who / when / how) and the reason; never the image.
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.logo_saved', $1::jsonb)", [JSON.stringify({
        badge: def.id, permission: note, backing, reason, value: noteText(note), ...(replaced ? { before: noteText(replaced) } : {}),
      })]);
    });
    const saved = await definitionById(db, def.id);
    res.json({ ok: true, replaced: Boolean(replaced), logo: logoView(saved) });
  }));

  r.delete('/badges/:id/logo/pending', writes, route(async (req, res) => {
    await db.query("DELETE FROM badge_logos WHERE badge_id = $1 AND stage = 'pending'", [String(req.params.id)]);
    res.json({ ok: true });
  }));

  // Remove: the badge shows its own art again (the template's, or the monogram); holders keep the badge.
  r.delete('/badges/:id/logo', writes, route(async (req, res) => {
    const reason = reasonOf(req.body?.reason);
    const def = await logoBadge(req.params.id);
    await db.tx(async (q) => {
      const old = await q.one("SELECT permission_by, permission_at, permission_how FROM badge_logos WHERE badge_id = $1 AND stage = 'saved' FOR UPDATE", [def.id]);
      if (!old) throw new HttpError(409, `${def.name} has no saved logo.`, 'no_logo');
      const was = { by: old.permission_by, at: old.permission_at, how: old.permission_how };
      await q.query("DELETE FROM badge_logos WHERE badge_id = $1 AND stage = 'saved'", [def.id]);
      await logEvent(q, { type: 'logo_removed', badgeId: def.id, actor: 'admin', reason, detail: { permission: was } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.logo_removed', $1::jsonb)", [JSON.stringify({ badge: def.id, permission: was, reason, before: noteText(was) })]);
    });
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

  // ---- Verified Content Creators (0.8.1, badges/creators.js). Everstats never fetches the channel: the admin checks
  // the code by hand, then ticks the handles. Every step is logged.
  r.post('/badges/accounts/:id/creator/start', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    await db.tx(async (q) => {
      if (!(await q.one('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]))) throw new HttpError(404, 'No such account.');
      const { started } = await startVerification(q, accountId);
      if (started) await q.query("INSERT INTO admin_events (type, detail) VALUES ('badge.creator_started', $1::jsonb)", [JSON.stringify({ account: accountId })]);
    });
    res.json({ account: await accountBadges(db, accountId) });
  }));

  r.post('/badges/accounts/:id/creator/grant', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    const reason = reasonOf(req.body?.reason);
    if (req.body?.codeChecked !== true) throw new HttpError(400, 'Tick “I saw the code on their channel” first.', 'code_unchecked');
    await db.tx(async (q) => {
      if (!(await q.one('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]))) throw new HttpError(404, 'No such account.');
      await grantCreator(q, { accountId, platforms: req.body?.platforms, reason, notify: req.body?.notify !== false });
    });
    res.json({ account: await accountBadges(db, accountId) });
  }));

  r.post('/badges/accounts/:id/creator/checked', writes, route(async (req, res) => {
    const accountId = idParam(req.params.id);
    await db.tx((q) => clearAlert(q, accountId));
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
