import express from 'express';
import { requireAccount } from '../auth/sessions.js';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { parseGuildSlug } from '../stats/slug.js';
import { MAX_LINKS, checkDescription, checkInvite, checkLabel, checkUrl, inviteUrl } from './links.js';

/**
 * Guild page management (0.7.0). Who may edit a guild's page on Everstats:
 *
 *   GUILD MASTER  the account that owns the guild's rank-0 character on the LATEST stored roster. Ownership is what a
 *                 Battle.net sign-in proves (characters.owner_account_id, set only from the account's own character
 *                 list), exactly as for any owned character. Nothing else is needed. Computed live on every request
 *                 from guild_roster, so it follows the roster's freshness: a new GM takes over at the next roster
 *                 refresh, and when the roster ages out (30-day rule) nobody controls the page until it is read again.
 *   OFFICERS      accounts the Guild Master added by @username. Each must own a tracked, visible character in the guild
 *                 when added, and keeps access only while it still does (checked on every request). The GM can
 *                 remove them at any time. A new GM inherits them until they remove them.
 *
 * With no Guild Master on Everstats (the rank-0 character isn't owned by any account, or there is no roster), the page
 * stays as it is and NOBODY can edit it, officers included, until the GM signs in. Every change of control and every
 * edit is logged in guild_events. Editors can never change anything Blizzard provides (name, faction, roster).
 *
 * guild_pages / guild_editors / guild_links are Everstats' own data, keyed on Blizzard's guild id without a foreign
 * key (a guilds row ages out with Blizzard's 30-day rule; our data about the guild stays).
 */
const OFFICER_CHARACTER = `owner_account_id = $1 AND guild_id = $2 AND NOT hidden AND profile_state = 'ok' AND missing_since IS NULL`;

/** The rank-0 character on the stored roster and its owner, or null. More than one rank 0 → nobody (never a guess). */
export async function currentGuildMaster(db, guildId) {
  const rows = await db.query(
    `SELECT gr.character_id, gr.fetched_at, c.owner_account_id, c.hidden
       FROM guild_roster gr LEFT JOIN characters c ON c.id = gr.character_id
      WHERE gr.guild_id = $1 AND gr.rank = 0 LIMIT 2`,
    [guildId],
  );
  if (rows.length !== 1) return null;
  const r = rows[0];
  return { characterId: Number(r.character_id), accountId: r.owner_account_id === null ? null : Number(r.owner_account_id), rosterAt: r.fetched_at, hidden: r.hidden ?? null };
}

/**
 * Records who the Guild Master is now and logs a handover when it changed (called after a roster is stored and after a
 * sign-in reads an account's characters). Authorisation never reads this record: it reads the roster live.
 */
export async function syncGuildMaster(q, guildId) {
  const gm = await currentGuildMaster(q, guildId);
  const page = await q.one('SELECT gm_account_id, gm_character_id FROM guild_pages WHERE guild_id = $1 FOR UPDATE', [guildId]);
  const to = gm?.accountId ?? null;
  const toChar = gm?.characterId ?? null;
  const from = page?.gm_account_id === undefined || page?.gm_account_id === null ? null : Number(page.gm_account_id);
  const fromChar = page?.gm_character_id === undefined || page?.gm_character_id === null ? null : Number(page.gm_character_id);
  if (from === to && fromChar === toChar && page) return false;
  if (!page && to === null) return false; // nothing recorded, nobody to record: no row needed
  await q.query(
    `INSERT INTO guild_pages (guild_id, gm_account_id, gm_character_id, gm_since) VALUES ($1, $2, $3, CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (guild_id) DO UPDATE SET gm_account_id = EXCLUDED.gm_account_id, gm_character_id = EXCLUDED.gm_character_id,
       gm_since = CASE WHEN guild_pages.gm_account_id IS DISTINCT FROM EXCLUDED.gm_account_id THEN EXCLUDED.gm_since ELSE guild_pages.gm_since END`,
    [guildId, to, toChar],
  );
  if (from !== to) {
    await q.query(
      `INSERT INTO guild_events (guild_id, type, account_id, actor, detail) VALUES ($1, 'control.changed', $2, 'roster', $3::jsonb)`,
      [guildId, to, JSON.stringify({ from, to, character: toChar, why: to === null ? (gm ? 'gm_character_unclaimed' : 'no_single_gm_on_roster') : 'roster' })],
    );
  }
  return from !== to;
}

/** Guilds whose rank-0 character this account owns (after a sign-in moved ownership). */
export async function syncGuildsOwnedBy(db, accountId) {
  const rows = await db.query(
    `SELECT DISTINCT gr.guild_id FROM guild_roster gr JOIN characters c ON c.id = gr.character_id
      WHERE gr.rank = 0 AND c.owner_account_id = $1 LIMIT 50`,
    [accountId],
  );
  const recorded = await db.query('SELECT guild_id FROM guild_pages WHERE gm_account_id = $1 LIMIT 50', [accountId]);
  for (const id of new Set([...rows, ...recorded].map((r) => Number(r.guild_id)))) await db.tx((q) => syncGuildMaster(q, id));
}

/**
 * 'gm' | 'officer' | null for this account on this guild, right now.
 * 0.8.2: a BANNED account has no role (its guild pages keep working, with no editing by it). A banned Guild Master
 * leaves the page to the officers already added, who keep editing; nobody can add officers until the ban ends.
 * { ignoreBan: true } is for moderation, to list the guilds a banned account manages so their text can be reset.
 */
export async function guildRole(db, guildId, accountId, { ignoreBan = false } = {}) {
  if (!accountId) return null;
  const gm = await currentGuildMaster(db, guildId);
  if (!gm?.accountId) return null; // no Guild Master on Everstats: nobody edits
  if (!ignoreBan && (await db.one('SELECT everstats_banned($1) AS b', [accountId])).b) return null;
  if (gm.accountId === Number(accountId)) return 'gm';
  const ed = await db.one('SELECT 1 AS x FROM guild_editors WHERE guild_id = $1 AND account_id = $2 AND removed_at IS NULL', [guildId, accountId]);
  if (!ed) return null;
  const member = await db.one(`SELECT 1 AS x FROM characters WHERE ${OFFICER_CHARACTER} LIMIT 1`, [accountId, guildId]);
  return member ? 'officer' : null;
}

/** The public "Links" area: null when nothing is set. */
export async function guildLinksView(db, guildId) {
  const page = await db.one('SELECT description, discord_invite FROM guild_pages WHERE guild_id = $1', [guildId]);
  const links = await db.query('SELECT id, label, url, host FROM guild_links WHERE guild_id = $1 AND removed_at IS NULL ORDER BY position, id LIMIT $2', [guildId, MAX_LINKS]);
  if (!page?.description && !page?.discord_invite && !links.length) return null;
  return {
    description: page?.description ?? null,
    discord: page?.discord_invite ? { code: page.discord_invite, url: inviteUrl(page.discord_invite) } : null,
    links: links.map((l) => ({ id: l.id, label: l.label, url: l.url, host: l.host })),
  };
}

async function blocklist(db) {
  return (await db.query('SELECT host FROM link_blocklist ORDER BY host LIMIT 5000')).map((r) => r.host);
}

const guildOf = async (db, raw) => {
  const slug = parseGuildSlug(raw);
  if (!slug) throw new HttpError(404, 'Not found');
  const g = await db.one('SELECT id, slug, name FROM guilds WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1', [slug]);
  if (!g) throw new HttpError(404, 'Everstats doesn’t know this guild yet.', 'no_guild');
  return g;
};

const logGuild = (q, guildId, type, { accountId = null, actorAccountId = null, actor = 'player', detail = {} } = {}) => q.query(
  'INSERT INTO guild_events (guild_id, type, account_id, actor_account_id, actor, detail) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
  [guildId, type, accountId, actorAccountId, actor, JSON.stringify(detail)],
);

/** What the manage panel shows to the GM and officers. */
async function manageView(db, g, accountId, role) {
  const page = await db.one('SELECT description, discord_invite, updated_at FROM guild_pages WHERE guild_id = $1', [g.id]);
  const links = await db.query('SELECT id, label, url, host FROM guild_links WHERE guild_id = $1 AND removed_at IS NULL ORDER BY position, id LIMIT $2', [g.id, MAX_LINKS]);
  const editors = await db.query(
    `SELECT e.account_id, a.username, a.username_claimed, e.added_at,
            EXISTS (SELECT 1 FROM characters c WHERE c.owner_account_id = e.account_id AND c.guild_id = $1 AND NOT c.hidden AND c.profile_state = 'ok' AND c.missing_since IS NULL) AS member
       FROM guild_editors e JOIN accounts a ON a.id = e.account_id
      WHERE e.guild_id = $1 AND e.removed_at IS NULL ORDER BY e.added_at LIMIT 50`,
    [g.id],
  );
  const gm = await currentGuildMaster(db, g.id);
  let gmCharacter = null;
  if (role === 'gm' && gm) {
    const c = await db.one('SELECT name, surname, slug, hidden FROM characters WHERE id = $1', [gm.characterId]);
    if (c?.name) gmCharacter = { name: c.name, surname: c.surname, slug: c.slug, hidden: c.hidden };
  }
  return {
    role,
    guild: { slug: g.slug, name: g.name },
    gmCharacter,
    rosterAt: gm?.rosterAt ?? null,
    description: page?.description ?? '',
    discordInvite: page?.discord_invite ?? '',
    links: links.map((l) => ({ id: l.id, label: l.label, url: l.url, host: l.host })),
    editors: editors.map((e) => ({ username: e.username_claimed ? e.username : null, addedAt: e.added_at, active: e.member })),
    maxLinks: MAX_LINKS,
    updatedAt: page?.updated_at ?? null,
  };
}

export function createGuildManageRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const reports = limitBy(limits.reports, networkOf);

  // Anyone (signed in or not) can report a link; it goes to the admin's queue. Rate-limited per network.
  r.post('/guilds/:slug/links/:id/report', reports, route(async (req, res) => {
    const g = await guildOf(db, req.params.slug);
    const id = Number(req.params.id);
    const link = Number.isSafeInteger(id) ? await db.one('SELECT id FROM guild_links WHERE id = $1 AND guild_id = $2 AND removed_at IS NULL', [id, g.id]) : null;
    if (!link) throw new HttpError(404, 'That link isn’t on this guild page any more.');
    const note = String(req.body?.note ?? '').trim().slice(0, 300) || null;
    const viewer = req.session?.stage === 'full' ? req.session.accountId : null;
    await db.query('INSERT INTO guild_link_reports (link_id, guild_id, reporter_account_id, note) VALUES ($1, $2, $3, $4)', [link.id, g.id, viewer, note]);
    res.json({ ok: true });
  }));

  r.use('/guilds/:slug/manage', requireAccount);

  r.get('/guilds/:slug/manage', route(async (req, res) => {
    const g = await guildOf(db, req.params.slug);
    const role = await guildRole(db, g.id, req.session.accountId);
    if (!role) return res.json({ role: null });
    res.json(await manageView(db, g, req.session.accountId, role));
  }));

  r.put('/guilds/:slug/manage', writes, route(async (req, res) => {
    const g = await guildOf(db, req.params.slug);
    const me = req.session.accountId;
    const role = await guildRole(db, g.id, me);
    if (!role) throw new HttpError(403, 'Only this guild’s Guild Master and the officers they add can edit its page.', 'not_editor');
    const body = req.body ?? {};
    const d = checkDescription(body.description);
    if (!d.ok) throw new HttpError(400, d.message, 'invalid');
    const inv = checkInvite(body.discordInvite);
    if (!inv.ok) throw new HttpError(400, inv.message, 'invalid');
    const wanted = Array.isArray(body.links) ? body.links : [];
    if (wanted.length > MAX_LINKS) throw new HttpError(400, `Up to ${MAX_LINKS} links.`, 'invalid');
    const blocked = await blocklist(db);
    const clean = wanted.map((l, i) => {
      const label = checkLabel(l?.label);
      if (!label.ok) throw new HttpError(400, `Link ${i + 1}: ${label.message}`, 'invalid');
      const url = checkUrl(l?.url, blocked);
      if (!url.ok) throw new HttpError(400, `Link ${i + 1}: ${url.message}`, 'invalid');
      return { label: label.value, url: url.url, host: url.host };
    });
    await db.tx(async (q) => {
      const live = await q.query('SELECT id, label, url FROM guild_links WHERE guild_id = $1 AND removed_at IS NULL ORDER BY position, id LIMIT 50 FOR UPDATE', [g.id]);
      const keep = new Set();
      for (const [i, l] of clean.entries()) {
        const same = live.find((x) => !keep.has(x.id) && x.label === l.label && x.url === l.url);
        if (same) {
          keep.add(same.id);
          await q.query('UPDATE guild_links SET position = $2 WHERE id = $1', [same.id, i + 1]);
        } else {
          const ins = await q.one('INSERT INTO guild_links (guild_id, position, label, url, host, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [g.id, i + 1, l.label, l.url, l.host, me]);
          keep.add(ins.id);
          await logGuild(q, g.id, 'link.added', { actorAccountId: me, detail: { link: ins.id, host: l.host } });
        }
      }
      for (const x of live.filter((x) => !keep.has(x.id))) {
        await q.query("UPDATE guild_links SET removed_at = now(), removed_by = 'editor' WHERE id = $1", [x.id]);
        await logGuild(q, g.id, 'link.removed', { actorAccountId: me, detail: { link: x.id } });
      }
      await q.query(
        `INSERT INTO guild_pages (guild_id, description, discord_invite, updated_at, updated_by) VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (guild_id) DO UPDATE SET description = EXCLUDED.description, discord_invite = EXCLUDED.discord_invite, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [g.id, d.value, inv.value, me],
      );
      await logGuild(q, g.id, 'page.edited', { actorAccountId: me, detail: { role, links: clean.length, discord: Boolean(inv.value), description: Boolean(d.value) } });
    });
    res.json(await manageView(db, g, me, role));
  }));

  // Officers: the Guild Master adds them by @username. Only accounts that own a tracked, visible character in the guild.
  r.post('/guilds/:slug/manage/editors', writes, route(async (req, res) => {
    const g = await guildOf(db, req.params.slug);
    const me = req.session.accountId;
    if ((await guildRole(db, g.id, me)) !== 'gm') throw new HttpError(403, 'Only the Guild Master can add officers.', 'not_gm');
    const name = String(req.body?.username ?? '').trim().toLowerCase().replace(/^@/, '').slice(0, 40);
    const who = name ? await db.one('SELECT id FROM accounts WHERE username = $1 AND username_claimed', [name]) : null;
    if (!who) throw new HttpError(404, `Nobody is called @${name || '…'}.`, 'no_user');
    if (Number(who.id) === Number(me)) throw new HttpError(400, 'You’re the Guild Master already.', 'invalid');
    const member = await db.one(`SELECT 1 AS x FROM characters WHERE ${OFFICER_CHARACTER} LIMIT 1`, [who.id, g.id]);
    if (!member) throw new HttpError(409, `@${name} doesn’t own a tracked character in ${g.name} that’s shown on Everstats.`, 'not_member');
    await db.tx(async (q) => {
      const n = (await q.one('SELECT count(*)::int AS n FROM guild_editors WHERE guild_id = $1 AND removed_at IS NULL', [g.id])).n;
      if (n >= 20) throw new HttpError(409, 'Up to 20 officers.', 'too_many');
      await q.query(
        `INSERT INTO guild_editors (guild_id, account_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, account_id) DO UPDATE SET added_by = EXCLUDED.added_by, added_at = now(), removed_at = NULL, removed_by = NULL, removed_reason = NULL`,
        [g.id, who.id, me],
      );
      await logGuild(q, g.id, 'officer.added', { accountId: who.id, actorAccountId: me });
    });
    res.json(await manageView(db, g, me, 'gm'));
  }));

  r.delete('/guilds/:slug/manage/editors/:username', writes, route(async (req, res) => {
    const g = await guildOf(db, req.params.slug);
    const me = req.session.accountId;
    if ((await guildRole(db, g.id, me)) !== 'gm') throw new HttpError(403, 'Only the Guild Master can remove officers.', 'not_gm');
    const who = await db.one('SELECT id FROM accounts WHERE username = $1', [String(req.params.username).toLowerCase()]);
    const rows = who ? await db.query("UPDATE guild_editors SET removed_at = now(), removed_by = $3, removed_reason = 'removed by the Guild Master' WHERE guild_id = $1 AND account_id = $2 AND removed_at IS NULL RETURNING 1", [g.id, who.id, me]) : [];
    if (!rows.length) throw new HttpError(404, 'That account isn’t an officer here.');
    await logGuild(db, g.id, 'officer.removed', { accountId: who.id, actorAccountId: me });
    res.json(await manageView(db, g, me, 'gm'));
  }));

  // Settings → "Your guilds": every guild this account can manage right now.
  r.get('/account/guilds', requireAccount, route(async (req, res) => {
    const me = req.session.accountId;
    const candidates = await db.query(
      `SELECT DISTINCT g.id, g.slug, g.name FROM guilds g
        WHERE g.id IN (SELECT gr.guild_id FROM guild_roster gr JOIN characters c ON c.id = gr.character_id WHERE gr.rank = 0 AND c.owner_account_id = $1)
           OR g.id IN (SELECT guild_id FROM guild_editors WHERE account_id = $1 AND removed_at IS NULL)
        ORDER BY g.name LIMIT 50`,
      [me],
    );
    const guilds = [];
    for (const g of candidates) {
      const role = await guildRole(db, g.id, me);
      if (role) guilds.push({ slug: g.slug, name: g.name, role });
    }
    res.json({ guilds });
  }));

  return r;
}

/** /api/admin/guild-links…: behind the admin gate. Reports, removing any link (logged), and the blocklist. */
export function createAdminGuildLinksRouter({ db, writes }) {
  const r = express.Router();

  r.get('/guild-links', route(async (req, res) => {
    const reportsOpen = await db.query(
      `SELECT r.id, r.reported_at, r.note, l.id AS link_id, l.label, l.url, l.host, l.removed_at, g.slug, g.name,
              (SELECT count(*)::int FROM guild_link_reports x WHERE x.link_id = l.id AND x.state = 'open') AS open_for_link
         FROM guild_link_reports r JOIN guild_links l ON l.id = r.link_id LEFT JOIN guilds g ON g.id = r.guild_id
        WHERE r.state = 'open' ORDER BY r.reported_at LIMIT 200`,
    );
    const recent = await db.query(
      `SELECT l.id, l.label, l.url, l.host, l.created_at, l.removed_at, l.removed_by, g.slug, g.name
         FROM guild_links l LEFT JOIN guilds g ON g.id = l.guild_id ORDER BY l.created_at DESC LIMIT 100`,
    );
    const blocked = await db.query('SELECT host, note, added_at FROM link_blocklist ORDER BY host LIMIT 5000');
    res.json({
      reports: reportsOpen.map((x) => ({ id: x.id, at: x.reported_at, note: x.note, link: { id: x.link_id, label: x.label, url: x.url, host: x.host, removed: Boolean(x.removed_at) }, guild: x.slug ? { slug: x.slug, name: x.name } : null })),
      recent: recent.map((x) => ({ id: x.id, label: x.label, url: x.url, host: x.host, createdAt: x.created_at, removedAt: x.removed_at, removedBy: x.removed_by, guild: x.slug ? { slug: x.slug, name: x.name } : null })),
      blocklist: blocked.map((b) => ({ host: b.host, note: b.note, addedAt: b.added_at })),
    });
  }));

  r.post('/guild-links/:id/remove', writes, route(async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!reason) throw new HttpError(400, 'A reason is required: it is saved to the log.', 'reason_required');
    await db.tx(async (q) => {
      const link = await q.one("UPDATE guild_links SET removed_at = now(), removed_by = 'admin', removed_reason = $2 WHERE id = $1 AND removed_at IS NULL RETURNING guild_id, host", [id, reason]);
      if (!link) throw new HttpError(404, 'That link is already gone.');
      await q.query("UPDATE guild_link_reports SET state = 'removed', resolved_at = now() WHERE link_id = $1 AND state = 'open'", [id]);
      await logGuild(q, link.guild_id, 'link.removed_by_admin', { actor: 'admin', detail: { link: id, host: link.host, reason } });
      await q.query("INSERT INTO admin_events (type, detail) VALUES ('guild_link.removed', $1::jsonb)", [JSON.stringify({ link: id })]);
    });
    res.json({ ok: true });
  }));

  r.post('/guild-links/reports/:id/dismiss', writes, route(async (req, res) => {
    const rows = await db.query("UPDATE guild_link_reports SET state = 'dismissed', resolved_at = now() WHERE id = $1 AND state = 'open' RETURNING 1", [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'That report is already handled.');
    res.json({ ok: true });
  }));

  r.post('/guild-links/blocklist', writes, route(async (req, res) => {
    const host = String(req.body?.host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').replace(/^www\./, '');
    if (!/^[a-z0-9.-]{3,253}$/.test(host) || !host.includes('.')) throw new HttpError(400, 'A domain name, like example.com.', 'invalid');
    await db.query('INSERT INTO link_blocklist (host, note) VALUES ($1, $2) ON CONFLICT (host) DO UPDATE SET note = EXCLUDED.note', [host, String(req.body?.note ?? '').trim().slice(0, 200) || null]);
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('link_blocklist.added', $1::jsonb)", [JSON.stringify({ host })]);
    res.json({ ok: true });
  }));

  r.delete('/guild-links/blocklist/:host', writes, route(async (req, res) => {
    const rows = await db.query('DELETE FROM link_blocklist WHERE host = $1 RETURNING host', [String(req.params.host).toLowerCase()]);
    if (!rows.length) throw new HttpError(404, 'Not on the list.');
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('link_blocklist.removed', $1::jsonb)", [JSON.stringify({ host: rows[0].host })]);
    res.json({ ok: true });
  }));

  return r;
}
