import express from 'express';
import { HttpError, route } from '../core/errors.js';
import { pageLimit } from '../core/db.js';
import { grantUsername, reclaimUsername, releaseHold } from '../accounts/usernames.js';

/**
 * /api/admin/players and /api/admin/reserved: mounted inside the admin router, after its gate (a plain 404 without an
 * admin session). The admin is not a player: it has no username or profile; it can look players up by username, set a
 * rename allowance, grant a name past the rules (a verified partner), reclaim a name, and edit the reserved list.
 * Every change is logged in admin_events and the player's username_history / account_events.
 */
const KINDS = ['everstats', 'path', 'company', 'community', 'admin'];
const idParam = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};

async function playerView(db, id) {
  const a = await db.one(
    `SELECT id, created_at, username, username_claimed, display_name, rename_allowance, beta_member, beta_since,
            (SELECT count(*)::int FROM characters WHERE owner_account_id = accounts.id) AS characters
       FROM accounts WHERE id = $1`,
    [id],
  );
  if (!a) throw new HttpError(404, 'No such account.');
  const history = await db.query('SELECT old_name, new_name, kind, by_admin, note, at FROM username_history WHERE account_id = $1 ORDER BY at DESC LIMIT 50', [id]);
  const holds = await db.query('SELECT name, reason, held_at, held_until FROM username_holds WHERE account_id = $1 ORDER BY held_at DESC LIMIT 20', [id]);
  return {
    id: a.id, createdAt: a.created_at, username: a.username, claimed: a.username_claimed, displayName: a.display_name,
    renamesLeft: a.rename_allowance, beta: a.beta_member ? a.beta_since : null, characters: a.characters,
    history: history.map((h) => ({ from: h.old_name, to: h.new_name, kind: h.kind, byAdmin: h.by_admin, note: h.note, at: h.at })),
    holds: holds.map((h) => ({ name: h.name, reason: h.reason, heldAt: h.held_at, until: h.held_until })),
  };
}

export function createPlayersRouter({ db, writes }) {
  const r = express.Router();

  r.get('/players', route(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().replace(/^@/, '').slice(0, 40) : '';
    const limit = pageLimit(req.query.limit, { fallback: 20, max: 50 });
    const rows = await db.query(
      `SELECT id, username, username_claimed, display_name FROM accounts
        WHERE ($1 = '' OR username LIKE $2 OR id::text = $1 OR id IN (SELECT account_id FROM username_history WHERE old_name = $1))
        ORDER BY username_claimed DESC, username LIMIT $3`,
      [q, `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`, limit],
    );
    res.json({ players: rows.map((p) => ({ id: p.id, username: p.username, claimed: p.username_claimed, displayName: p.display_name })) });
  }));

  r.get('/players/:id', route(async (req, res) => res.json({ player: await playerView(db, idParam(req.params.id)) })));

  r.put('/players/:id/allowance', writes, route(async (req, res) => {
    const id = idParam(req.params.id);
    const value = req.body?.value;
    if (!Number.isInteger(value) || value < 0 || value > 1000) throw new HttpError(400, 'A whole number from 0 to 1000.', 'invalid');
    const rows = await db.query('UPDATE accounts SET rename_allowance = $2 WHERE id = $1 RETURNING id', [id, value]);
    if (!rows.length) throw new HttpError(404, 'No such account.');
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('username.allowance_set', $1::jsonb)", [JSON.stringify({ account: id, value })]);
    res.json({ player: await playerView(db, id) });
  }));

  r.post('/players/:id/grant', writes, route(async (req, res) => {
    const id = idParam(req.params.id);
    await grantUsername(db, id, req.body?.username, req.body?.note ?? '');
    res.json({ player: await playerView(db, id) });
  }));

  r.post('/players/:id/reclaim', writes, route(async (req, res) => {
    const id = idParam(req.params.id);
    await reclaimUsername(db, id, req.body?.note ?? '');
    res.json({ player: await playerView(db, id) });
  }));

  r.delete('/holds/:name', writes, route(async (req, res) => {
    if (!(await releaseHold(db, req.params.name))) throw new HttpError(404, 'That name isn’t held.');
    res.json({ ok: true });
  }));

  // ---- The reserved list (admin only: it is never sent anywhere else)
  r.get('/reserved', route(async (req, res) => {
    const rows = await db.query('SELECT name, kind, added_at FROM reserved_names ORDER BY kind, name LIMIT 5000');
    res.json({ reserved: rows.map((x) => ({ name: x.name, kind: x.kind, addedAt: x.added_at })) });
  }));
  r.post('/reserved', writes, route(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().toLowerCase();
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'admin';
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw new HttpError(400, 'Letters, digits, hyphens and underscores, up to 40.', 'invalid');
    await db.query('INSERT INTO reserved_names (name, kind) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind', [name, kind]);
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('reserved.added', $1::jsonb)", [JSON.stringify({ name, kind })]);
    res.json({ ok: true });
  }));
  r.delete('/reserved/:name', writes, route(async (req, res) => {
    const rows = await db.query('DELETE FROM reserved_names WHERE name = $1 RETURNING name', [String(req.params.name).toLowerCase()]);
    if (!rows.length) throw new HttpError(404, 'Not on the list.');
    await db.query("INSERT INTO admin_events (type, detail) VALUES ('reserved.removed', $1::jsonb)", [JSON.stringify({ name: rows[0].name })]);
    res.json({ ok: true });
  }));

  return r;
}
