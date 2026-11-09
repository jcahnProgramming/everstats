import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// 0.7.1: feedback with replies, hiding a render, the admin Activity counters, Beta Tester's wording and the owner's
// "Grant beta membership". Fixture names and made-up ids only.
let t;
let admin;
let discordUser = 9800;
before(async () => {
  t = await startApp({
    fetch: async (url) => {
      const u = String(url);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u === 'https://discord.com/api/oauth2/token') return json(200, { access_token: 'tok' });
      if (u === 'https://discord.com/api/users/@me') return json(200, { id: `1000000000000${discordUser}`, username: 'fixture' });
      return json(404, {});
    },
  });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  const { sha256Hex } = await import('../credentials/crypto.js');
  const token = randomBytes(32).toString('base64url');
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
  await t.db.query("INSERT INTO rulesets (id, name) VALUES (2, 'Normal') ON CONFLICT DO NOTHING");
});
after(() => t.close());

let ip = 10;
async function newPlayer(username) {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  if (username) await c.put('/api/account/username', { username });
  return { c, id: (await c.get('/api/account')).json.account.id };
}
const msg = 'The fixture page shows the wrong thing.';

test('feedback signed out: stored with the Discord name; the honeypot stores nothing; lengths and types are checked', async () => {
  const c = t.client({ ip: '203.0.113.20' });
  const r = await c.post('/api/feedback', { type: 'bug', message: msg, page: 'http://localhost:3000/c/fixture-one', discord: 'fixture_user' });
  assert.equal(r.status, 200);
  assert.equal(r.json.signedIn, false);
  const row = await t.db.one('SELECT account_id, page, discord, state FROM feedback_threads ORDER BY id DESC LIMIT 1');
  assert.deepEqual({ ...row }, { account_id: null, page: '/c/fixture-one', discord: 'fixture_user', state: 'unread' });
  const before = (await t.db.one('SELECT count(*)::int AS n FROM feedback_threads')).n;
  assert.equal((await c.post('/api/feedback', { type: 'bug', message: msg, website: 'http://spam.example' })).json.ok, true, 'a bot is told "sent"');
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM feedback_threads')).n, before, '…and nothing is stored');
  assert.equal((await c.post('/api/feedback', { type: 'bug', message: 'too short' })).status, 400);
  assert.equal((await c.post('/api/feedback', { type: 'bug', message: 'x'.repeat(4001) })).status, 400);
  assert.equal((await c.post('/api/feedback', { type: 'spam', message: msg })).status, 400);
  assert.equal((await c.post('/api/feedback', { type: 'bug', message: msg, page: 'https://elsewhere.example/x' })).status, 400, 'pages are Everstats addresses only');
});

test('feedback is rate-limited per network', async () => {
  const c = t.client({ ip: '203.0.113.21' });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await c.post('/api/feedback', { type: 'idea', message: `${msg} ${i}` })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

test('signed in: replies in a thread, the unread dot, replying back; HTML stays text; admin notes stay private', async () => {
  const p = await newPlayer('fixturefeedback');
  const sent = await p.c.post('/api/feedback', { type: 'question', message: '<b>Hello</b> https://example.com is this a link?', page: '/settings' });
  assert.equal(sent.json.signedIn, true);
  const id = sent.json.id;
  const c = t.client({ ip: '192.0.2.60' });
  const inbox = (await c.get('/api/admin/feedback?state=unread', admin)).json;
  const row = inbox.threads.find((x) => x.id === id);
  assert.equal(row.sender.username, 'fixturefeedback');
  await c.get(`/api/admin/feedback/${id}`, admin);
  assert.equal((await t.db.one('SELECT state FROM feedback_threads WHERE id = $1', [id])).state, 'read', 'opening it marks it read');
  await c.post(`/api/admin/feedback/${id}/notes`, { body: 'Private fixture note' }, admin);
  const reply = await c.post(`/api/admin/feedback/${id}/reply`, { message: 'Thanks, fixed.' }, admin);
  assert.equal(reply.json.thread.state, 'replied');
  assert.equal((await p.c.get('/api/session')).json.feedbackUnread, 1, 'the dot');
  const mine = (await p.c.get('/api/account/feedback')).json.threads.find((x) => x.id === id);
  assert.equal(mine.messages[0].body, '<b>Hello</b> https://example.com is this a link?', 'stored and returned as plain text');
  assert.deepEqual(mine.messages.map((m) => m.author), ['player', 'everstats']);
  assert.ok(!JSON.stringify(mine).includes('Private fixture note'), 'notes never reach the player');
  await p.c.get(`/api/account/feedback/${id}`);
  assert.equal((await p.c.get('/api/session')).json.feedbackUnread, 0, 'opening clears it');
  await p.c.post(`/api/account/feedback/${id}/reply`, { message: 'Great, thank you' });
  assert.equal((await t.db.one('SELECT state FROM feedback_threads WHERE id = $1', [id])).state, 'unread', 'back in the admin’s unread pile');
  // A signed-out thread can't be replied to on the site.
  const out = await t.db.one('SELECT id FROM feedback_threads WHERE account_id IS NULL LIMIT 1');
  assert.equal((await c.post(`/api/admin/feedback/${out.id}/reply`, { message: 'hello' }, admin)).status, 409);
  // Someone else's thread is not theirs to read.
  const other = await newPlayer('fixturefeedback2');
  assert.equal((await other.c.get(`/api/account/feedback/${id}`)).status, 404);
  // Deleting the account deletes its feedback.
  assert.equal((await p.c.del('/api/account', {}, { confirm: 'delete' })).status, 200);
  assert.equal(await t.db.one('SELECT id FROM feedback_threads WHERE id = $1', [id]), null);
});

test('hide my render: owner only; the render and avatar are never sent; the page says it was hidden', async () => {
  const p = await newPlayer('fixturerender');
  const stranger = await newPlayer('fixturerender2');
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, class, level, profile_state, source, data_fetched_at, stats_fetched_at, last_fetched_at, owner_account_id, media, media_state)
     VALUES (88001, 'fixture-render', 'Fixture', 'Render', 2, 'Horde', 'Priest', 30, 'ok', 'account', now(), now(), now(), $1,
             '{"main-raw": "https://render.worldofwarcraft.com/fixture.jpg", "avatar": "https://render.worldofwarcraft.com/fixture-a.jpg"}', 'ok')`,
    [p.id],
  );
  assert.equal((await stranger.c.put('/api/account/characters/88001/render', { hidden: true })).status, 404);
  assert.equal((await p.c.put('/api/account/characters/88001/render', { hidden: true })).status, 200);
  const page = await t.client({ ip: '203.0.113.30' }).get('/api/characters/fixture-render');
  assert.equal(page.json.character.media.state, 'hidden');
  assert.ok(!page.text.includes('render.worldofwarcraft.com/fixture'), 'no render URL anywhere in the answer');
  assert.equal((await p.c.get('/api/account')).json.account.characters.find((c) => c.id === 88001).renderHidden, true);
  await p.c.put('/api/account/characters/88001/render', { hidden: false });
  assert.equal((await t.client({ ip: '203.0.113.31' }).get('/api/characters/fixture-render')).json.character.media.state, 'ok');
});

test('activity: counts kinds per hour, nothing about who; a refused network isn’t counted; the marker moves only on request', async () => {
  const c = t.client({ ip: '203.0.113.40' });
  await t.db.query("INSERT INTO guilds (id, slug, name, ruleset_id, profile_fetched_at, profile_state) VALUES (601, 'fixture-activity', 'Fixture Activity', 2, now(), 'ok')");
  await c.get('/api/guilds/fixture-activity?via=search');
  await c.get('/api/guilds/fixture-activity');
  await c.get('/api/search?q=fixture&count=1');
  await c.get('/api/search?q=fixture');
  await new Promise((r) => setTimeout(r, 100));
  const rows = await t.db.query('SELECT kind, n FROM activity_counts ORDER BY kind');
  const n = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  assert.equal(n['guild.view'], 2);
  assert.equal(n['guild.search'], 1);
  assert.equal(n['search.page'], 1, 'typing suggestions are not counted');
  const cols = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'activity_counts' ORDER BY ordinal_position")).map((r) => r.column_name);
  assert.deepEqual(cols, ['hour', 'kind', 'n'], 'no address, agent or visitor id column');
  // A network the look-up limiter is refusing is treated as automated.
  const bot = t.client({ ip: '203.0.113.41' });
  for (let i = 0; i < 30; i++) t.app.locals.limits.lookups.take('203.0.113.41');
  await bot.get('/api/guilds/fixture-activity');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await t.db.one("SELECT n FROM activity_counts WHERE kind = 'guild.view'")).n, 2);
  // The panel: the marker isn't moved by reading it.
  const a = t.client({ ip: '192.0.2.61' });
  const view = (await a.get('/api/admin/activity', admin)).json;
  assert.equal(view.checkedAt, null);
  assert.equal((await a.get('/api/admin/activity', admin)).json.checkedAt, null);
  assert.equal((await a.post('/api/admin/activity/checked', {}, admin)).status, 400, 'needs confirming');
  const marked = (await a.post('/api/admin/activity/checked', { confirm: true }, admin)).json;
  assert.ok(marked.checkedAt);
  assert.equal(view.searches.partial, true, 'a range starting before counting began is marked partial');
  assert.equal(view.days.length, 14);
  assert.equal((await t.client({ ip: '203.0.113.42' }).get('/api/admin/activity')).status, 404, 'behind the admin gate');
});

test('Beta Tester: “not for this account” while the beta is open, never “no longer available”', async () => {
  const { availabilityFor, badgeContext, definitionById } = await import('../badges/store.js');
  const ctx = await badgeContext(t.db);
  assert.equal(ctx.beta.open, true);
  const def = await definitionById(t.db, 'beta-tester');
  // An account made before the window opened (the window opened when this test database was migrated).
  const a = availabilityFor(def, ctx, { created_at: new Date(Date.parse(ctx.beta.openedAt) - 86_400_000).toISOString() });
  assert.equal(a.status, 'ineligible');
  assert.match(a.note, /^Only for accounts created while the beta is open \(since \d{4}-\d{2}-\d{2}\)\. This account was made before the beta opened\.$/);
  // Once the beta closes, it IS "no longer available".
  const closed = availabilityFor(def, { ...ctx, beta: { open: false, openedAt: ctx.beta.openedAt, closedAt: new Date().toISOString() } }, null);
  assert.equal(closed.status, 'unavailable');
});

test('Grant beta membership: admin only, reason required, logged, Beta Tester follows; nothing else can write it', async () => {
  const p = await newPlayer('fixturebetagrant');
  // An account from before 0.4.0's window: not a member (made directly, the trigger decides at insert).
  const row = await t.db.one("INSERT INTO accounts (created_at) VALUES (now() - interval '400 days') RETURNING id, beta_member");
  assert.equal(row.beta_member, false);
  const c = t.client({ ip: '192.0.2.62' });
  assert.equal((await c.post(`/api/admin/badges/accounts/${row.id}/beta`, {}, admin)).status, 400, 'reason required');
  assert.equal((await p.c.post(`/api/admin/badges/accounts/${row.id}/beta`, { reason: 'mine' })).status, 404, 'players can’t');
  const ok = await c.post(`/api/admin/badges/accounts/${row.id}/beta`, { reason: 'Owner’s account, made before the beta' }, admin);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.account.beta.member, true);
  assert.ok(ok.json.account.badges.some((b) => b.id === 'beta-tester' && b.state === 'held'));
  assert.ok(await t.db.one("SELECT 1 AS x FROM admin_events WHERE type = 'beta.granted'"));
  assert.equal((await c.post(`/api/admin/badges/accounts/${row.id}/beta`, { reason: 'again' }, admin)).status, 409);
  // Outside the admin route, the trigger still refuses any change.
  await assert.rejects(t.db.query('UPDATE accounts SET beta_member = false WHERE id = $1', [row.id]), /permanent/);
  const fresh = await t.db.one("INSERT INTO accounts (created_at) VALUES (now() - interval '500 days') RETURNING id");
  await assert.rejects(t.db.query('UPDATE accounts SET beta_member = true, beta_since = now() WHERE id = $1', [fresh.id]), /permanent/);
});

test('crawler panel: "this UTC hour" is the current hour, never an earlier one', async () => {
  const { countRequests } = await import('../crawler/stats.js');
  await countRequests(t.db, { requests: 793 }, Date.now() - 2 * 3_600_000);
  const { crawlerStatus } = await import('../admin/crawler.js');
  const s = await crawlerStatus(t.db);
  assert.equal(s.thisHour.requests, 0, 'nothing this hour yet: 0, not the 793 from two hours ago');
  await countRequests(t.db, { requests: 5 });
  assert.equal((await crawlerStatus(t.db)).thisHour.requests, 5);
});
