/**
 * The beta window (beta_windows). Open from 0.4.0 until the owner closes it on the admin page: closing is a setting
 * change, not a deploy. Membership is decided by the window alone, at account creation, by a database trigger
 * (schema.js 009_beta): an account made while it was open is a beta member forever, one made while it was closed
 * never is, and reopening grants nothing to accounts made in between.
 */
export async function betaState(db) {
  const open = await db.one('SELECT opened_at FROM beta_windows WHERE closed_at IS NULL LIMIT 1');
  if (open) return { open: true, openedAt: open.opened_at, closedAt: null };
  const last = await db.one('SELECT opened_at, closed_at FROM beta_windows ORDER BY closed_at DESC LIMIT 1');
  return { open: false, openedAt: last?.opened_at ?? null, closedAt: last?.closed_at ?? null };
}

export async function setBetaOpen(db, open, { reason = null } = {}) {
  await db.tx(async (q) => {
    await q.query('LOCK TABLE beta_windows IN SHARE ROW EXCLUSIVE MODE');
    const current = await q.one('SELECT id FROM beta_windows WHERE closed_at IS NULL');
    if (open && !current) await q.query('INSERT INTO beta_windows DEFAULT VALUES');
    if (!open && current) await q.query('UPDATE beta_windows SET closed_at = now() WHERE id = $1', [current.id]);
    if (Boolean(current) !== open) await q.query("INSERT INTO admin_events (type, detail) VALUES ('beta.changed', $1::jsonb)", [JSON.stringify({ open, before: Boolean(current), ...(reason ? { reason: String(reason).slice(0, 500) } : {}) })]);
  });
  return betaState(db);
}
