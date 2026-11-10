import { HttpError } from '../core/errors.js';
import { FEATURES, switchSetting } from '../features/registry.js';
import { SETTINGS } from '../admin/settings.js';

/**
 * The Audit log (0.10.3, /admin/audit): every admin action in one list, newest first.
 *
 * It is a READ over the logs Everstats already keeps, not a second copy:
 *   admin_events        every admin change since 0.1.0 (settings, keys, badges, beta, Discovery decisions, guild links,
 *                       usernames, feedback replies…). From 0.10.3 a setting change also carries `before` and `reason`,
 *                       feature switches and Release tools are logged there, and so are admin sign-ins and sign-outs.
 *   moderation_actions  every warning, rename, reset, ban, unban, role change, reveal and report decision, with who
 *                       (the admin or a moderator) and why.
 * So the "backfill" is simply that everything those logs ever held shows here, as it was recorded. What older rows
 * don't have (a setting's previous value, a reason, admin sign-ins before 0.10.3) shows as "not recorded", never guessed.
 *
 * Never a secret: keys are logged as "added / replaced / removed" only, and a reveal logs THAT it happened, not what was
 * seen. admin_events types that duplicate a moderation_actions row (moderation.*) are left out of the admin_events side.
 */

const settingByKey = new Map(SETTINGS.map((s) => [s.key, s]));
// 0.11.1: a switchable game version's switch is the setting `versions.{id}` (features/registry.js switchSetting).
const featureBySetting = new Map(FEATURES.filter((f) => switchSetting(f)).map((f) => [switchSetting(f), f]));
const FEATURE_SETTING_KEYS = [...featureBySetting.keys()];

const ACCOUNT = (id) => (id ? { kind: 'account', id: String(id), href: `/admin/directory/accounts/${id}` } : null);

/** type → { area, label, target(detail) }. A type not listed still shows (area 'other', its own name). */
const TYPES = {
  'setting.changed': { area: 'settings' },
  'beta.changed': { area: 'features', label: (d) => `Beta ${d.open ? 'opened' : 'closed'}`, target: () => ({ kind: 'feature', id: 'beta', label: 'Beta', href: '/admin/features#feat-beta' }) },
  'beta.granted': { area: 'badges', label: () => 'Beta membership granted', target: (d) => ACCOUNT(d.account) },
  'credential.saved': { area: 'settings', label: (d) => `API key ${d.change ?? 'saved'}`, target: (d) => ({ kind: 'credential', id: d.provider, label: d.provider, href: '/admin/settings#keys' }) },
  'credential.removed': { area: 'settings', label: () => 'API key removed', target: (d) => ({ kind: 'credential', id: d.provider, label: d.provider, href: '/admin/settings#keys' }) },
  'badge.granted': { area: 'badges', label: (d) => `Badge granted: ${d.badge}`, target: (d) => ACCOUNT(d.account) },
  'badge.revoked': { area: 'badges', label: (d) => `Badge revoked: ${d.badge}`, target: (d) => ACCOUNT(d.account) },
  'badge.created': { area: 'badges', label: (d) => `Badge created: ${d.badge}`, target: (d) => ({ kind: 'badge', id: d.badge, href: `/admin/badges/player#badge-${d.badge}` }) },
  'badge.mark_saved': { area: 'badges', label: (d) => `Partner mark saved: ${d.badge}`, target: (d) => ({ kind: 'badge', id: d.badge, href: `/admin/badges/player#badge-${d.badge}` }) },
  // 0.10.4: badge logos. `value` / `before` are the permission note (who, when, how) as text; never the image.
  'badge.logo_saved': { area: 'badges', label: (d) => `Badge logo ${d.before ? 'replaced' : 'saved'}: ${d.badge}${d.permission ? ` (permission: ${d.permission.by}, ${d.permission.at}, ${d.permission.how})` : ''}`, target: (d) => ({ kind: 'badge', id: d.badge, href: `/admin/badges/player#logo` }) },
  'badge.logo_removed': { area: 'badges', label: (d) => `Badge logo removed: ${d.badge}`, target: (d) => ({ kind: 'badge', id: d.badge, href: `/admin/badges/player#logo` }) },
  'badge.creator_started': { area: 'badges', label: () => 'Creator verification started', target: (d) => ACCOUNT(d.account) },
  'badge.creator_verified': { area: 'badges', label: () => 'Creator verified', target: (d) => ACCOUNT(d.account) },
  'guild_badge.granted': { area: 'badges', label: (d) => `Guild badge granted: ${d.badge}`, target: (d) => (d.guild ? { kind: 'guild', id: String(d.guild), href: `/admin/directory/guilds?id=${d.guild}` } : null) },
  'guild_badge.revoked': { area: 'badges', label: (d) => `Guild badge revoked: ${d.badge}`, target: (d) => (d.guild ? { kind: 'guild', id: String(d.guild), href: `/admin/directory/guilds?id=${d.guild}` } : null) },
  'guild_badge.created': { area: 'badges', label: (d) => `Guild badge created: ${d.badge}` },
  'guild_badge.mark_saved': { area: 'badges', label: (d) => `Guild emblem saved: ${d.badge}` },
  'guild_badge.thresholds': { area: 'badges', label: (d) => `Guild badge thresholds: ${d.badge}` },
  'discovery.decided': { area: 'discovery', label: (d) => `Statistic ${d.kind} ${d.decision}`, target: (d) => ({ kind: 'statistic', id: String(d.statisticId), href: `/admin/discovery/approvals?stat=${d.statisticId}` }) },
  'discovery.group_decided': { area: 'tiers', label: (d) => `Tier group “${d.group}”: ${d.choice}`, target: (d) => ({ kind: 'group', id: d.group, href: `/admin/tiers?v=${d.version ?? 'forever'}` }) },
  'tiers.groups_migrated': { area: 'tiers', label: () => 'Tier decisions became group choices (one-time migration)' },
  'tiers.derived_groups_migrated': { area: 'tiers', label: () => 'Everstats-made boards now follow group choices (one-time migration; what counts is unchanged)' },
  'tiers.groups_seeded': { area: 'tiers', label: (d) => `Tier group choices set for ${d.version} (the owner’s decisions, ${d.groups?.length ?? 0} groups)`, target: (d) => ({ kind: 'tiers', id: d.version, href: `/admin/tiers?v=${d.version}` }) },
  'tiers.regrade_requested': { area: 'tiers', label: (d) => `Regrade requested${d.version ? ` (${d.version})` : ''}`, target: (d) => ({ kind: 'tiers', id: d.version ?? 'forever', href: `/admin/tiers?v=${d.version ?? 'forever'}` }) },
  'discovery.authorized': { area: 'discovery', label: () => 'Discovery Battle.net authorization' },
  'discovery.forgotten': { area: 'discovery', label: () => 'Discovery Battle.net token forgotten' },
  'discovery.reanalysed': { area: 'discovery', label: () => 'Discovery re-analysed' },
  'discovery.render_checked': { area: 'discovery', label: (d) => `Render check: ${d.verdict}` },
  'discovery.stop_requested': { area: 'discovery', label: () => 'Discovery run stop requested' },
  'feedback.replied': { area: 'inbox', label: () => 'Replied to feedback', target: (d) => ({ kind: 'feedback', id: String(d.thread), href: `/admin/inbox/feedback/${d.thread}` }) },
  'feedback.deleted': { area: 'inbox', label: () => 'Feedback thread deleted' },
  'guild_link.removed': { area: 'moderation', label: () => 'Guild link removed', target: (d) => ({ kind: 'link', id: String(d.link), href: '/admin/directory/guilds/links' }) },
  'link_blocklist.added': { area: 'moderation', label: (d) => `Blocklisted ${d.domain ?? 'a domain'}`, target: () => ({ kind: 'blocklist', href: '/admin/directory/guilds/links' }) },
  'link_blocklist.removed': { area: 'moderation', label: (d) => `Removed ${d.domain ?? 'a domain'} from the blocklist`, target: () => ({ kind: 'blocklist', href: '/admin/directory/guilds/links' }) },
  'reserved.added': { area: 'accounts', label: (d) => `Reserved “${d.name ?? '…'}”`, target: () => ({ kind: 'reserved', href: '/admin/directory/accounts/reserved' }) },
  'reserved.removed': { area: 'accounts', label: (d) => `Unreserved “${d.name ?? '…'}”`, target: () => ({ kind: 'reserved', href: '/admin/directory/accounts/reserved' }) },
  'username.granted': { area: 'accounts', label: (d) => `Username granted${d.name ? `: ${d.name}` : ''}`, target: (d) => ACCOUNT(d.account) },
  'username.reclaimed': { area: 'accounts', label: (d) => `Username reclaimed${d.name ? `: ${d.name}` : ''}`, target: (d) => ACCOUNT(d.account) },
  'username.allowance_set': { area: 'accounts', label: () => 'Rename allowance set', target: (d) => ACCOUNT(d.account) },
  'username.hold_released': { area: 'accounts', label: (d) => `Name hold released${d.name ? `: ${d.name}` : ''}` },
  'account.deleted': { area: 'accounts', actor: 'player', label: () => 'Account deleted by its owner', target: (d) => ({ kind: 'account', id: String(d.account) }) },
  'cards.cache_cleared': { area: 'features', actor: 'system', label: (d) => `Share-card cache cleared (${d.images ?? 0} images)` },
  'admin.passkey_enrolled': { area: 'sign-in', label: () => 'Admin passkey registered' },
  'admin.signed_in': { area: 'sign-in', label: () => 'Admin signed in' },
  'admin.signed_out': { area: 'sign-in', label: () => 'Admin signed out' },
  'release.paused': { area: 'release', label: () => 'Release tools: crawl paused' },
  'release.resumed': { area: 'release', label: () => 'Release tools: crawl resumed' },
  'release.snapshot': { area: 'release', label: (d) => `Snapshot taken: “${d.label}”`, target: (d) => ({ kind: 'snapshot', id: String(d.snapshot), href: `/admin/release#snap-${d.snapshot}` }) },
  'release.compared': { area: 'release', label: (d) => `Snapshots compared: ${d.identical ? 'identical' : 'different'}`, target: () => ({ kind: 'release', href: '/admin/release' }) },
  'release.run_started': { area: 'release', label: (d) => `${d.kind === 'after' ? 'After' : 'Before'}-deploy checklist started: “${d.label}”`, target: (d) => ({ kind: 'run', id: String(d.run), href: `/admin/release#run-${d.run}` }) },
  'release.step': { area: 'release', label: (d) => `Checklist step: ${d.step} (${d.result ?? 'done'})`, target: (d) => ({ kind: 'run', id: String(d.run), href: `/admin/release#run-${d.run}` }) },
  'release.run_finished': { area: 'release', label: (d) => `Checklist ${d.abandoned ? 'abandoned' : 'finished'}`, target: (d) => ({ kind: 'run', id: String(d.run), href: `/admin/release#run-${d.run}` }) },
};

const MODERATION_LABELS = {
  warning: 'Warning', username_reset: 'Username change forced', field_reset: 'Field reset', guild_reset: 'Guild page field reset',
  ban: 'Ban', unban: 'Ban lifted', role_granted: 'Moderator role granted', role_removed: 'Moderator role removed',
  identities_revealed: 'Sign-in names revealed', reports_dismissed: 'Reports dismissed', reports_actioned: 'Reports actioned',
};

export const AUDIT_AREAS = Object.freeze([
  { id: 'moderation', label: 'Moderation' }, { id: 'accounts', label: 'Accounts' }, { id: 'inbox', label: 'Inbox' },
  { id: 'badges', label: 'Badges' }, { id: 'tiers', label: 'Tiers' }, { id: 'discovery', label: 'Discovery' },
  { id: 'features', label: 'Features' }, { id: 'settings', label: 'Settings' }, { id: 'release', label: 'Release tools' },
  { id: 'sign-in', label: 'Admin sign-ins' }, { id: 'other', label: 'Other' },
]);

function settingArea(key) {
  return featureBySetting.has(key) ? 'features' : 'settings';
}

const hidden = (v) => (v === undefined ? null : v);

function describeAdminEvent(row) {
  const d = row.detail ?? {};
  if (row.type === 'setting.changed') {
    const f = featureBySetting.get(d.key);
    const def = settingByKey.get(d.key);
    const on = f ? (f.store.inverted ? !d.value : Boolean(d.value)) : null;
    return {
      area: settingArea(d.key),
      action: f ? `${f.name} turned ${on ? 'on' : 'off'}` : `${def?.label ?? d.key} changed${d.version ? ` (${d.version})` : ''}`,
      target: f ? { kind: 'feature', id: f.id, label: f.name, href: `/admin/features#feat-${f.id}` } : { kind: 'setting', id: d.key, label: def?.label ?? d.key, href: `/admin/settings#set-${d.key}` },
      before: f && d.before !== undefined ? (f.store.inverted ? !d.before : Boolean(d.before)) : hidden(d.before),
      after: f ? on : hidden(d.value),
      beforeRecorded: d.before !== undefined,
      reason: d.reason ?? null,
    };
  }
  const t = TYPES[row.type];
  return {
    area: t?.area ?? 'other',
    actorKind: t?.actor ?? null,
    action: t?.label ? t.label(d) : row.type,
    target: t?.target ? t.target(d) : null,
    before: d.before === undefined ? null : d.before,
    after: d.value === undefined ? (d.open === undefined ? null : d.open) : d.value,
    beforeRecorded: d.before !== undefined,
    reason: d.reason ?? null,
  };
}

/** The admin_events types that belong to an area (for filtering in SQL). */
function typesOf(area) {
  return Object.entries(TYPES).filter(([k, t]) => t.area === area && k !== 'setting.changed').map(([k]) => k);
}

const PAGE = 50;

/**
 * One page of the audit log, newest first. Filters: area, q (matches the type, a setting key, the reason), target
 * (kind:id, e.g. account:12), actorAccountId (a moderator sees only their own entries). Cursor = "<iso>|<src>|<id>".
 */
export async function auditPage(db, { area = null, q = null, target = null, actorAccountId = null, cursor = null, limit = PAGE } = {}) {
  const lim = Math.min(Math.max(Number(limit) || PAGE, 1), 100);
  let cur = null;
  if (cursor) {
    const [at, src, id] = String(cursor).split('|');
    if (!at || !['a', 'm'].includes(src) || !/^\d+$/.test(id ?? '') || Number.isNaN(Date.parse(at))) throw new HttpError(400, 'Bad cursor', 'invalid');
    cur = { at, src, id };
  }
  if (area && !AUDIT_AREAS.some((a) => a.id === area)) throw new HttpError(400, 'Unknown area', 'invalid');
  const text = typeof q === 'string' && q.trim() ? q.trim().slice(0, 80).toLowerCase() : null;
  let tKind = null;
  let tId = null;
  if (target) {
    const m = /^([a-z]+):([A-Za-z0-9._-]{1,80})$/.exec(String(target));
    if (!m) throw new HttpError(400, 'Bad target', 'invalid');
    [, tKind, tId] = m;
  }

  // Which sources and admin_events types the area allows.
  const wantAdmin = actorAccountId === null;
  const wantMod = !area || area === 'moderation';
  let typeFilter = '';
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (area === 'settings') typeFilter = `AND (type IN (SELECT unnest(${p(typesOf('settings'))}::text[])) OR (type = 'setting.changed' AND NOT (detail->>'key' = ANY(${p(FEATURE_SETTING_KEYS)}::text[]))))`;
  else if (area === 'features') typeFilter = `AND (type IN (SELECT unnest(${p(typesOf('features'))}::text[])) OR (type = 'setting.changed' AND detail->>'key' = ANY(${p(FEATURE_SETTING_KEYS)}::text[])))`;
  else if (area === 'other') typeFilter = `AND NOT (type = ANY(${p([...Object.keys(TYPES), 'setting.changed'])}::text[]))`;
  else if (area) typeFilter = `AND type = ANY(${p(typesOf(area))}::text[])`;

  const textA = text ? `AND (lower(type) LIKE ${p(`%${text}%`)} OR lower(detail::text) LIKE ${p(`%${text}%`)})` : '';
  const textM = text ? `AND (lower(type) LIKE ${p(`%${text}%`)} OR lower(coalesce(reason, '')) LIKE ${p(`%${text}%`)})` : '';
  const targetA = tKind === 'account' ? `AND detail->>'account' = ${p(tId)}` : tKind === 'setting' ? `AND detail->>'key' = ${p(tId)}` : tKind ? 'AND false' : '';
  const targetM = tKind === 'account' ? `AND account_id::text = ${p(tId)}` : tKind === 'guild' ? `AND guild_id::text = ${p(tId)}` : tKind ? 'AND false' : '';
  const curA = cur ? `AND (created_at, 'a', id) < (${p(cur.at)}::timestamptz, ${p(cur.src)}, ${p(cur.id)}::bigint)` : '';
  const curM = cur ? `AND (at, 'm', id) < (${p(cur.at)}::timestamptz, ${p(cur.src)}, ${p(cur.id)}::bigint)` : '';
  const actorM = actorAccountId !== null ? `AND actor = 'moderator' AND actor_account_id = ${p(actorAccountId)}` : "AND actor <> 'system'";

  const parts = [];
  if (wantAdmin) {
    parts.push(`(SELECT 'a'::text AS src, id, created_at AS at, type, detail, NULL::text AS actor, NULL::bigint AS actor_account_id,
                        NULL::bigint AS account_id, NULL::bigint AS guild_id, NULL::text AS reason
                   FROM admin_events WHERE type NOT LIKE 'moderation.%' ${typeFilter} ${textA} ${targetA} ${curA}
                  ORDER BY created_at DESC, id DESC LIMIT ${lim + 1})`);
  }
  if (wantMod) {
    parts.push(`(SELECT 'm'::text AS src, id, at, type, detail, actor, actor_account_id, account_id, guild_id, reason
                   FROM moderation_actions WHERE true ${actorM} ${textM} ${targetM} ${curM}
                  ORDER BY at DESC, id DESC LIMIT ${lim + 1})`);
  }
  if (!parts.length) return { entries: [], next: null };
  const rows = await db.query(`SELECT * FROM (${parts.join(' UNION ALL ')}) x ORDER BY at DESC, src DESC, id DESC LIMIT ${lim + 1}`, params);
  const more = rows.length > lim;
  const page = rows.slice(0, lim);

  // Names for the moderators and accounts named (usernames only; claimed ones).
  const ids = [...new Set(page.flatMap((r) => [r.actor_account_id, r.account_id, r.src === 'a' ? r.detail?.account : null]).filter(Boolean).map(Number))];
  const names = ids.length ? await db.query('SELECT id, username, username_claimed FROM accounts WHERE id = ANY($1::bigint[]) LIMIT 200', [ids]) : [];
  const nameOf = (id) => {
    const a = names.find((n) => Number(n.id) === Number(id));
    return a ? (a.username_claimed ? `@${a.username}` : `account ${id}`) : `account ${id} (deleted)`;
  };

  const entries = page.map((r) => {
    if (r.src === 'm') {
      const d = r.detail ?? {};
      return {
        id: `m:${r.id}`, at: r.at, area: 'moderation',
        actor: { kind: r.actor, accountId: r.actor_account_id, label: r.actor === 'moderator' ? `Moderator ${nameOf(r.actor_account_id)}` : 'Admin' },
        action: MODERATION_LABELS[r.type] ?? r.type,
        target: r.account_id ? { ...ACCOUNT(r.account_id), label: nameOf(r.account_id) } : r.guild_id ? { kind: 'guild', id: String(r.guild_id), href: `/admin/directory/guilds?id=${r.guild_id}` } : null,
        before: d.was ?? null, after: d.now ?? d.to ?? null, beforeRecorded: d.was !== undefined, reason: r.reason ?? null,
      };
    }
    const x = describeAdminEvent(r);
    const t = x.target;
    if (t?.kind === 'account' && t.id) t.label = nameOf(t.id);
    const actorKind = x.actorKind ?? 'admin';
    return {
      id: `a:${r.id}`, at: r.at, area: x.area,
      actor: { kind: actorKind, accountId: null, label: actorKind === 'player' ? 'The player' : actorKind === 'system' ? 'Everstats' : 'Admin' },
      action: x.action, target: t, before: x.before, after: x.after, beforeRecorded: x.beforeRecorded, reason: x.reason,
    };
  });
  const last = page[page.length - 1];
  return { entries, next: more && last ? `${new Date(last.at).toISOString()}|${last.src}|${last.id}` : null };
}

/** Audit entries matching a search box query (settings search covers the audit log too). */
export async function auditSearch(db, text, { limit = 5 } = {}) {
  return (await auditPage(db, { q: text, limit })).entries;
}
