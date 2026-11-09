import { HttpError } from '../core/errors.js';
import { guildRole } from '../guilds/manage.js';

/**
 * Guild page text and moderation (0.8.2). Editors only ever write Everstats' own fields (description, Discord invite,
 * links: guilds/manage.js); a reset clears one of them and logs it in guild_events (and moderation_actions, by the
 * caller). Blizzard's guild data is never touched.
 */

/** The guild pages this account manages (Guild Master or officer), even while it is banned, with their current text. */
export async function managedGuilds(db, accountId) {
  const candidates = await db.query(
    `SELECT DISTINCT g.id, g.slug, g.name FROM guilds g
      WHERE g.id IN (SELECT gr.guild_id FROM guild_roster gr JOIN characters c ON c.id = gr.character_id WHERE gr.rank = 0 AND c.owner_account_id = $1)
         OR g.id IN (SELECT guild_id FROM guild_editors WHERE account_id = $1 AND removed_at IS NULL)
      ORDER BY g.name LIMIT 50`,
    [accountId],
  );
  const out = [];
  for (const g of candidates) {
    const role = await guildRole(db, g.id, accountId, { ignoreBan: true });
    if (!role) continue;
    out.push({ ...(await guildText(db, g.id)), id: Number(g.id), slug: g.slug, name: g.name, role: role === 'gm' ? 'Guild Master' : 'officer' });
  }
  return out;
}

export async function guildText(db, guildId) {
  const page = await db.one('SELECT description, discord_invite FROM guild_pages WHERE guild_id = $1', [guildId]);
  const links = await db.query('SELECT id, label, host FROM guild_links WHERE guild_id = $1 AND removed_at IS NULL ORDER BY position, id LIMIT 20', [guildId]);
  return { description: page?.description ?? null, discord: page?.discord_invite ?? null, links: links.map((l) => ({ id: Number(l.id), label: l.label, host: l.host })) };
}

/** Clears one part of a guild page: 'description' | 'discord' | 'links' (every live link, marked removed by the admin). */
export async function resetGuildField(q, { guildId, part, actor, reason }) {
  let changed = 0;
  if (part === 'description') {
    changed = (await q.query('UPDATE guild_pages SET description = NULL, updated_at = now() WHERE guild_id = $1 AND description IS NOT NULL RETURNING 1', [guildId])).length;
  } else if (part === 'discord') {
    changed = (await q.query('UPDATE guild_pages SET discord_invite = NULL, updated_at = now() WHERE guild_id = $1 AND discord_invite IS NOT NULL RETURNING 1', [guildId])).length;
  } else if (part === 'links') {
    const gone = await q.query("UPDATE guild_links SET removed_at = now(), removed_by = 'admin', removed_reason = $2 WHERE guild_id = $1 AND removed_at IS NULL RETURNING id", [guildId, reason.slice(0, 300)]);
    if (gone.length) await q.query("UPDATE guild_link_reports SET state = 'removed', resolved_at = now() WHERE link_id = ANY($1::bigint[]) AND state = 'open'", [gone.map((x) => x.id)]);
    changed = gone.length;
  } else {
    throw new HttpError(400, 'Choose what to reset.', 'invalid');
  }
  if (!changed) throw new HttpError(409, 'There is nothing there to reset.', 'nothing');
  await q.query(
    "INSERT INTO guild_events (guild_id, type, actor, detail) VALUES ($1, 'page.reset', 'admin', $2::jsonb)",
    [guildId, JSON.stringify({ part, by: actor.kind, reason })],
  );
  return changed;
}
