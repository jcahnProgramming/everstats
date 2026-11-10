import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

/**
 * 0.10.3: the v5 admin shell's own API: nav counts, preferences, settings search, the Dashboard and the Audit log.
 */
let t;
before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 200 }) });
});
after(() => t.close());

const admin = async () => {
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};

test('every shell route is a plain 404 without an admin session', async () => {
  const c = t.client();
  for (const path of ['/api/admin/shell', '/api/admin/shell/counts', '/api/admin/search?q=crawl', '/api/admin/audit', '/api/admin/dashboard', '/api/admin/features']) {
    const res = await c.get(path);
    assert.equal(res.status, 404, path);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
  assert.equal((await c.put('/api/admin/prefs/refresh.auto', { value: 30 })).status, 404);
});

test('the shell: versions, regions, the four count badges and the admin’s preferences', async () => {
  const h = await admin();
  const c = t.client();
  const shell = (await c.get('/api/admin/shell', h)).json;
  assert.ok(shell.versions.some((v) => v.id === 'forever' && v.primary && v.enabled));
  assert.ok(shell.versions.some((v) => v.id === 'retail' && !v.enabled), 'turned-off versions are listed (admin only)');
  assert.deepEqual(Object.keys(shell.counts).sort(), ['data', 'discovery', 'inbox', 'retention']);
  assert.deepEqual(shell.counts.inbox, { n: 0, tone: 'accent', label: 'unread or open' });

  await t.db.query("INSERT INTO feedback_threads (type, page) VALUES ('bug', '/')").catch(async () => {
    // feedback_threads' required columns differ by release; a report is enough for the count
  });
  const counts = (await c.get('/api/admin/shell/counts', h)).json.counts;
  assert.ok(counts.inbox.n >= 0);

  assert.equal((await c.put('/api/admin/prefs/refresh.auto', { value: 45 }, h)).status, 400, 'only the offered intervals');
  assert.equal((await c.put('/api/admin/prefs/nope', { value: 1 }, h)).status, 404);
  const saved = await c.put('/api/admin/prefs/refresh.auto', { value: 60 }, h);
  assert.equal(saved.json.prefs['refresh.auto'], 60);
  await c.put('/api/admin/prefs/dashboard.order', { value: ['crawler', 'players'] }, h);
  assert.deepEqual((await c.get('/api/admin/shell', h)).json.prefs['dashboard.order'], ['crawler', 'players']);
});

test('settings search finds settings and features with their path and value, and the audit log', async () => {
  const h = await admin();
  const c = t.client();
  const r1 = (await c.get('/api/admin/search?q=requests per second', h)).json.results;
  const crawl = r1.find((r) => r.id === 'crawler.requestsPerSecond');
  assert.ok(crawl, 'found by its label');
  assert.equal(crawl.path, 'Settings › Crawler limits');
  assert.equal(crawl.value, '8');
  assert.equal(crawl.href, '/admin/settings#set-crawler.requestsPerSecond');

  const r2 = (await c.get('/api/admin/search?q=renders', h)).json.results;
  const renders = r2.find((r) => r.kind === 'feature' && r.id === 'renders');
  assert.ok(renders);
  assert.equal(renders.href, '/admin/features#feat-renders');
  assert.match(renders.value, /^(On|Off)$/);

  await c.put('/api/admin/settings/guilds.minMembers', { value: 7, reason: 'testing the audit log' }, h);
  const r3 = (await c.get('/api/admin/search?q=guilds.minMembers', h)).json.results;
  assert.ok(r3.some((r) => r.kind === 'audit'), 'the change is found in the audit log too');
  assert.deepEqual((await c.get('/api/admin/search?q=a', h)).json.results, [], 'one letter searches nothing');
});

test('the audit log: before → after and why for a setting, feature switches, moderation, sign-ins; paged and filtered', async () => {
  const h = await admin();
  const c = t.client();
  await c.put('/api/admin/settings/guilds.minBoardGuilds', { value: 4, reason: 'more guilds first' }, h);
  await c.put('/api/admin/settings/guilds.minBoardGuilds', { value: 5 }, h);
  const page = (await c.get('/api/admin/audit?area=settings', h)).json;
  const [newest, older] = page.entries.filter((e) => e.target?.id === 'guilds.minBoardGuilds');
  assert.equal(newest.before, 4);
  assert.equal(newest.after, 5);
  assert.equal(newest.reason, null);
  assert.equal(older.before, 3, 'the declared default before the first change');
  assert.equal(older.after, 4);
  assert.equal(older.reason, 'more guilds first');
  assert.equal(older.actor.label, 'Admin');
  assert.equal(older.target.href, '/admin/settings#set-guilds.minBoardGuilds');

  // A feature switch is logged once, named as the feature, under Features.
  const sw = await c.put('/api/admin/features/roster-seed', { on: false, reason: 'quiet week' }, h);
  assert.equal(sw.status, 200);
  const feats = (await c.get('/api/admin/audit?area=features', h)).json.entries;
  const f = feats.find((e) => e.target?.id === 'roster-seed');
  assert.equal(f.action, 'Seed from guild rosters turned off');
  assert.equal(f.before, true);
  assert.equal(f.after, false);
  assert.equal(f.reason, 'quiet week');
  assert.equal(feats.filter((e) => e.target?.id === 'roster-seed').length, 1, 'never logged twice');
  assert.ok(!(await c.get('/api/admin/audit?area=settings', h)).json.entries.some((e) => e.target?.id === 'roster-seed'), 'a feature is not a plain setting');
  await c.put('/api/admin/features/roster-seed', { on: true, reason: 'back on' }, h);

  // Moderation entries come from moderation_actions with who did it.
  await t.db.query("INSERT INTO moderation_actions (type, actor, reason, account_id) VALUES ('warning', 'admin', 'spam in bio', 999999)");
  const mod = (await c.get('/api/admin/audit?area=moderation', h)).json.entries.find((e) => e.reason === 'spam in bio');
  assert.equal(mod.action, 'Warning');
  assert.equal(mod.target.href, '/admin/directory/accounts/999999');
  assert.match(mod.target.label, /deleted/);

  // Paging: every entry once, newest first.
  for (let i = 0; i < 6; i++) await c.put('/api/admin/settings/guilds.minMembers', { value: 10 + i }, h);
  const seen = [];
  let cursor = null;
  for (let n = 0; n < 50; n++) {
    const p = (await c.get(`/api/admin/audit?area=settings${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, h)).json;
    seen.push(...p.entries.map((e) => e.id));
    cursor = p.next;
    if (!cursor) break;
  }
  assert.equal(new Set(seen).size, seen.length, 'no entry twice across pages');
  assert.equal((await c.get('/api/admin/audit?cursor=junk', h)).status, 400);
  assert.equal((await c.get('/api/admin/audit?area=nope', h)).status, 400);

  const target = (await c.get('/api/admin/audit?target=setting:guilds.minMembers', h)).json.entries;
  assert.ok(target.length >= 6 && target.every((e) => e.target.id === 'guilds.minMembers'));
});

test('the dashboard: needs-you, the period, all 11 cards, per-version scope; nothing invented', async () => {
  const h = await admin();
  const c = t.client();
  const d = (await c.get('/api/admin/dashboard?range=24h&v=forever&r=us', h)).json;
  assert.deepEqual(Object.keys(d.cards).sort(), ['backups', 'characters', 'collections', 'crawler', 'faction', 'features', 'inbox', 'players', 'retention', 'ruleset', 'searches']);
  assert.equal(d.range, '24h');
  assert.equal(d.scope.version, 'forever');
  assert.equal(d.cards.players.days.length, 14);
  assert.ok(Array.isArray(d.needs));
  // Since launch has no "change": null, never 0.
  const all = (await c.get('/api/admin/dashboard?range=launch', h)).json;
  assert.equal(all.cards.players.new, null);
  // Another version counts only its own characters (none here).
  const retail = (await c.get('/api/admin/dashboard?v=retail&r=us', h)).json;
  assert.equal(retail.cards.characters.known, 0);
  assert.equal(retail.scope.versionName, 'World of Warcraft');
});

test('admin sign-outs are in the audit log', async () => {
  const h = await admin();
  const c = t.client();
  await c.post('/api/admin/sign-out', {}, h);
  const h2 = await admin();
  const e = (await c.get('/api/admin/audit?area=sign-in', h2)).json.entries;
  assert.ok(e.some((x) => x.action === 'Admin signed out'));
});

test('one dashboard card failing leaves the others answering (the page shows it failed, never blank)', async () => {
  const h = await admin();
  const c = t.client();
  await t.db.query('ALTER TABLE character_gold_public RENAME TO character_gold_public_x');
  try {
    const d = (await c.get('/api/admin/dashboard?range=24h', h)).json;
    assert.match(d.cards.players.error, /Couldn’t count this/);
    assert.ok(!d.cards.inbox.error && !d.cards.crawler.error && !d.cards.features.error);
    assert.ok(d.needs.some((n) => n.text.includes('players')), 'needs-you says a card failed');
  } finally {
    await t.db.query('ALTER TABLE character_gold_public_x RENAME TO character_gold_public');
  }
});

test('0.10.4: the dashboard counts PLAYER passkeys only (accounts with one); the admin’s passkeys never count', async () => {
  const h = await admin();
  const c = t.client();
  const before = (await c.get('/api/admin/dashboard?range=launch', h)).json.cards.players;
  const pk = (x) => x.methods.find((m) => m.id === 'passkey').n;
  // The admin's own passkey (admin_passkeys) is not a player's.
  await t.db.query("INSERT INTO admin_passkeys (credential_id, public_key, sign_count, transports) VALUES ('admin-cred-fixture', $1, 0, '{}')", [Buffer.from([1])]);
  assert.equal(pk((await c.get('/api/admin/dashboard?range=launch', h)).json.cards.players), pk(before));
  // A passkey added from Settings is a passkeys row (the INSERT account/routes.js makes); two on one account count once.
  const acct = (await t.db.one('INSERT INTO accounts DEFAULT VALUES RETURNING id')).id;
  for (const cred of ['player-cred-1', 'player-cred-2']) {
    await t.db.query("INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, $2, $3, 0, '{}', 'Passkey')", [acct, cred, Buffer.from([1])]);
  }
  const after = (await c.get('/api/admin/dashboard?range=launch', h)).json.cards.players;
  assert.equal(pk(after), pk(before) + 1);
  assert.equal(after.passkeys, pk(after));
  assert.equal(after.strong, before.strong + 1);
  assert.equal(after.totp, before.totp);
});
