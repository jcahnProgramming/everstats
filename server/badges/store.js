import { createHash } from 'node:crypto';
import { getSetting } from '../admin/settings.js';
import { HttpError } from '../core/errors.js';
import { FAMILIES, FAMILY_IDS, FEATURED_MAX, FIRST_FAMILIES, familyOf } from './catalog.js';

/**
 * Badge definitions and awards (0.7.0). Everything here is Everstats' own data.
 *
 * An award is one row per (account, badge). Revoking (by the admin, or by the rule for a kept-while-held badge like
 * S-Tier) is a STATE with a reason and a badge_events row, never a delete. Every other automatic badge stays once
 * earned, whatever happens to the character later.
 *
 * Display choices, per award (the player's, in Settings → Badges):
 *   shown     public: on the profile and in "All badges". Off = private everywhere (only the player sees it).
 *   featured  in the profile's row (at most FEATURED_MAX), ordered by `position`; staff and partner always first.
 *   pinned    the ONE badge shown inline next to the username (header, "Claimed by", guild rosters). Nothing pinned →
 *             the first featured badge; nothing featured → the first public badge; nothing public → no inline badge.
 */
const DEF_COLUMNS = `d.id, d.family, d.name, d.description, d.how, d.art, d.template, d.monogram, d.award, d.rule, d.kept_while_held,
  d.time_limited, d.verified, d.verification, d.sort, d.mark_sha, d.mark_set_at, d.created_at, d.created_by`;

export async function loadDefinitions(db) {
  return db.query(`SELECT ${DEF_COLUMNS} FROM badge_definitions d ORDER BY d.sort, d.id LIMIT 500`);
}

export const definitionById = (db, id) => db.one(`SELECT ${DEF_COLUMNS} FROM badge_definitions d WHERE d.id = $1`, [id]);

/** The Early Supporter window from the admin setting: unset, open, upcoming or closed. */
export async function earlyWindow(db, now = Date.now()) {
  const w = await getSetting(db, 'badges.earlySupporter');
  if (!w) return { set: false };
  const start = Date.parse(`${w.start}T00:00:00Z`);
  const end = Date.parse(`${w.end}T00:00:00Z`) + 24 * 60 * 60 * 1000; // the end day is included
  return { set: true, start: w.start, end: w.end, startMs: start, endMs: end, closed: now >= end, upcoming: now < start };
}

/** The beta window's state, for Beta Tester's "No longer available" once the beta has closed. */
async function betaWindow(db) {
  const { betaState } = await import('../beta.js');
  return betaState(db);
}

export async function badgeContext(db, now = Date.now()) {
  return { early: await earlyWindow(db, now), beta: await betaWindow(db) };
}

/** A definition that shows nowhere: Early Supporter without a window. */
export const isHidden = (def, ctx) => def.rule?.type === 'early-supporter' && !ctx.early.set;

/**
 * Can THIS account still earn a badge it doesn't hold? → { status, note }
 *   earnable     listed under "Badges you can earn", with how to earn it
 *   unavailable  can't be earned any more (or never by this account): "No longer available", with why
 *   granted      staff / partner / hand-made achievements: never listed as earnable (granted, not earned)
 */
export function availabilityFor(def, ctx, account) {
  if (def.award === 'manual') return { status: 'granted', note: null };
  if (def.rule.type === 'beta') {
    if (!ctx.beta.open) return { status: 'unavailable', note: `The beta closed${ctx.beta.closedAt ? ` on ${dateOnly(ctx.beta.closedAt)}` : ''}. Only accounts created while it was open have this badge.` };
    // 0.7.1 (owner): while the beta is still open this badge is NOT "no longer available" to an older account; it was
    // never available to it. Its own status and words.
    return { status: 'ineligible', note: `Only for accounts created while the beta is open (since ${dateOnly(ctx.beta.openedAt)}). This account was made before the beta opened.` };
  }
  if (def.rule.type === 'early-supporter') {
    const span = `${ctx.early.start} – ${ctx.early.end} (UTC)`;
    if (ctx.early.closed) return { status: 'unavailable', note: `Window ${span}. It has closed.` };
    if (account && Date.parse(account.created_at) < ctx.early.startMs) return { status: 'unavailable', note: `Only accounts created ${span} get this badge.` };
    return { status: 'earnable', note: `Accounts created ${span} get this badge.` };
  }
  return { status: 'earnable', note: null };
}

const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);

export const markUrl = (def) => (def.mark_sha ? `/api/badges/${def.id}/mark.png?v=${def.mark_sha.slice(0, 12)}` : null);

/** What any page may show about a definition (never the mark bytes, never who granted it). */
export function publicBadge(def, ctx = null) {
  const fam = familyOf(def.family);
  return {
    id: def.id,
    family: def.family,
    familyLabel: fam?.label ?? def.family,
    frame: fam?.frame ?? null,
    name: def.name,
    description: def.description,
    how: def.how,
    art: def.art,
    template: def.template,
    monogram: def.monogram,
    mark: markUrl(def),
    award: def.award,
    verified: def.verified,
    timeLimited: def.time_limited,
    keptWhileHeld: def.kept_while_held,
    window: def.rule?.type === 'early-supporter' && ctx?.early?.set ? { start: ctx.early.start, end: ctx.early.end, closed: ctx.early.closed } : null,
  };
}

/** How many accounts hold each badge right now (real counts, nothing estimated). */
export async function holderCounts(db, ids = null) {
  const rows = await db.query(
    `SELECT badge_id, count(*)::int AS n FROM badge_awards WHERE state = 'held' AND ($1::text[] IS NULL OR badge_id = ANY($1::text[])) GROUP BY badge_id LIMIT 1000`,
    [ids],
  );
  return new Map(rows.map((r) => [r.badge_id, r.n]));
}

/** Row order: staff and partner first, then the player's order, then the catalog's. */
export function rowOrder(a, b) {
  const fa = FIRST_FAMILIES.includes(a.family) ? 0 : 1;
  const fb = FIRST_FAMILIES.includes(b.family) ? 0 : 1;
  if (fa !== fb) return fa - fb;
  const pa = a.position ?? 9999;
  const pb = b.position ?? 9999;
  if (pa !== pb) return pa - pb;
  return (a.sort - b.sort) || String(a.id).localeCompare(String(b.id));
}

/** An account's held awards joined to their definitions. */
export async function heldAwards(db, accountId) {
  return db.query(
    `SELECT ${DEF_COLUMNS}, a.earned_at, a.source, a.character_id, a.shown, a.featured, a.position, a.pinned, a.seen_at
       FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id
      WHERE a.account_id = $1 AND a.state = 'held' ORDER BY d.sort LIMIT 500`,
    [accountId],
  );
}

/**
 * The public badges of an account, as the profile shows them: { featured (the row), more (public, not featured) }.
 * ctx hides Early Supporter when no window is set.
 */
export async function publicBadgesOf(db, accountId, ctx) {
  const rows = (await heldAwards(db, accountId)).filter((r) => r.shown && !isHidden(r, ctx));
  const counts = await holderCounts(db, rows.map((r) => r.id));
  const view = (r) => ({ ...publicBadge(r, ctx), earnedAt: r.earned_at, heldBy: counts.get(r.id) ?? 0 });
  const featured = rows.filter((r) => r.featured).sort(rowOrder).slice(0, FEATURED_MAX);
  const ids = new Set(featured.map((r) => r.id));
  const more = rows.filter((r) => !ids.has(r.id)).sort(rowOrder);
  return { featured: featured.map(view), more: more.map(view) };
}

/** The single inline badge per account (pinned, else first featured, else first public), for many accounts at once. */
export async function inlineBadges(db, accountIds) {
  const ids = [...new Set(accountIds.filter((x) => x !== null && x !== undefined).map(Number))];
  if (!ids.length) return new Map();
  const ctx = await badgeContext(db);
  const rows = await db.query(
    `SELECT a.account_id, ${DEF_COLUMNS}, a.pinned, a.featured, a.position
       FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id
      WHERE a.account_id = ANY($1::bigint[]) AND a.state = 'held' AND a.shown LIMIT 20000`,
    [ids],
  );
  const by = new Map();
  for (const r of rows) {
    if (isHidden(r, ctx)) continue;
    if (!by.has(Number(r.account_id))) by.set(Number(r.account_id), []);
    by.get(Number(r.account_id)).push(r);
  }
  const out = new Map();
  for (const [id, list] of by) {
    const pick = list.find((r) => r.pinned) ?? list.filter((r) => r.featured).sort(rowOrder)[0] ?? [...list].sort(rowOrder)[0];
    if (pick) out.set(id, publicBadge(pick, ctx));
  }
  return out;
}

/**
 * Awards a badge (or restores one a rule removed). Returns true when something changed. Never touches a badge the
 * admin revoked unless `source` is 'admin' (a re-grant).
 *   notify: the player gets a toast ('earned' for automatic, 'granted' for the admin's grant).
 */
export async function award(q, { accountId, def, source, reason = null, characterId = null, notify = true, actor }) {
  const existing = await q.one('SELECT state, revoked_by FROM badge_awards WHERE account_id = $1 AND badge_id = $2 FOR UPDATE', [accountId, def.id]);
  const toast = notify ? (source === 'admin' ? 'granted' : 'earned') : null;
  if (existing?.state === 'held') return false;
  if (existing && existing.revoked_by === 'admin' && source !== 'admin') return false;
  const featuredNow = (await q.one("SELECT count(*)::int AS n, coalesce(max(position), 0)::int AS p FROM badge_awards WHERE account_id = $1 AND state = 'held' AND featured", [accountId]));
  // Staff and partner badges always lead the row (badge-row.md): one is featured even when the row is full, and
  // tidyDisplay then moves the last ordinary featured badge to "more".
  const feature = FIRST_FAMILIES.includes(def.family) || featuredNow.n < FEATURED_MAX;
  if (existing) {
    // Restored (S-Tier regained, or a re-grant): public again if the player had it public, featured if there's room.
    await q.query(
      `UPDATE badge_awards SET state = 'held', earned_at = now(), source = $3, reason = $4, character_id = coalesce($5, character_id),
              revoked_at = NULL, revoked_by = NULL, revoked_reason = NULL, seen_at = NULL, toast = $6,
              toast_at = CASE WHEN $6::text IS NULL THEN NULL ELSE now() END,
              featured = shown AND $7::boolean, position = CASE WHEN shown AND $7::boolean THEN $8::smallint ELSE NULL END
        WHERE account_id = $1 AND badge_id = $2`,
      [accountId, def.id, source, reason, characterId, toast, feature, featuredNow.p + 1],
    );
    await logEvent(q, { type: 'restored', badgeId: def.id, accountId, actor, reason });
    await tidyDisplay(q, accountId);
    return true;
  }
  await q.query(
    `INSERT INTO badge_awards (account_id, badge_id, source, reason, character_id, shown, featured, position, toast, toast_at)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END)`,
    [accountId, def.id, source, reason, characterId, feature, feature ? featuredNow.p + 1 : null, toast],
  );
  await logEvent(q, { type: source === 'admin' ? 'granted' : 'earned', badgeId: def.id, accountId, actor, reason });
  await tidyDisplay(q, accountId);
  return true;
}

/** Revokes a held badge: a state with a reason, logged. by 'admin' (manual badges) or 'rule' (kept-while-held). */
export async function revoke(q, { accountId, badgeId, by, reason, notify = true, actor }) {
  const rows = await q.query(
    `UPDATE badge_awards SET state = 'revoked', revoked_at = now(), revoked_by = $3, revoked_reason = $4,
            toast = CASE WHEN $5 THEN 'removed' ELSE NULL END, toast_at = CASE WHEN $5 THEN now() ELSE NULL END
      WHERE account_id = $1 AND badge_id = $2 AND state = 'held' RETURNING 1`,
    [accountId, badgeId, by, reason, notify && by === 'rule'],
  );
  if (!rows.length) return false;
  await logEvent(q, { type: by === 'rule' ? 'removed' : 'revoked', badgeId, accountId, actor, reason });
  await tidyDisplay(q, accountId);
  return true;
}

export async function logEvent(q, { type, badgeId = null, accountId = null, actor, reason = null, detail = {} }) {
  await q.query(
    'INSERT INTO badge_events (type, badge_id, account_id, actor, reason, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
    [type, badgeId, accountId, actor, reason ? String(reason).slice(0, 500) : null, JSON.stringify(detail)],
  );
}

/**
 * Keeps an account's display choices consistent after any change: at most FEATURED_MAX featured (staff and partner
 * first), positions 1..n with no gaps, nothing featured or pinned that isn't public and held.
 */
export async function tidyDisplay(q, accountId) {
  await q.query("UPDATE badge_awards SET featured = false, pinned = false, position = NULL WHERE account_id = $1 AND (NOT shown OR state <> 'held') AND (featured OR pinned OR position IS NOT NULL)", [accountId]);
  const rows = await q.query(
    `SELECT a.badge_id AS id, d.family, d.sort, a.position FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id
      WHERE a.account_id = $1 AND a.state = 'held' AND a.featured LIMIT 500`,
    [accountId],
  );
  const ordered = rows.sort(rowOrder);
  for (const [i, r] of ordered.entries()) {
    const keep = i < FEATURED_MAX;
    await q.query('UPDATE badge_awards SET featured = $3, position = $4 WHERE account_id = $1 AND badge_id = $2', [accountId, r.id, keep, keep ? i + 1 : null]);
  }
}

/**
 * The player's choices from Settings → Badges: { shown: [ids], featured: [ids in order], pinned: id | null }. Every id
 * must be a badge the account holds; featured ⊆ shown, at most FEATURED_MAX; pinned ∈ shown.
 */
export async function setDisplay(q, accountId, body) {
  const held = new Map((await q.query(
    `SELECT a.badge_id, d.family FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id WHERE a.account_id = $1 AND a.state = 'held' LIMIT 500`,
    [accountId],
  )).map((r) => [r.badge_id, r.family]));
  const list = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : null);
  const shown = list(body?.shown);
  const featured = list(body?.featured);
  const pinned = body?.pinned ?? null;
  if (!shown || !featured) throw new HttpError(400, 'Say which badges are public and which are featured.', 'invalid');
  for (const id of [...shown, ...featured, ...(pinned ? [pinned] : [])]) {
    if (!held.has(id)) throw new HttpError(400, 'That isn’t one of your badges.', 'invalid');
  }
  if (featured.length > FEATURED_MAX) throw new HttpError(400, `You can feature up to ${FEATURED_MAX}. Turn one off first.`, 'too_many');
  if (featured.some((id) => !shown.includes(id))) throw new HttpError(400, 'A featured badge has to be public.', 'invalid');
  if (pinned !== null && (typeof pinned !== 'string' || !shown.includes(pinned))) throw new HttpError(400, 'Pin a badge that’s public.', 'invalid');
  // Staff and partner first, otherwise the player's order.
  const order = [...featured.filter((id) => FIRST_FAMILIES.includes(held.get(id))), ...featured.filter((id) => !FIRST_FAMILIES.includes(held.get(id)))];
  await q.query('UPDATE badge_awards SET shown = false, featured = false, position = NULL, pinned = false WHERE account_id = $1', [accountId]);
  if (shown.length) await q.query('UPDATE badge_awards SET shown = true WHERE account_id = $1 AND badge_id = ANY($2::text[])', [accountId, shown]);
  for (const [i, id] of order.entries()) await q.query('UPDATE badge_awards SET featured = true, position = $3 WHERE account_id = $1 AND badge_id = $2', [accountId, id, i + 1]);
  if (pinned) await q.query('UPDATE badge_awards SET pinned = true WHERE account_id = $1 AND badge_id = $2', [accountId, pinned]);
}

/** Toasts waiting for this account (earned, granted, removed), oldest first. */
export async function pendingToasts(db, accountId) {
  const ctx = await badgeContext(db);
  const rows = await db.query(
    `SELECT ${DEF_COLUMNS}, a.toast, a.toast_at, a.revoked_reason FROM badge_awards a JOIN badge_definitions d ON d.id = a.badge_id
      WHERE a.account_id = $1 AND a.toast IS NOT NULL ORDER BY a.toast_at, d.sort LIMIT 50`,
    [accountId],
  );
  return rows.filter((r) => !isHidden(r, ctx)).map((r) => ({ kind: r.toast, at: r.toast_at, reason: r.toast === 'removed' ? r.revoked_reason : null, badge: publicBadge(r, ctx) }));
}

export async function clearToasts(db, accountId, ids) {
  await db.query('UPDATE badge_awards SET toast = NULL, toast_at = NULL WHERE account_id = $1 AND badge_id = ANY($2::text[])', [accountId, ids]);
}

/** Validates a definition id typed by the admin (lower-case words joined by hyphens). */
export function definitionId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(id) || id.includes('--') || id.endsWith('-')) throw new HttpError(400, 'An id is 2–48 lower-case letters, digits and single hyphens, starting with a letter.', 'invalid');
  return id;
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export { FAMILIES, FAMILY_IDS };
