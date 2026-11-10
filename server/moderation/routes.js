import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { pageLimit } from '../core/db.js';
import { getSetting } from '../admin/settings.js';
import { getProvider } from '../auth/providers.js';
import { totpState } from '../auth/totp.js';
import { clearCardMemo } from '../cards/routes.js';
import { actorOf, can, capabilities, hasStrongSignIn, MODERATOR_MAX_BAN_DAYS } from './permissions.js';
import { LIVE } from './bans.js';
import { BAN_PRESETS, ban, cleanReason, closeReports, forceRename, logAction, need, resetField, resettableFields, reveal, setRole, unban, warn } from './actions.js';
import { guildText, managedGuilds, resetGuildField } from './guilds.js';
import { fieldWords } from './notices.js';
import { REPORT_WHAT } from './player.js';

/**
 * /api/admin/moderation… (0.8.2): Admin → Accounts, an account's Moderation section and history, and Admin → Reports.
 *
 * Mounted inside the admin router BEFORE its admin-only gate, with a gate of its own: the admin session, or (only while
 * the setting moderation.moderators is on) a player session with the moderator role. Anyone else gets the same plain
 * 404 as every admin route. Each route then asks permissions.js whether this actor may do it.
 */
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};
const MARKER = 'admin_activity_checked_at';
export const ACCOUNT_FILTERS = Object.freeze({
  all: 'Everyone',
  new: 'New since I last checked',
  beta: 'Beta members',
  placeholder: 'Placeholder usernames',
  no_battlenet: 'No Battle.net linked',
  unread_feedback: 'Unread feedback',
  open_reports: 'Open reports',
  warned: 'Warned',
  banned: 'Banned',
});
const FILTER_SQL = {
  all: 'true',
  new: '($2::timestamptz IS NOT NULL AND a.created_at >= $2)',
  beta: 'a.beta_member',
  placeholder: 'NOT a.username_claimed',
  no_battlenet: "NOT EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id AND i.provider = 'battlenet')",
  unread_feedback: "EXISTS (SELECT 1 FROM feedback_threads f WHERE f.account_id = a.id AND f.state = 'unread')",
  open_reports: "EXISTS (SELECT 1 FROM reports r WHERE r.target_account_id = a.id AND r.state = 'open')",
  warned: "EXISTS (SELECT 1 FROM moderation_actions m WHERE m.account_id = a.id AND m.type = 'warning')",
  banned: 'everstats_banned(a.id)',
};
const SIGN_IN_EVENTS = ['signed_in', 'second_factor_passed', 'signed_in_banned'];

/**
 * 0.10.3 (design/v5-admin directory-accounts): extra filters that combine with `filter` and the search. Each value is a
 * fixed SQL fragment (whitelisted keys; nothing from the request is interpolated).
 */
export const EXTRA_FILTERS = Object.freeze({
  status: {
    active: `NOT everstats_banned(a.id) AND NOT EXISTS (SELECT 1 FROM moderation_actions m WHERE m.account_id = a.id AND m.type = 'warning')`,
    warned: `NOT everstats_banned(a.id) AND EXISTS (SELECT 1 FROM moderation_actions m WHERE m.account_id = a.id AND m.type = 'warning')`,
    temp_banned: `EXISTS (SELECT 1 FROM account_bans b WHERE b.account_id = a.id AND b.kind = 'temporary' AND ${LIVE})
                  AND NOT EXISTS (SELECT 1 FROM account_bans b WHERE b.account_id = a.id AND b.kind = 'permanent' AND ${LIVE})`,
    banned: `EXISTS (SELECT 1 FROM account_bans b WHERE b.account_id = a.id AND b.kind = 'permanent' AND ${LIVE})`,
  },
  signin: {
    battlenet: "EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id AND i.provider = 'battlenet')",
    discord: "EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id AND i.provider = 'discord')",
    passkey: 'EXISTS (SELECT 1 FROM passkeys p WHERE p.account_id = a.id)',
  },
  twofa: {
    on: "EXISTS (SELECT 1 FROM account_totp t WHERE t.account_id = a.id AND t.state = 'enabled')",
    off: "NOT EXISTS (SELECT 1 FROM account_totp t WHERE t.account_id = a.id AND t.state = 'enabled')",
  },
  created: {
    '7d': "a.created_at >= now() - interval '7 days'",
    '30d': "a.created_at >= now() - interval '30 days'",
  },
});
const extraSql = (query) => Object.entries(EXTRA_FILTERS)
  .filter(([k, map]) => typeof query[k] === 'string' && Object.hasOwn(map, query[k]))
  .map(([k, map]) => `(${map[query[k]]})`);
const extraChosen = (query) => Object.fromEntries(Object.entries(EXTRA_FILTERS)
  .filter(([k, map]) => typeof query[k] === 'string' && Object.hasOwn(map, query[k])).map(([k]) => [k, query[k]]));

/** active | warned | temp-banned (until) | banned, from the live ban and the warnings. */
const statusOf = (r) => {
  if (r.ban_kind === 'permanent') return { id: 'banned', until: null };
  if (r.ban_kind === 'temporary') return { id: 'temp_banned', until: r.ban_until };
  if (r.warned) return { id: 'warned', until: null };
  return { id: 'active', until: null };
};

const ACCOUNT_COLUMNS = `
  a.id, a.created_at, a.username, a.username_claimed, a.display_name, a.beta_member, a.role,
  (SELECT max(e.created_at) FROM account_events e WHERE e.account_id = a.id AND e.type = ANY($${'{EV}'}::text[])) AS last_sign_in,
  (SELECT count(*)::int FROM characters c WHERE c.owner_account_id = a.id AND c.profile_state <> 'purged') AS characters,
  (SELECT count(*)::int FROM badge_awards w WHERE w.account_id = a.id AND w.state = 'held') AS badges,
  EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id AND i.provider = 'battlenet') AS has_battlenet,
  EXISTS (SELECT 1 FROM account_identities i WHERE i.account_id = a.id AND i.provider = 'discord') AS has_discord,
  (SELECT count(*)::int FROM passkeys p WHERE p.account_id = a.id) AS passkeys,
  EXISTS (SELECT 1 FROM account_totp t WHERE t.account_id = a.id AND t.state = 'enabled') AS two_factor,
  (SELECT count(*)::int FROM feedback_threads f WHERE f.account_id = a.id) AS feedback,
  (SELECT count(*)::int FROM feedback_threads f WHERE f.account_id = a.id AND f.state = 'unread') AS feedback_unread,
  (SELECT count(*)::int FROM reports r WHERE r.target_account_id = a.id AND r.state = 'open') AS open_reports,
  EXISTS (SELECT 1 FROM moderation_actions m WHERE m.account_id = a.id AND m.type = 'warning') AS warned,
  (SELECT b.kind FROM account_bans b WHERE b.account_id = a.id AND ${LIVE} ORDER BY b.ends_at DESC NULLS FIRST LIMIT 1) AS ban_kind,
  (SELECT b.ends_at FROM account_bans b WHERE b.account_id = a.id AND ${LIVE} ORDER BY b.ends_at DESC NULLS FIRST LIMIT 1) AS ban_until`;
const columns = (evParam) => ACCOUNT_COLUMNS.replace(`$${'{EV}'}`, `$${evParam}`);

const rowView = (r) => ({
  id: Number(r.id), createdAt: r.created_at, lastSignIn: r.last_sign_in,
  username: r.username, claimed: r.username_claimed, displayName: r.display_name, beta: r.beta_member, role: r.role,
  characters: r.characters, badges: r.badges,
  signIn: { battlenet: r.has_battlenet, discord: r.has_discord, passkey: r.passkeys > 0 },
  twoFactor: r.two_factor,
  feedback: { threads: r.feedback, unread: r.feedback_unread },
  openReports: r.open_reports,
  status: statusOf(r),
});

/** Who did it, for the history: "Admin", or the moderator's @username (or their account number). */
async function actorNames(db, rows) {
  const ids = [...new Set(rows.filter((r) => r.actor === 'moderator' && r.actor_account_id).map((r) => Number(r.actor_account_id)))];
  const names = ids.length ? await db.query('SELECT id, username, username_claimed FROM accounts WHERE id = ANY($1::bigint[])', [ids]) : [];
  const by = new Map(names.map((n) => [Number(n.id), n.username_claimed ? `@${n.username}` : `moderator #${n.id}`]));
  return (r) => (r.actor === 'admin' ? 'Admin' : r.actor === 'system' ? 'Everstats' : by.get(Number(r.actor_account_id)) ?? `moderator #${r.actor_account_id}`);
}

/** What changed, in words, for the history list. */
function changedWords(a) {
  const d = a.detail ?? {};
  switch (a.type) {
    case 'warning': return 'Warned';
    case 'username_reset': return `Username @${d.from} reset to a placeholder${d.held ? ' (old name held)' : ' (old name released)'}`;
    case 'field_reset': return `Reset ${fieldWords(d)}${d.was ? `: “${String(d.was).slice(0, 80)}”` : ''}`;
    case 'guild_reset': return `Reset the ${d.part === 'links' ? 'links' : d.part === 'discord' ? 'Discord invite' : 'description'} of ${d.guildName ?? 'a guild page'}`;
    case 'ban': return d.kind === 'permanent' ? 'Banned permanently' : `Banned until ${new Date(d.until).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    case 'unban': return 'Ban lifted';
    case 'role_granted': return `Moderator role given${d.badge ? ' (with the badge)' : ''}`;
    case 'role_removed': return `Moderator role removed${d.badge ? ' (badge revoked)' : ''}`;
    case 'identities_revealed': return 'Revealed BattleTag / Discord name';
    case 'reports_dismissed': return `Dismissed ${d.count ?? ''} report${d.count === 1 ? '' : 's'}`;
    case 'reports_actioned': return `Marked ${d.count ?? ''} report${d.count === 1 ? '' : 's'} actioned`;
    default: return a.type;
  }
}

const reportItem = (r) => ({
  id: Number(r.id), at: r.reported_at, what: r.what, whatLabel: REPORT_WHAT[r.what] ?? (r.what === 'guild_description' ? 'Guild description' : r.what),
  platform: r.platform, note: r.note, snapshot: r.snapshot, signedIn: r.reporter_signed_in, state: r.state, resolvedAt: r.resolved_at,
});

async function accountDetail(db, actor, id) {
  const rows = await db.query(`SELECT ${columns(2)} FROM accounts a WHERE a.id = $1`, [id, SIGN_IN_EVENTS]);
  if (!rows.length) throw new HttpError(404, 'No such account.');
  const summary = rowView(rows[0]);
  const extra = await db.one('SELECT profile_bio, rename_allowance, role_since FROM accounts WHERE id = $1', [id]);
  const identities = await db.query('SELECT provider, linked_at, last_used_at FROM account_identities WHERE account_id = $1 ORDER BY linked_at LIMIT 20', [id]);
  const bans = await db.query(
    `SELECT b.*, (${LIVE}) AS live FROM account_bans b WHERE b.account_id = $1 ORDER BY b.starts_at DESC LIMIT 50`, [id]);
  const history = await db.query('SELECT * FROM moderation_actions WHERE account_id = $1 ORDER BY at DESC, id DESC LIMIT 200', [id]);
  const name = await actorNames(db, history.concat(bans.map((b) => ({ actor: b.actor, actor_account_id: b.actor_account_id }))));
  const reports = await db.query('SELECT * FROM reports WHERE target_account_id = $1 ORDER BY reported_at DESC LIMIT 100', [id]);
  const appeals = await db.query("SELECT id, state, updated_at FROM feedback_threads WHERE account_id = $1 AND type = 'appeal' ORDER BY updated_at DESC LIMIT 20", [id]);
  return {
    ...summary,
    bio: extra.profile_bio,
    roleSince: extra.role_since,
    identities: identities.map((i) => ({ provider: i.provider, label: getProvider(i.provider)?.label ?? i.provider, linkedAt: i.linked_at, lastUsedAt: i.last_used_at })),
    strongSignIn: await hasStrongSignIn(db, id),
    twoFactorState: (await totpState(db, id)).state,
    fields: await resettableFields(db, id),
    bans: bans.map((b) => ({
      id: Number(b.id), kind: b.kind, live: b.live, startsAt: b.starts_at, endsAt: b.ends_at, reason: b.reason, message: b.message,
      by: name({ actor: b.actor, actor_account_id: b.actor_account_id }), liftedAt: b.lifted_at, liftedReason: b.lifted_reason,
    })),
    history: history.map((a) => ({
      id: Number(a.id), at: a.at, type: a.type, by: name(a), reason: a.reason, message: a.message, changed: changedWords(a),
      notice: a.notice, acknowledgedAt: a.acknowledged_at,
    })),
    reports: reports.map(reportItem),
    appeals: appeals.map((t) => ({ id: Number(t.id), state: t.state, updatedAt: t.updated_at })),
  };
}

/** The Reports queue, grouped by what was reported, newest activity first. Guild-link reports (0.7.0) are included. */
async function reportsQueue(db, state) {
  const rows = await db.query('SELECT * FROM reports WHERE state = $1 ORDER BY reported_at DESC LIMIT 500', [state]);
  const linkState = { open: 'open', actioned: 'removed', dismissed: 'dismissed' }[state];
  const links = await db.query(
    `SELECT r.id, r.reported_at, r.note, r.state, r.resolved_at, l.id AS link_id, l.label, l.url, l.host, l.removed_at, r.guild_id
       FROM guild_link_reports r JOIN guild_links l ON l.id = r.link_id WHERE r.state = $1 ORDER BY r.reported_at DESC LIMIT 500`,
    [linkState],
  );
  const accountIds = [...new Set(rows.filter((r) => r.target_account_id).map((r) => Number(r.target_account_id)))];
  const guildIds = [...new Set(rows.filter((r) => r.target_guild_id).map((r) => Number(r.target_guild_id)).concat(links.map((l) => Number(l.guild_id))))];
  const accounts = accountIds.length ? await db.query('SELECT id, username, username_claimed, display_name, everstats_banned(id) AS banned FROM accounts WHERE id = ANY($1::bigint[])', [accountIds]) : [];
  const guilds = guildIds.length ? await db.query('SELECT DISTINCT ON (id) id, slug, name FROM guilds WHERE id = ANY($1::bigint[]) ORDER BY id, updated_at DESC', [guildIds]) : [];
  const acc = new Map(accounts.map((a) => [Number(a.id), a]));
  const gl = new Map(guilds.map((g) => [Number(g.id), g]));
  const groups = new Map();
  const add = (key, make, item) => {
    if (!groups.has(key)) groups.set(key, { ...make(), items: [] });
    groups.get(key).items.push(item);
  };
  for (const r of rows) {
    if (r.target_kind === 'account') {
      const a = acc.get(Number(r.target_account_id));
      add(`account:${r.target_account_id}`, () => ({
        target: { kind: 'account', id: Number(r.target_account_id), label: a ? (a.username_claimed ? `@${a.username}` : `${a.username} (placeholder)`) : `Deleted account #${r.target_account_id}`, displayName: a?.display_name ?? null, banned: Boolean(a?.banned), exists: Boolean(a) },
      }), reportItem(r));
    } else {
      const g = gl.get(Number(r.target_guild_id));
      add(`guild:${r.target_guild_id}`, () => ({ target: { kind: 'guild', id: Number(r.target_guild_id), label: g?.name ?? r.snapshot?.guild ?? `Guild #${r.target_guild_id}`, slug: g?.slug ?? null } }), reportItem(r));
    }
  }
  for (const l of links) {
    const g = gl.get(Number(l.guild_id));
    add(`link:${l.link_id}`, () => ({
      target: { kind: 'link', id: Number(l.link_id), label: `${l.label} — ${l.host}`, url: l.url, removed: Boolean(l.removed_at), guild: g ? { id: Number(l.guild_id), slug: g.slug, name: g.name } : null },
    }), { id: Number(l.id), at: l.reported_at, what: 'link', whatLabel: 'Guild link', note: l.note, snapshot: {}, signedIn: null, state, resolvedAt: l.resolved_at });
  }
  const list = [...groups.values()].map((g) => ({ ...g, count: g.items.length, latest: g.items[0].at, items: g.items.slice(0, 25) }));
  list.sort((a, b) => new Date(b.latest) - new Date(a.latest));
  const counts = await db.one(
    `SELECT (SELECT count(*)::int FROM reports WHERE state = 'open') + (SELECT count(*)::int FROM guild_link_reports WHERE state = 'open') AS open`,
  );
  return { state, groups: list.slice(0, 200), open: counts.open };
}

export function createModerationRouter({ db, writes }) {
  const r = express.Router();

  // The gate: the admin, or a moderator (only while moderators are switched on). Anyone else: the same plain 404.
  r.use('/moderation', route(async (req, res, next) => {
    const actor = await actorOf(db, req);
    if (!actor) throw new HttpError(404, 'Not found');
    req.moderationActor = actor;
    next();
  }));
  const actorFrom = (req) => req.moderationActor;
  const changed = () => clearCardMemo();

  r.get('/moderation/me', route(async (req, res) => {
    const actor = actorFrom(req);
    res.json({
      actor: { kind: actor.kind },
      can: capabilities(actor),
      moderatorsOn: Boolean(await getSetting(db, 'moderation.moderators')),
      banPresets: BAN_PRESETS,
      moderatorMaxBanDays: MODERATOR_MAX_BAN_DAYS,
      reportWhat: REPORT_WHAT,
    });
  }));

  // 0.10.3: the Audit log for whoever passed the gate. A moderator sees ONLY their own entries (design/v5-admin: a
  // moderator would see Inbox › Reports, the parts of Directory › Accounts they may use, and their own audit entries).
  r.get('/moderation/audit', route(async (req, res) => {
    const actor = actorFrom(req);
    const { auditPage } = await import('../audit/log.js');
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    if (actor.kind !== 'moderator') throw new HttpError(404, 'Not found'); // the admin reads /api/admin/audit
    res.json(await auditPage(db, { actorAccountId: actor.accountId, cursor }));
  }));

  // ---- Admin → Accounts (admin only): every player account, newest first, searchable and filterable. No export.
  r.get('/moderation/accounts', route(async (req, res) => {
    need(actorFrom(req), 'accounts.list');
    const filter = Object.hasOwn(FILTER_SQL, req.query.filter) ? req.query.filter : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().replace(/^@/, '').slice(0, 40) : '';
    const limit = pageLimit(req.query.limit, { fallback: 50, max: 100 });
    const cursor = Number.isSafeInteger(Number(req.query.cursor)) && Number(req.query.cursor) > 0 ? Number(req.query.cursor) : null;
    const marker = (await db.one('SELECT at FROM pipeline_facts WHERE key = $1', [MARKER]))?.at ?? null;
    const like = `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}`;
    const extra = extraSql(req.query).map((s) => ` AND ${s}`).join('');
    const rows = await db.query(
      `SELECT ${columns(6)} FROM accounts a
        WHERE ${FILTER_SQL[filter]}${extra} AND ($2::timestamptz IS NULL OR $2::timestamptz IS NOT NULL)
          AND ($1 = '' OR a.id::text = $1 OR a.username LIKE $3 || '%' OR lower(a.display_name) LIKE '%' || $3 || '%'
               OR a.id IN (SELECT h.account_id FROM username_history h WHERE h.old_name LIKE $3 || '%'))
          AND ($4::bigint IS NULL OR a.id < $4)
        ORDER BY a.id DESC LIMIT $5`,
      [q, marker, like, cursor, limit + 1, SIGN_IN_EVENTS],
    );
    // How many accounts the filter matches (search aside), for "N accounts".
    const total = (await db.one(`SELECT count(*)::int AS n FROM accounts a WHERE ${FILTER_SQL[filter]}${extra} AND ($1::text IS NULL OR $2::timestamptz IS NULL OR true)`, [null, marker])).n;
    const page = rows.slice(0, limit);
    res.json({
      filter, filters: ACCOUNT_FILTERS, extra: extraChosen(req.query), q, checkedAt: marker, total,
      accounts: page.map(rowView),
      next: rows.length > limit ? Number(page[page.length - 1].id) : null,
    });
  }));

  r.get('/moderation/accounts/:id', route(async (req, res) => {
    const actor = actorFrom(req);
    need(actor, 'account.view');
    res.json({ account: await accountDetail(db, actor, idParam(req.params.id)), can: capabilities(actor) });
  }));

  const act = (fn) => route(async (req, res) => {
    const actor = actorFrom(req);
    const id = idParam(req.params.id);
    const extra = await fn(actor, id, req.body ?? {});
    res.json({ account: await accountDetail(db, actor, id), ...(extra && typeof extra === 'object' ? { result: extra } : {}) });
  });
  r.post('/moderation/accounts/:id/warn', writes, act((actor, id, body) => warn(db, actor, id, body)));
  r.post('/moderation/accounts/:id/rename', writes, act((actor, id, body) => forceRename(db, actor, id, body)));
  r.post('/moderation/accounts/:id/reset', writes, act((actor, id, body) => resetField(db, actor, id, body)));
  r.post('/moderation/accounts/:id/ban', writes, act((actor, id, body) => ban(db, actor, id, body, { onChanged: changed })));
  r.post('/moderation/accounts/:id/unban', writes, act((actor, id, body) => unban(db, actor, id, body, { onChanged: changed })));
  r.put('/moderation/accounts/:id/role', writes, act((actor, id, body) => setRole(db, actor, id, body)));
  // 0.10.3: the v5 admin asks for a reason before it reveals (design/v5-admin: "Reveal shows a redacted value until the
  // admin gives a reason"); the reason is logged with the reveal, the revealed names never are.
  r.post('/moderation/accounts/:id/reveal', writes, route(async (req, res) => {
    const reason = req.body?.reason ? cleanReason(req.body.reason, { label: 'The reason' }) : null;
    res.json({ identities: await reveal(db, actorFrom(req), idParam(req.params.id), { reason }) });
  }));

  // ---- Admin → Reports: profiles, guild descriptions and guild links, grouped by target.
  r.get('/moderation/reports', route(async (req, res) => {
    need(actorFrom(req), 'reports.view');
    const state = ['open', 'actioned', 'dismissed'].includes(req.query.state) ? req.query.state : 'open';
    res.json(await reportsQueue(db, state));
  }));

  // 0.10.3: the Inbox tab count without loading the queue.
  r.get('/moderation/reports/count', route(async (req, res) => {
    need(actorFrom(req), 'reports.view');
    const row = await db.one(
      `SELECT (SELECT count(*)::int FROM reports WHERE state = 'open') + (SELECT count(*)::int FROM guild_link_reports WHERE state = 'open') AS open`,
    );
    res.json({ open: row.open });
  }));

  // Dismiss (or mark actioned) every open report about one target.
  r.post('/moderation/reports/resolve', writes, route(async (req, res) => {
    const actor = actorFrom(req);
    const state = req.body?.state === 'actioned' ? 'actioned' : 'dismissed';
    need(actor, 'reports.dismiss');
    // 0.10.3: the v5 Inbox asks for a reason (logged with the action); older callers may leave it out.
    const reason = req.body?.reason ? cleanReason(req.body.reason, { label: 'The reason' }) : null;
    const kind = req.body?.target?.kind;
    const id = idParam(req.body?.target?.id);
    const count = await db.tx(async (q) => {
      let n;
      if (kind === 'link') {
        n = (await q.query(`UPDATE guild_link_reports SET state = $2, resolved_at = now() WHERE link_id = $1 AND state = 'open' RETURNING guild_id`, [id, state === 'actioned' ? 'removed' : 'dismissed'])).length;
      } else if (kind === 'account' || kind === 'guild') {
        n = await closeReports(q, { accountId: kind === 'account' ? id : null, guildId: kind === 'guild' ? id : null, actor, state });
      } else {
        throw new HttpError(400, 'Which reports?', 'invalid');
      }
      if (!n) throw new HttpError(409, 'Those reports are already handled.', 'nothing');
      await logAction(q, {
        accountId: kind === 'account' ? id : null, guildId: kind === 'guild' ? id : null,
        type: state === 'actioned' ? 'reports_actioned' : 'reports_dismissed', actor, reason, detail: { count: n, target: kind, link: kind === 'link' ? id : undefined },
      });
      return n;
    });
    res.json({ ok: true, count, ...(await reportsQueue(db, 'open')) });
  }));

  // ---- A reported guild page: its text and moderation history, and resetting a part of it.
  r.get('/moderation/guilds/:id', route(async (req, res) => {
    const actor = actorFrom(req);
    need(actor, 'reports.view');
    const id = idParam(req.params.id);
    const g = await db.one('SELECT id, slug, name FROM guilds WHERE id = $1 ORDER BY updated_at DESC LIMIT 1', [id]);
    const history = await db.query('SELECT * FROM moderation_actions WHERE guild_id = $1 ORDER BY at DESC LIMIT 100', [id]);
    const name = await actorNames(db, history);
    const reports = await db.query('SELECT * FROM reports WHERE target_guild_id = $1 ORDER BY reported_at DESC LIMIT 100', [id]);
    res.json({
      guild: { id, slug: g?.slug ?? null, name: g?.name ?? null, ...(await guildText(db, id)) },
      history: history.map((a) => ({ id: Number(a.id), at: a.at, type: a.type, by: name(a), reason: a.reason, changed: changedWords(a) })),
      reports: reports.map(reportItem),
      can: capabilities(actor),
    });
  }));

  r.post('/moderation/guilds/:id/reset', writes, route(async (req, res) => {
    const actor = actorFrom(req);
    need(actor, 'fields.reset');
    const id = idParam(req.params.id);
    const part = ['description', 'links', 'discord'].includes(req.body?.part) ? req.body.part : null;
    if (!part) throw new HttpError(400, 'Choose what to reset.', 'invalid');
    const reason = cleanReason(req.body?.reason);
    const g = await db.one('SELECT name FROM guilds WHERE id = $1 ORDER BY updated_at DESC LIMIT 1', [id]);
    await db.tx(async (q) => {
      await resetGuildField(q, { guildId: id, part, actor, reason });
      const closed = req.body?.closeReports !== false ? await closeReports(q, { guildId: id, actor }) : 0;
      await logAction(q, { guildId: id, type: 'guild_reset', actor, reason, detail: { part, guildName: g?.name ?? null, reportsClosed: closed } });
    });
    res.json({ ok: true });
  }));

  return r;
}

export { can, managedGuilds };
