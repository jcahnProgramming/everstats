import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// "Your guilds" (0.9.1). Fixture rows only (names say so); no Blizzard request is made.
let t;
const TOKEN_A = 'fixture-session-token-aaaaaaaa';
const TOKEN_B = 'fixture-session-token-bbbbbbbb';
before(async () => {
  t = await startApp();
  const { sha256Hex } = await import('../credentials/crypto.js');
  const q = t.db;
  await q.query("INSERT INTO rulesets (id, name) VALUES (2, 'Fixture ruleset')");
  for (const [id, slug] of [[901, 'fixture-own'], [902, 'fixture-hidden-char'], [903, 'fixture-followed'], [904, 'fixture-other'], [905, 'fixture-third']]) {
    await q.query('INSERT INTO guilds (id, slug, name, faction, ruleset_id) VALUES ($1, $2, $3, $4, 2)', [id, slug, `Fixture ${slug}`, 'Horde']);
  }
  const a = (await q.one('INSERT INTO accounts DEFAULT VALUES RETURNING id')).id;
  const b = (await q.one('INSERT INTO accounts DEFAULT VALUES RETURNING id')).id;
  await q.query("INSERT INTO sessions (id_hash, account_id, stage, method, expires_at) VALUES ($1, $2, 'full', 'battlenet', now() + interval '1 day'), ($3, $4, 'full', 'battlenet', now() + interval '1 day')", [sha256Hex(TOKEN_A), a, sha256Hex(TOKEN_B), b]);
  await q.query(`INSERT INTO characters (id, slug, name, surname, ruleset_id, profile_state, owner_account_id, guild_id, hidden, level, source)
                 VALUES (8001, 'fixture-one', 'Fixture', 'One', 2, 'ok', $1, 901, false, 20, 'account'), (8002, 'fixture-two', 'Fixture', 'Two', 2, 'ok', $1, 902, true, 20, 'account')`, [a]);
});
after(async () => {
  await t.close();
});
const as = (token) => {
  const c = t.client({ ip: '198.51.100.90' });
  c.jar.set('es_session', token);
  return c;
};

test('own guilds appear by themselves, a hidden character’s too (to its owner only)', async () => {
  const mine = (await as(TOKEN_A).get('/api/account/followed-guilds')).json;
  assert.deepEqual(mine.guilds.map((g) => g.slug).sort(), ['fixture-hidden-char', 'fixture-own']);
  assert.ok(mine.guilds.every((g) => g.own && !g.pinned));
  const theirs = (await as(TOKEN_B).get('/api/account/followed-guilds')).json;
  assert.deepEqual(theirs.guilds, []);
  assert.equal((await t.client().get('/api/account/followed-guilds')).status, 401);
});

test('pin any guild; the limit is an admin setting; own guilds are hidden, never unpinned', async () => {
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'dashboard.maxPinnedGuilds', 1);
  const c = as(TOKEN_A);
  assert.equal((await c.put('/api/account/followed-guilds/903/pin', { pinned: true })).status, 200);
  const full = await c.put('/api/account/followed-guilds/904/pin', { pinned: true });
  assert.equal(full.status, 409);
  let s = (await c.get('/api/account/followed-guilds')).json;
  assert.ok(s.guilds.some((g) => g.slug === 'fixture-followed' && g.pinned && !g.own));
  assert.equal((await c.get('/api/account/followed-guilds/901')).json.own, true);
  // A followed guild can't be "hidden"; an own one can, and shows in the hidden list.
  assert.equal((await c.put('/api/account/followed-guilds/903/hidden', { hidden: true })).status, 409);
  await c.put('/api/account/followed-guilds/901/hidden', { hidden: true });
  s = (await c.get('/api/account/followed-guilds')).json;
  assert.ok(!s.guilds.some((g) => g.id === 901));
  assert.deepEqual(s.hidden.map((g) => g.id), [901]);
  await c.put('/api/account/followed-guilds/901/hidden', { hidden: false });
  // Unpin from the card.
  await c.put('/api/account/followed-guilds/903/pin', { pinned: false });
  assert.ok(!(await c.get('/api/account/followed-guilds')).json.guilds.some((g) => g.id === 903));
  await setSetting(t.db, 'dashboard.maxPinnedGuilds', 10);
});

test('one order for the whole section, saved from the drag-and-drop list', async () => {
  const c = as(TOKEN_A);
  await c.put('/api/account/followed-guilds/905/pin', { pinned: true });
  await c.put('/api/account/followed-guilds-order', { guildIds: [905, 902, 901] });
  assert.deepEqual((await c.get('/api/account/followed-guilds')).json.guilds.map((g) => g.id), [905, 902, 901]);
  // A guild Everstats doesn't have can't be pinned; a write needs the site's Origin.
  assert.equal((await c.put('/api/account/followed-guilds/999/pin', { pinned: true })).status, 404);
  const noOrigin = t.client({ ip: '198.51.100.91', origin: null });
  noOrigin.jar.set('es_session', TOKEN_A);
  assert.equal((await noOrigin.put('/api/account/followed-guilds/904/pin', { pinned: true })).status, 403);
});
