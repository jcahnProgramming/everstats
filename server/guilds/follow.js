import express from 'express';
import { getSetting } from '../admin/settings.js';
import { HttpError, route } from '../core/errors.js';
import { limitBy } from '../core/rateLimit.js';
import { guildBadgesView } from '../guildBadges/view.js';
import { tierBarParts } from '../stats/tiers.js';
import { guildRole } from './manage.js';
import { guildView } from './routes.js';

/**
 * "Your guilds" on the signed-in home page (0.9.1).
 *
 *   own       every guild one of the account's characters is in (characters.guild_id), automatically. A guild that
 *             only a HIDDEN character is in appears too: the dashboard is the owner's own page, so only they see it.
 *             Own guilds can be hidden from the section, never "unpinned" (they aren't pins).
 *   pinned    any other guild the player follows with "Pin to dashboard" on its page, at most `dashboard.maxPinnedGuilds`
 *             (admin setting, default 10). Unpinned from its card or its page.
 *   order     one order for the whole section (the shared drag-and-drop list); new guilds go last.
 *
 * account_guilds (ours) keeps only Blizzard guild ids and the player's choices; the card data is read live from the
 * guild tables, so it follows the retention window with them. A guild Everstats no longer has (aged out) isn't shown.
 */
async function ownGuildIds(db, accountId) {
  const rows = await db.query('SELECT DISTINCT guild_id FROM characters WHERE owner_account_id = $1 AND guild_id IS NOT NULL LIMIT 50', [accountId]);
  return rows.map((r) => Number(r.guild_id));
}

async function choices(db, accountId) {
  const rows = await db.query('SELECT guild_id, pinned, hidden, position FROM account_guilds WHERE account_id = $1 ORDER BY position, guild_id LIMIT 200', [accountId]);
  return new Map(rows.map((r) => [Number(r.guild_id), r]));
}

/** One compact card: the guild page's own data, cut down. */
async function guildCard(db, g, accountId) {
  const v = await guildView(db, g);
  const badges = await guildBadgesView(db, g).catch(() => null);
  const pinnedBadge = badges?.row?.find((b) => b.pinned) ?? badges?.row?.[0] ?? null;
  const tiers = v.tiers?.graded ? { letters: v.tiers.letters, ranked: tierBarParts(v.tiers.letters).ranked } : null;
  const role = await guildRole(db, g.id, accountId).catch(() => null);
  return {
    id: Number(g.id),
    slug: g.slug,
    name: g.name,
    faction: g.faction ?? null,
    ruleset: v.guild.ruleset ?? null,
    tracked: v.counts.tracked,
    roster: v.counts.roster,
    badge: pinnedBadge,
    best: v.placements?.[0] ?? null,
    nextUnlocks: (badges?.nextUnlocks ?? []).slice(0, 2),
    tiers,
    manage: role === 'gm' || role === 'officer' ? role : null,
  };
}

export async function yourGuilds(db, accountId) {
  const own = new Set(await ownGuildIds(db, accountId));
  const ch = await choices(db, accountId);
  const ids = [...new Set([...own, ...[...ch.values()].filter((c) => c.pinned).map((c) => Number(c.guild_id))])];
  const rows = ids.length ? await db.query('SELECT * FROM guilds WHERE id = ANY($1::bigint[]) LIMIT 100', [ids]) : [];
  const byId = new Map(rows.map((g) => [Number(g.id), g]));
  const order = (id) => ch.get(id)?.position ?? 1e6 + ids.indexOf(id);
  const shown = [];
  const hidden = [];
  for (const id of [...ids].sort((a, b) => order(a) - order(b))) {
    const g = byId.get(id);
    if (!g) continue;
    const isOwn = own.has(id);
    if (isOwn && ch.get(id)?.hidden) {
      hidden.push({ id, slug: g.slug, name: g.name });
      continue;
    }
    shown.push({ ...(await guildCard(db, g, accountId)), own: isOwn, pinned: Boolean(ch.get(id)?.pinned) });
  }
  const max = await getSetting(db, 'dashboard.maxPinnedGuilds');
  return { guilds: shown, hidden, pinnedCount: [...ch.values()].filter((c) => c.pinned).length, maxPinned: max };
}

export function createFollowRouter({ db, limits, networkOf }) {
  const r = express.Router();
  const writes = limitBy(limits.writes, networkOf);
  const me = (req) => {
    if (req.session?.stage !== 'full') throw new HttpError(401, 'Sign in first.', 'signed_out');
    return req.session.accountId;
  };
  const guildId = async (raw) => {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || !(await db.one('SELECT 1 AS x FROM guilds WHERE id = $1', [id]))) throw new HttpError(404, 'Everstats doesn’t have that guild.', 'not_found');
    return id;
  };

  r.get('/account/followed-guilds', route(async (req, res) => res.json(await yourGuilds(db, me(req)))));

  // Whether this guild is on the viewer's dashboard (for the guild page's button).
  r.get('/account/followed-guilds/:id', route(async (req, res) => {
    const accountId = me(req);
    const id = await guildId(req.params.id);
    const own = (await ownGuildIds(db, accountId)).includes(id);
    const row = await db.one('SELECT pinned, hidden FROM account_guilds WHERE account_id = $1 AND guild_id = $2', [accountId, id]);
    const pinnedCount = (await db.one('SELECT count(*)::int AS n FROM account_guilds WHERE account_id = $1 AND pinned', [accountId])).n;
    res.json({ own, pinned: Boolean(row?.pinned), hidden: Boolean(row?.hidden), pinnedCount, maxPinned: await getSetting(db, 'dashboard.maxPinnedGuilds') });
  }));

  r.put('/account/followed-guilds/:id/pin', writes, route(async (req, res) => {
    const accountId = me(req);
    const id = await guildId(req.params.id);
    const on = req.body?.pinned === true;
    await db.tx(async (q) => {
      if (on) {
        const max = await getSetting(q, 'dashboard.maxPinnedGuilds');
        const n = (await q.one('SELECT count(*)::int AS n FROM account_guilds WHERE account_id = $1 AND pinned AND guild_id <> $2', [accountId, id])).n;
        if (n >= max) throw new HttpError(409, `You can pin up to ${max} guilds. Unpin one from your dashboard first.`, 'limit');
        const pos = (await q.one('SELECT coalesce(max(position), 0) + 1 AS p FROM account_guilds WHERE account_id = $1', [accountId])).p;
        await q.query(
          `INSERT INTO account_guilds (account_id, guild_id, pinned, position, pinned_at) VALUES ($1, $2, true, $3, now())
           ON CONFLICT (account_id, guild_id) DO UPDATE SET pinned = true, pinned_at = now(), updated_at = now()`,
          [accountId, id, pos],
        );
      } else {
        await q.query('UPDATE account_guilds SET pinned = false, pinned_at = NULL, updated_at = now() WHERE account_id = $1 AND guild_id = $2', [accountId, id]);
      }
    });
    res.json({ pinned: on });
  }));

  // Own guilds only: hide from (or show again in) the section. A followed guild is unpinned instead.
  r.put('/account/followed-guilds/:id/hidden', writes, route(async (req, res) => {
    const accountId = me(req);
    const id = await guildId(req.params.id);
    if (!(await ownGuildIds(db, accountId)).includes(id)) throw new HttpError(409, 'Only your characters’ guilds can be hidden; unpin a guild you follow instead.', 'not_own');
    const hidden = req.body?.hidden === true;
    await db.query(
      `INSERT INTO account_guilds (account_id, guild_id, hidden) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, guild_id) DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = now()`,
      [accountId, id, hidden],
    );
    res.json({ hidden });
  }));

  r.put('/account/followed-guilds-order', writes, route(async (req, res) => {
    const accountId = me(req);
    const list = Array.isArray(req.body?.guildIds) ? req.body.guildIds.map(Number).filter(Number.isSafeInteger).slice(0, 100) : null;
    if (!list) throw new HttpError(400, 'Send the guilds in order.', 'invalid');
    await db.tx(async (q) => {
      for (const [i, id] of list.entries()) {
        await q.query(
          `INSERT INTO account_guilds (account_id, guild_id, position) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM guilds WHERE id = $2)
           ON CONFLICT (account_id, guild_id) DO UPDATE SET position = EXCLUDED.position, updated_at = now()`,
          [accountId, id, i],
        );
      }
    });
    res.json({ ok: true });
  }));

  return r;
}
