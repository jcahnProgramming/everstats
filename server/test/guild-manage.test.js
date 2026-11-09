import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Guild page management (0.7.0). Fixture names and made-up ids only.
let t;
let admin;
let discordUser = 9500;
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
  await t.db.query("INSERT INTO guilds (id, slug, name, ruleset_id, profile_fetched_at, profile_state) VALUES (77, 'fixture-guild', 'Fixture Guild', 2, now(), 'ok')");
});
after(() => t.close());

let ip = 10;
async function newPlayer(username) {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  if (username) await c.put('/api/account/username', { username });
  return { c, id: (await c.get('/api/account')).json.account.id, username };
}
let nextChar = 70_000;
async function member(owner, { rank = 3, level = 30, hidden = false, inGuild = true } = {}) {
  nextChar += 1;
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, class, level, profile_state, source, data_fetched_at, stats_fetched_at, owner_account_id, hidden, guild_id)
     VALUES ($1, $2, 'Fixture', $3, 2, 'Horde', 'Warrior', $4, 'ok', 'guild', now(), now(), $5, $6, $7)`,
    [nextChar, `fixture-m${nextChar}`, `M${nextChar}`, level, owner, hidden, inGuild ? 77 : null],
  );
  if (rank !== null) await t.db.query('INSERT INTO guild_roster (guild_id, character_id, rank, level, fetched_at) VALUES (77, $1, $2, $3, now())', [nextChar, rank, level]);
  return nextChar;
}
const sync = async () => {
  const { syncGuildMaster } = await import('../guilds/manage.js');
  return t.db.tx((q) => syncGuildMaster(q, 77));
};

let gm;
let officer;
test('the owner of the rank-0 character is Guild Master (even a hidden or under-10 GM character); others can’t edit', async () => {
  gm = await newPlayer('fixturegm');
  officer = await newPlayer('fixtureofficer');
  const stranger = await newPlayer('fixturestranger');
  await member(gm.id, { rank: 0, hidden: true, level: 8 });
  await member(officer.id, { rank: 2 });
  await sync();
  assert.equal((await gm.c.get('/api/guilds/fixture-guild/manage')).json.role, 'gm');
  assert.equal((await stranger.c.get('/api/guilds/fixture-guild/manage')).json.role, null);
  assert.equal((await stranger.c.put('/api/guilds/fixture-guild/manage', { description: 'mine now' })).status, 403);
  assert.deepEqual((await gm.c.get('/api/account/guilds')).json.guilds, [{ slug: 'fixture-guild', name: 'Fixture Guild', role: 'gm' }]);
  const log = await t.db.query("SELECT type, account_id FROM guild_events WHERE guild_id = 77 AND type = 'control.changed'");
  assert.deepEqual(log, [{ type: 'control.changed', account_id: gm.id }]);
  // Guild Master badge for the owner.
  const { evaluateAccount } = await import('../badges/rules.js');
  await evaluateAccount(t.db, gm.id);
  assert.ok(await t.db.one("SELECT 1 AS x FROM badge_awards WHERE account_id = $1 AND badge_id = 'guild-master' AND state = 'held'", [gm.id]));
});

test('officers: only accounts with a tracked, visible character in the guild; they lose access when they leave; the GM removes them', async () => {
  const outsider = await newPlayer('fixtureoutsider');
  await member(outsider.id, { rank: null, inGuild: false });
  assert.equal((await gm.c.post('/api/guilds/fixture-guild/manage/editors', { username: 'fixtureoutsider' })).json.code, 'not_member');
  assert.equal((await gm.c.post('/api/guilds/fixture-guild/manage/editors', { username: '@fixtureofficer' })).status, 200);
  assert.equal((await officer.c.get('/api/guilds/fixture-guild/manage')).json.role, 'officer');
  // An officer can't add officers.
  assert.equal((await officer.c.post('/api/guilds/fixture-guild/manage/editors', { username: 'fixtureoutsider' })).status, 403);
  // Left the guild → no access, automatically.
  await t.db.query('UPDATE characters SET guild_id = NULL WHERE owner_account_id = $1', [officer.id]);
  assert.equal((await officer.c.get('/api/guilds/fixture-guild/manage')).json.role, null);
  await t.db.query('UPDATE characters SET guild_id = 77 WHERE owner_account_id = $1', [officer.id]);
  assert.equal((await officer.c.get('/api/guilds/fixture-guild/manage')).json.role, 'officer');
});

test('links: https only, no IPs, no shorteners, no blocklisted hosts, no ports or passwords; labels and the description are checked', async () => {
  const put = (body) => gm.c.put('/api/guilds/fixture-guild/manage', body);
  const one = (url, label = 'Website') => put({ links: [{ label, url }] });
  assert.match((await one('http://example.com')).json.error, /Only https/);
  assert.match((await one('javascript:alert(1)')).json.error, /Only https/);
  assert.match((await one('https://192.0.2.10/apply')).json.error, /IP address/);
  assert.match((await one('https://[2001:db8::1]/')).json.error, /IP address/);
  assert.match((await one('https://3221225994/')).json.error, /IP address/, 'a decimal IPv4 is normalised and refused');
  assert.match((await one('https://bit.ly/abc')).json.error, /shorteners/);
  assert.match((await one('https://go.bit.ly/abc')).json.error, /shorteners/);
  assert.match((await one('https://user:pw@example.com/')).json.error, /user name or password/);
  assert.match((await one('https://example.com:8443/')).json.error, /port/);
  assert.match((await one('https://intranet/')).json.error, /real domain/);
  assert.match((await one('https://example.com', '')).json.error, /can’t be empty/);
  assert.match((await one('https://example.com', 'x'.repeat(41))).json.error, /up to 40/);
  assert.match((await one('https://example.com', 'sh1t raid')).json.error, /isn’t allowed/);
  assert.match((await put({ links: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: `https://example.com/${i}` })) })).json.error, /Up to 5/);
  assert.match((await put({ discordInvite: 'https://discord.gg/abc' })).json.error, /not a link/);
  await t.client({ ip: '203.0.113.210' }).post('/api/admin/guild-links/blocklist', { host: 'https://www.bad-fixture.example.org/x', note: 'fixture' }, admin);
  assert.match((await one('https://raid.bad-fixture.example.org/')).json.error, /aren’t allowed/);

  const ok = await put({ description: 'Raids Tuesdays.\nwww.not-a-link.example is plain text.', discordInvite: 'fixtureinvite', links: [{ label: 'Raid team application', url: 'https://apply.example.com/raid?x=1' }, { label: 'Website', url: 'https://example.com' }] });
  assert.equal(ok.status, 200);
  const page = (await t.client().get('/api/guilds/fixture-guild')).json;
  assert.deepEqual(page.links.discord, { code: 'fixtureinvite', url: 'https://discord.gg/fixtureinvite' });
  assert.deepEqual(page.links.links.map((l) => [l.label, l.host]), [['Raid team application', 'apply.example.com'], ['Website', 'example.com']]);
  // An officer can edit too; unchanged links keep their ids (reports stay attached).
  const before = page.links.links.map((l) => l.id);
  await officer.c.put('/api/guilds/fixture-guild/manage', { description: 'Officer edit', discordInvite: 'fixtureinvite', links: [{ label: 'Website', url: 'https://example.com/' }] });
  const after2 = (await t.client().get('/api/guilds/fixture-guild')).json.links;
  assert.equal(after2.description, 'Officer edit');
  assert.deepEqual(after2.links.map((l) => l.id), [before[1]]);
  // The removed link is a state, kept as history.
  assert.ok(await t.db.one("SELECT 1 AS x FROM guild_links WHERE id = $1 AND removed_by = 'editor'", [before[0]]));
});

test('report a link → the admin queue; the admin removes it with a reason (logged)', async () => {
  const link = (await t.client().get('/api/guilds/fixture-guild')).json.links.links[0];
  const visitor = t.client({ ip: '203.0.113.211' });
  assert.equal((await visitor.post(`/api/guilds/fixture-guild/links/${link.id}/report`, { note: 'looks off' })).status, 200);
  const a = t.client({ ip: '203.0.113.212' });
  const q = (await a.get('/api/admin/guild-links', admin)).json;
  assert.equal(q.reports.length, 1);
  assert.equal((await a.post(`/api/admin/guild-links/${link.id}/remove`, { reason: '' }, admin)).status, 400);
  assert.equal((await a.post(`/api/admin/guild-links/${link.id}/remove`, { reason: 'Fixture: phishing' }, admin)).status, 200);
  assert.equal((await t.client().get('/api/guilds/fixture-guild')).json.links.links.length, 0);
  assert.equal((await a.get('/api/admin/guild-links', admin)).json.reports.length, 0);
  assert.ok(await t.db.one("SELECT 1 AS x FROM guild_events WHERE guild_id = 77 AND type = 'link.removed_by_admin'"));
});

test('handover: a new rank-0 character moves control at the next roster; officers stay; an unclaimed GM locks the page for everyone', async () => {
  const heir = await newPlayer('fixtureheir');
  await member(heir.id, { rank: 1 });
  // Next roster: the heir's character is rank 0, the old GM's is rank 1.
  await t.db.query('UPDATE guild_roster SET rank = 1 WHERE guild_id = 77 AND rank = 0');
  await t.db.query('UPDATE guild_roster SET rank = 0 WHERE guild_id = 77 AND character_id = (SELECT id FROM characters WHERE owner_account_id = $1 LIMIT 1)', [heir.id]);
  await sync();
  assert.equal((await heir.c.get('/api/guilds/fixture-guild/manage')).json.role, 'gm');
  assert.equal((await gm.c.get('/api/guilds/fixture-guild/manage')).json.role, null);
  assert.equal((await officer.c.get('/api/guilds/fixture-guild/manage')).json.role, 'officer', 'officers stay until the new GM removes them');
  assert.equal((await heir.c.del('/api/guilds/fixture-guild/manage/editors/fixtureofficer')).status, 200);
  assert.equal((await officer.c.get('/api/guilds/fixture-guild/manage')).json.role, null);
  // The rank-0 character now belongs to nobody on Everstats: the page stays as it is and nobody can edit it.
  await gm.c.get('/api/session');
  await t.db.query('UPDATE characters SET owner_account_id = NULL WHERE owner_account_id = $1', [heir.id]);
  await sync();
  assert.equal((await heir.c.get('/api/guilds/fixture-guild/manage')).json.role, null);
  assert.ok((await t.client().get('/api/guilds/fixture-guild')).json.links, 'the page keeps what it had');
  const log = (await t.db.query("SELECT account_id FROM guild_events WHERE guild_id = 77 AND type = 'control.changed' ORDER BY id")).map((r) => r.account_id);
  assert.deepEqual(log, [gm.id, heir.id, null]);
});

test('guild roster rows say who claimed each member, with their one inline badge', async () => {
  const page = (await t.client().get('/api/guilds/fixture-guild')).json;
  const claimed = page.roster.filter((m) => m.claimedBy);
  assert.ok(claimed.length >= 1);
  assert.ok(claimed.every((m) => typeof m.claimedBy.username === 'string'));
  assert.ok(claimed.some((m) => m.claimedBy.badge?.id === 'beta-tester'));
});
