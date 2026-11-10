import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { PRIORITY } from '../crawler/queue.js';

/**
 * The feature switches (0.10.3, server/features/registry.js). For EVERY feature the registry lists here, the test turns
 * it off on its own through the admin API, loads the public endpoints it touches, and checks the declared fallback:
 * never a 500, and exactly what "whenOff" says. A feature added to the registry without a check here fails the test.
 *
 * A fake Battle.net, Discord and Blizzard API; every name is a test fixture, never shipped data.
 */
const API = 'https://us.api.blizzard.com';
const calls = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CHAR = { id: 5101, slug: 'ada-fixture', name: 'Ada', surname: 'Fixture', level: 30 };
const GUILD = { id: 951, slug: 'feature-guild', name: 'Feature Guild' };

async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  calls.push(u.pathname);
  const auth = String(opts.headers?.Authorization ?? '');
  if (u.href === 'https://oauth.battle.net/token' || u.href === 'https://discord.com/api/oauth2/token') {
    const b = new URLSearchParams(String(opts.body));
    if (b.get('grant_type') === 'client_credentials') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
    return json(200, { access_token: `tok-${b.get('code')}`, token_type: 'bearer' });
  }
  const who = auth.replace('Bearer tok-', '');
  if (u.href === 'https://oauth.battle.net/userinfo') return json(200, { sub: `bnet-${who}`, battletag: `Fixture${who}#1` });
  if (u.href === 'https://discord.com/api/users/@me') return json(200, { id: `30000000000000${who.replace(/\D/g, '').padStart(4, '0')}`, username: `d_${who}` });
  if (u.origin !== API) return json(404, {});
  if (u.pathname === '/profile/user/wow') {
    if (who !== 'owner') return json(404, {});
    return json(200, { wow_accounts: [{ id: 1, characters: [{ character: { href: `${API}/profile/wow/character/${CHAR.slug}?namespace=profile-forever-us` }, protected_character: { href: `${API}/profile/user/wow/protected-character/6929-${CHAR.id}?namespace=profile-forever-us` }, id: CHAR.id, name: CHAR.name, surname: CHAR.surname, level: CHAR.level }] }] });
  }
  if (/^\/profile\/user\/wow\/protected-character\//.test(u.pathname)) return json(200, { id: CHAR.id, name: 'X', money: 500, protected_stats: { total_gold_gained: 900, total_gold_lost: 400, total_item_value_gained: 50 } });
  const gm = /^\/data\/wow\/guild\/([^/]+)(\/roster)?$/.exec(u.pathname);
  if (gm) {
    if (gm[1] !== GUILD.slug) return json(404, {});
    if (gm[2]) return json(200, { members: [{ character: { name: CHAR.name, surname: CHAR.surname, id: CHAR.id, level: CHAR.level, slug: CHAR.slug }, rank: 0 }] });
    return json(200, { id: GUILD.id, name: GUILD.name, slug: GUILD.slug, faction: { type: 'HORDE', name: 'Horde' }, member_count: 1, created_timestamp: 1793847870000, ruleset: { name: 'Normal', id: 2 } });
  }
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m || decodeURIComponent(m[1]) !== CHAR.slug) return json(404, {});
  const sub = m[2] ?? '';
  if (sub === '') {
    return json(200, {
      _links: { self: { href: `${API}/profile/wow/character/${CHAR.slug}?namespace=profile-forever-us` } },
      id: CHAR.id, name: CHAR.name, surname: CHAR.surname, level: CHAR.level, faction: { type: 'HORDE', name: 'Horde' }, race: { name: 'Orc' },
      character_class: { name: 'Warrior' }, ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000, guild: { id: GUILD.id, name: GUILD.name, slug: GUILD.slug },
    });
  }
  if (sub === '/achievements/statistics') return json(200, { categories: [{ id: 128, name: 'Kills', statistics: [{ id: 107, name: 'Creatures killed', quantity: 10 }] }] });
  if (sub === '/statistics') return json(200, { health: 400 });
  if (sub === '/equipment') return json(200, { equipped_items: [] });
  if (sub === '/character-media') return json(200, { assets: [] });
  return json(404, {});
}

let t;
let admin;
let owner;
let banned;
let threadId;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
});
after(async () => {
  await t.close();
});

async function oauth(c, provider, code, intent = 'sign_in') {
  const start = await c.post(`/api/auth/${provider}/start`, { intent });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const cb = await c.get(`/auth/${provider}/callback?code=${code}&state=${new URL(start.json.url).searchParams.get('state')}`);
  return cb.headers.get('location');
}
const since = (mark, re) => calls.slice(mark).filter((p) => re.test(p)).length;
const put = (id, body) => t.client({ ip: '192.0.2.200' }).put(`/api/admin/features/${id}`, body, admin);
const features = async () => (await t.client({ ip: '192.0.2.200' }).get('/api/admin/features', admin)).json.features;

/** Turns a feature on or off the way the Features page does (the dependents confirm when the server asks for it). */
async function flip(id, on) {
  let r = await put(id, { on, reason: `test: ${id} ${on ? 'on' : 'off'}` });
  if (r.status === 409 && r.json.code === 'has_dependents') r = await put(id, { on, reason: `test: ${id} ${on ? 'on' : 'off'}`, confirmDependents: true });
  assert.equal(r.status, 200, `${id} → ${on}: ${JSON.stringify(r.json)}`);
  return r;
}

test('the switches carry over the values the old settings had (nothing is reset or hardcoded)', async () => {
  const { setSetting } = await import('../admin/settings.js');
  const { clearFeatureCache } = await import('../features/registry.js');
  // What production could hold on deploy day: renders turned back on, the crawl paused, roster seeding and the backfill
  // off, moderators on.
  await setSetting(t.db, 'renders.show', true);
  await setSetting(t.db, 'crawler.paused', true);
  await setSetting(t.db, 'crawler.rosterExpansion', false);
  await setSetting(t.db, 'collections.backfill', false);
  await setSetting(t.db, 'moderation.moderators', true);
  clearFeatureCache();
  const on = Object.fromEntries((await features()).map((f) => [f.id, f.on]));
  assert.equal(on.renders, true);
  assert.equal(on.crawl, false);
  assert.equal(on['roster-seed'], false);
  assert.equal(on['collections-backfill'], false);
  assert.equal(on.moderators, true);
  assert.equal(on.beta, true); // the window migration 009 opened
  // The new switches start as what the site did before them.
  for (const id of ['share-cards', 'collections', 'gold', 'guild-fetch', 'discord', 'feedback', 'reports']) assert.equal(on[id], true, id);
  assert.equal(on['dev-gate'], undefined); // dev site only
  // Back to the site's defaults for the rest of this file.
  await setSetting(t.db, 'crawler.paused', false);
  await setSetting(t.db, 'crawler.rosterExpansion', true);
  await setSetting(t.db, 'collections.backfill', true);
  await setSetting(t.db, 'moderation.moderators', false);
  clearFeatureCache();
});

test('fixtures: a tracked, owned character in a guild with a page, a feedback thread, and a banned player', async () => {
  const { createCrawler } = await import('../crawler/service.js');
  const { client } = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  const { fetchCharacter } = await import('../crawler/fetch.js');
  await fetchCharacter({ db: t.db, client }, { key: CHAR.slug, priority: PRIORITY.lookup, mode: 'full' });
  const { fetchGuildRoster } = await import('../crawler/fetch.js');
  await fetchGuildRoster({ db: t.db, client }, { key: GUILD.slug, priority: PRIORITY.lookup });
  assert.ok(await t.db.one('SELECT 1 AS x FROM guilds WHERE id = $1', [GUILD.id]), 'the guild row exists');
  owner = t.client({ ip: '198.51.100.11' });
  await oauth(owner, 'battlenet', 'owner');
  assert.equal((await owner.put('/api/account/username', { username: 'featowner' })).status, 200);
  await t.db.query("INSERT INTO guild_pages (guild_id, description) VALUES ($1, 'A fixture guild description') ON CONFLICT (guild_id) DO UPDATE SET description = EXCLUDED.description", [GUILD.id]);
  await t.db.query("INSERT INTO guild_links (guild_id, position, label, url, host) VALUES ($1, 0, 'Site', 'https://example.org/x', 'example.org')", [GUILD.id]);
  const sent = await owner.post('/api/feedback', { type: 'bug', message: 'A fixture message long enough', page: '/' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  threadId = sent.json.id;
  // A banned player: an appeal must keep working while the feedback form is off.
  banned = t.client({ ip: '198.51.100.12' });
  await oauth(banned, 'battlenet', 'banned1');
  const bid = Number((await t.db.one("SELECT account_id FROM account_identities WHERE subject = 'bnet-banned1'")).account_id);
  const ban = await t.client({ ip: '192.0.2.200' }).post(`/api/admin/moderation/accounts/${bid}/ban`, { kind: 'temporary', days: 3, reason: 'Fixture ban for the appeal test' }, admin);
  assert.equal(ban.status, 200, JSON.stringify(ban.json));
  await oauth(banned, 'battlenet', 'banned1');
  assert.equal((await banned.get('/api/session')).json.stage, 'banned');
});

/** What every switch must leave working: public pages and their APIs answer, never with a 500. */
async function publicStillWorks(id) {
  const c = t.client({ ip: '203.0.113.50' });
  for (const path of ['/api/session', `/api/characters/${CHAR.slug}`, `/api/characters/${CHAR.slug}/collections`, `/api/guilds/${GUILD.slug}`,
    `/api/guilds/${GUILD.slug}/fetch-all`, '/api/gold-boards', '/api/leaderboards', '/api/beta', '/api/users/featowner', '/api/providers']) {
    const r = await c.get(path);
    assert.ok(r.status < 500, `${id} off: GET ${path} answered ${r.status} ${r.text.slice(0, 200)}`);
  }
  for (const who of [owner, banned]) assert.equal((await who.get('/api/session')).status, 200);
  const { linkPreviewFor } = await import('../cards/meta.js');
  for (const path of [`/c/${CHAR.slug}`, `/c/${CHAR.slug}/collections`, `/g/${GUILD.slug}`, '/']) {
    const p = await linkPreviewFor(t.db, path, {});
    assert.ok(p.title, `${id} off: ${path} still has a preview title`);
  }
}

const offCode = (r) => {
  assert.equal(r.status, 503, r.text);
  assert.equal(r.json.code, 'feature_off');
  assert.match(r.json.error, /switched off for now|closed for now/);
};

/** The declared fallback of each feature, checked while it is off. Every feature in the registry needs one. */
const CHECKS = {
  async renders() {
    const ch = (await t.client().get(`/api/characters/${CHAR.slug}`)).json.character;
    assert.equal(ch.media.state, 'paused');
    assert.equal(ch.media.render, null);
    // As the old renders setting did: the share-card image cache was cleared, and that was logged.
    assert.ok(await t.db.one("SELECT 1 AS x FROM admin_events WHERE type = 'cards.cache_cleared' AND detail->>'reason' = 'renders.show'"));
  },
  async 'share-cards'() {
    const c = t.client({ ip: '203.0.113.51' });
    offCode(await c.get(`/api/cards/maker?type=character&c=${CHAR.slug}`));
    offCode(await c.get(`/card.png?type=character&c=${CHAR.slug}`));
    offCode(await c.get(`/og/c/${CHAR.slug}.png`));
    offCode(await c.get(`/og/g/${GUILD.slug}.png`));
    offCode(await owner.put('/api/cards/default', { type: 'character', subject: { c: CHAR.slug }, options: {} }));
    const { linkPreviewFor } = await import('../cards/meta.js');
    const p = await linkPreviewFor(t.db, `/c/${CHAR.slug}`, {});
    assert.equal(p.image, null); // the plain Everstats link preview
    assert.match(p.title, /Ada Fixture/);
  },
  async beta() {
    const s = (await t.client().get('/api/session')).json;
    assert.equal(s.beta.open, false);
    assert.equal(s.features.beta, false);
    assert.equal((await t.client().get('/api/beta')).status, 200); // /beta thanks everyone and lists the perks
  },
  async collections() {
    const c = t.client({ ip: '203.0.113.52' });
    const tab = (await c.get(`/api/characters/${CHAR.slug}/collections`)).json;
    assert.equal(tab.status, 'off');
    assert.match(tab.message, /switched off for now/);
    offCode(await c.post(`/api/characters/${CHAR.slug}/collections/refresh`));
    offCode(await c.get(`/api/characters/${CHAR.slug}/collections/mounts`));
    offCode(await c.get(`/og/k/${CHAR.slug}.png`)); // its share card goes with it
    const { queueCollections, fetchCollections } = await import('../collections/fetch.js');
    await t.db.query("DELETE FROM crawl_queue WHERE kind = 'collections'");
    assert.equal(await queueCollections(t.db, CHAR.slug, PRIORITY.lookup), null);
    assert.equal(await t.db.one("SELECT 1 AS x FROM crawl_queue WHERE kind = 'collections'"), null);
    const mark = calls.length;
    assert.match(await fetchCollections({ db: t.db, client: null }, { key: CHAR.slug, priority: PRIORITY.daily }), /switched off/);
    assert.equal(calls.length, mark); // an item queued before the switch asks Blizzard nothing
    const { runBackfill } = await import('../collections/backfill.js');
    assert.match(await runBackfill(t.db), /Collections are switched off/);
  },
  async 'collections-backfill'() {
    const { runBackfill } = await import('../collections/backfill.js');
    assert.equal(await runBackfill(t.db), 'Off');
  },
  async gold() {
    const mark = calls.length;
    await oauth(owner, 'battlenet', 'owner'); // a Battle.net sign-in: the character list is read, gold is not
    assert.equal(since(mark, /protected-character/), 0);
    assert.ok(since(mark, /^\/profile\/user\/wow$/) >= 1);
    const boards = (await t.client().get('/api/gold-boards?ruleset=2')).json;
    assert.equal(boards.off, true);
    assert.match(boards.message, /switched off for now/);
    offCode(await t.client().get('/api/gold-boards/2/money'));
    offCode(await owner.put(`/api/account/characters/${CHAR.id}/gold-public`, { public: true }));
    const mine = (await owner.get('/api/account/gold')).json;
    assert.deepEqual(mine.characters, []);
  },
  async 'guild-fetch'() {
    const c = t.client({ ip: '203.0.113.53' });
    assert.equal((await c.get(`/api/guilds/${GUILD.slug}/fetch-all`)).json.switchedOff, true);
    offCode(await c.post(`/api/guilds/${GUILD.slug}/fetch-all/roster`));
    offCode(await c.post(`/api/guilds/${GUILD.slug}/fetch-all/start`));
  },
  async 'roster-seed'() {
    const { getSetting } = await import('../admin/settings.js');
    assert.equal(await getSetting(t.db, 'crawler.rosterExpansion'), false); // crawler/fetch.js reads rosters, queues no members
  },
  async crawl() {
    const { getSetting } = await import('../admin/settings.js');
    assert.equal(await getSetting(t.db, 'crawler.paused'), true);
    const { runBackfill } = await import('../collections/backfill.js');
    assert.equal(await runBackfill(t.db), 'Paused with the crawler');
    // A lookup still works: a person is waiting on it.
    assert.equal((await t.client({ ip: '203.0.113.54' }).get(`/api/characters/${CHAR.slug}`)).status, 200);
  },
  async discord() {
    const c = t.client({ ip: '203.0.113.55' });
    const s = (await c.get('/api/session')).json;
    const p = s.providers.find((x) => x.id === 'discord');
    assert.equal(p.configured, true);
    assert.equal(p.switchedOff, true);
    assert.equal(s.providers.find((x) => x.id === 'battlenet').switchedOff, false);
    offCode(await c.post('/api/auth/discord/start', { intent: 'sign_in' }));
    offCode(await owner.post('/api/auth/discord/start', { intent: 'link' }));
    assert.equal((await c.post('/api/auth/battlenet/start', { intent: 'sign_in' })).status, 200); // every other way in still works
    assert.equal((await owner.get('/api/session')).json.signedIn, true); // nobody signed out
  },
  async feedback() {
    const c = t.client({ ip: '203.0.113.56' });
    const r = await c.post('/api/feedback', { type: 'bug', message: 'Another fixture message here', page: '/' });
    offCode(r);
    assert.match(r.json.error, /closed for now/);
    // A ban appeal and a reply in an existing thread still work.
    const appeal = await banned.post('/api/banned/appeal', { message: 'Please reconsider this fixture ban.' });
    assert.equal(appeal.status, 200, appeal.text);
    const reply = await owner.post(`/api/account/feedback/${threadId}/reply`, { message: 'A reply while the form is closed' });
    assert.equal(reply.status, 200, reply.text);
  },
  async reports() {
    const before = (await t.db.one('SELECT count(*)::int AS n FROM reports')).n;
    const c = t.client({ ip: '203.0.113.57' });
    offCode(await c.post('/api/users/featowner/report', { what: 'bio', note: '' }));
    offCode(await c.post(`/api/guilds/${GUILD.slug}/report`, { note: '' }));
    const link = await t.db.one('SELECT id FROM guild_links WHERE guild_id = $1', [GUILD.id]);
    offCode(await c.post(`/api/guilds/${GUILD.slug}/links/${link.id}/report`, { note: '' }));
    assert.equal((await t.db.one('SELECT count(*)::int AS n FROM reports')).n, before);
  },
  async moderators() {
    const { getSetting } = await import('../admin/settings.js');
    assert.equal(await getSetting(t.db, 'moderation.moderators'), false);
  },
  async 'dev-gate'() {
    // Exists on the dev site only (featuresHere): never reached in a local test.
  },
};

test('every feature in the registry: turned off on its own, the public site keeps working and shows its fallback', async () => {
  const { featuresHere } = await import('../features/registry.js');
  for (const f of featuresHere()) {
    if (f.store.version) continue; // read-only here: the next test
    assert.ok(CHECKS[f.id], `features.test.js has no fallback check for the feature '${f.id}': add one`);
    const wasOn = (await features()).find((x) => x.id === f.id).on;
    assert.equal(wasOn, f.id !== 'moderators', `${f.id} starts in its default state`);
    if (wasOn) await flip(f.id, false);
    const s = (await t.client({ ip: '203.0.113.58' }).get('/api/session')).json;
    if (f.playerVisible) assert.equal(s.features[f.id], false, `${f.id} off in /api/session`);
    else assert.equal(s.features[f.id], undefined, `${f.id} is admin-only: not in /api/session`);
    await publicStillWorks(f.id);
    await CHECKS[f.id]();
    if (wasOn) await flip(f.id, true);
    assert.equal((await features()).find((x) => x.id === f.id).on, wasOn, `${f.id} back as it was`);
  }
  // With everything back on, the fallbacks are gone again.
  const tab = (await t.client({ ip: '203.0.113.59' }).get(`/api/characters/${CHAR.slug}/collections`)).json;
  assert.equal(tab.status, 'ok');
  const { linkPreviewFor } = await import('../cards/meta.js');
  assert.ok((await linkPreviewFor(t.db, `/c/${CHAR.slug}`, {})).image);
});

test('game versions: the primary is locked on, a version that isn’t built is locked off, a BUILT one is a real switch (0.11.1), off by default', async () => {
  const gv = await import('../core/gameVersions.js');
  const { GAME_VERSIONS, PRIMARY_VERSION } = gv;
  for (const v of GAME_VERSIONS.filter((x) => !x.switchable)) {
    const r = await put(`version-${v.id}`, { on: v.id !== PRIMARY_VERSION.id, reason: 'test: versions are locked' });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'locked');
  }
  let list = await features();
  assert.equal(list.find((f) => f.id === `version-${PRIMARY_VERSION.id}`).locked, 'primary');
  const built = GAME_VERSIONS.filter((x) => x.switchable);
  assert.deepEqual(built.map((v) => v.id), ['retail'], 'World of Warcraft is the one built version besides the primary');
  for (const v of built) {
    const card = list.find((f) => f.id === `version-${v.id}`);
    assert.deepEqual([card.on, card.locked, card.settingKey], [false, null, `versions.${v.id}`], 'off until the admin turns it on');
    assert.equal(gv.isVersionEnabled(v.id), false);
    // Off: its pages and its API don't exist, and the session lists only the primary version.
    assert.equal((await t.client().get(`/api/v/${v.id}/us/coverage`)).status, 404);
    assert.equal((await t.client().get(`/${v.id}/us/leaderboards`)).status, 404);
    assert.deepEqual((await t.client().get('/api/session')).json.versions.list.map((x) => x.id), [PRIMARY_VERSION.id]);
    assert.equal((await put(`version-${v.id}`, { on: true })).json.code, 'reason_required');
    const on = await put(`version-${v.id}`, { on: true, reason: 'test: switching the version on' });
    assert.equal(on.status, 200);
    assert.equal(gv.isVersionEnabled(v.id), true, 'this process knows at once');
    const cov = await t.client().get(`/api/v/${v.id}/us/coverage`);
    assert.equal(cov.status, 200);
    assert.equal(cov.json.scope.version, v.id);
    assert.deepEqual((await t.client().get('/api/session')).json.versions.list.map((x) => x.id), [PRIMARY_VERSION.id, v.id]);
    list = await features();
    assert.equal(list.find((f) => f.id === `version-${v.id}`).on, true);
    // The change is in the audit log as this feature, with its reason.
    const logged = await t.db.one("SELECT detail FROM admin_events WHERE type = 'setting.changed' AND detail->>'key' = $1 ORDER BY id DESC LIMIT 1", [`versions.${v.id}`]);
    assert.deepEqual([logged.detail.before, logged.detail.value, logged.detail.reason], [false, true, 'test: switching the version on']);
    const off = await put(`version-${v.id}`, { on: false, reason: 'test: and off again' });
    assert.equal(off.status, 200);
    assert.equal(gv.isVersionEnabled(v.id), false);
    assert.equal((await t.client().get(`/api/v/${v.id}/us/coverage`)).status, 404);
  }
});

test('a reason is required; turning off a feature others need asks first (409 with the list), then works', async () => {
  const none = await put('crawl', { on: false });
  assert.equal(none.status, 400);
  assert.equal(none.json.code, 'reason_required');
  const short = await put('crawl', { on: false, reason: ' x ' });
  assert.equal(short.status, 400);
  const asked = await put('crawl', { on: false, reason: 'Blizzard maintenance tonight' });
  assert.equal(asked.status, 409);
  assert.equal(asked.json.code, 'has_dependents');
  assert.deepEqual([...asked.json.affected].sort(), ['collections-backfill', 'guild-fetch', 'roster-seed']);
  assert.equal((await features()).find((f) => f.id === 'crawl').on, true); // nothing changed yet
  const done = await put('crawl', { on: false, reason: 'Blizzard maintenance tonight', confirmDependents: true });
  assert.equal(done.status, 200);
  const crawl = done.json.features.find((f) => f.id === 'crawl');
  assert.equal(crawl.on, false);
  assert.equal(crawl.changedReason, 'Blizzard maintenance tonight');
  const seed = done.json.features.find((f) => f.id === 'roster-seed');
  assert.equal(seed.on, true);
  assert.equal(seed.working, false);
  assert.deepEqual(seed.blockedBy, ['crawl']);
  await flip('crawl', true);
});

test('the audit log shows each switch with before → after and the reason', async () => {
  await flip('reports', false);
  await put('reports', { on: true, reason: 'Back on after the test' });
  const log = await t.client({ ip: '192.0.2.200' }).get('/api/admin/audit?area=features', admin);
  assert.equal(log.status, 200, log.text);
  const reports = log.json.entries.filter((e) => e.target?.id === 'reports');
  assert.ok(reports.length >= 2);
  const [on, off] = reports; // newest first
  assert.equal(on.action, 'Player reports turned on');
  assert.equal(on.before, false);
  assert.equal(on.after, true);
  assert.equal(on.reason, 'Back on after the test');
  assert.equal(off.action, 'Player reports turned off');
  assert.equal(off.before, true);
  assert.equal(off.after, false);
  assert.equal(off.reason, 'test: reports off');
  // The beta window logs through its own event, with the reason too.
  const betaLog = await t.client({ ip: '192.0.2.200' }).get('/api/admin/audit?q=beta.changed', admin);
  const beta = betaLog.json.entries.filter((e) => e.target?.id === 'beta');
  assert.ok(beta.some((e) => e.reason === 'test: beta off' && e.after === false && e.before === true));
});

test('Discord switched off after a round trip started: the callback ends it without asking Discord or making an account', async () => {
  const c = t.client({ ip: '198.51.100.30' });
  const start = await c.post('/api/auth/discord/start', { intent: 'sign_in' });
  assert.equal(start.status, 200);
  await flip('discord', false);
  const mark = calls.length;
  const accounts = (await t.db.one('SELECT count(*)::int AS n FROM accounts')).n;
  const cb = await c.get(`/auth/discord/callback?code=late1&state=${new URL(start.json.url).searchParams.get('state')}`);
  assert.equal(cb.status, 303);
  assert.equal(cb.headers.get('location'), '/sign-in?error=switched_off');
  assert.equal(since(mark, /oauth2|users/), 0);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM accounts')).n, accounts);
  await flip('discord', true);
});
