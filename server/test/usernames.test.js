import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as OTPAuth from 'otpauth';
import { startApp } from './helpers.js';

// A fake Battle.net and Discord (the code IS the person), as in auth.test.js. Fixture names only.
const API = 'https://us.api.blizzard.com';
const calls = [];
const accounts = new Map();
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  calls.push(u.pathname);
  const auth = String(opts.headers?.Authorization ?? '');
  if (u.href === 'https://oauth.battle.net/token' || u.href === 'https://discord.com/api/oauth2/token') {
    const b = new URLSearchParams(String(opts.body));
    return json(200, { access_token: b.get('grant_type') === 'client_credentials' ? 'app' : `tok-${b.get('code')}` });
  }
  const who = auth.replace('Bearer tok-', '');
  if (u.href === 'https://oauth.battle.net/userinfo') return json(200, { sub: `bnet-${who}`, battletag: `Secret${who}#1234` });
  if (u.href === 'https://discord.com/api/users/@me') return json(200, { id: `10000000000000${who.replace(/\D/g, '').padStart(4, '0')}`, username: `discord_${who}` });
  if (u.pathname === '/profile/user/wow') return accounts.has(who) ? json(200, { wow_accounts: [{ id: 1, characters: accounts.get(who) }] }) : json(404, {});
  if (u.pathname.startsWith('/data/wow/media/item/')) {
    const id = u.pathname.split('/').pop();
    return json(200, { assets: [{ key: 'icon', value: `https://render.worldofwarcraft.com/classic-us/icons/56/fixture_${id}.jpg` }], id: Number(id) });
  }
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  if (m && ['zeta-fixture', 'kappa-fixture'].includes(m[1])) {
    const id = m[1] === 'zeta-fixture' ? 501 : 502;
    const sub = m[2] ?? '';
    if (sub === '') return json(200, { _links: { self: { href: `${API}/profile/wow/character/${m[1]}` } }, id, name: m[1].split('-')[0], surname: 'Fixture', level: 20, ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000 });
    if (sub === '/achievements/statistics') return json(200, { categories: [{ id: 130, name: 'Character', statistics: [{ id: 64222, name: 'Times camped', quantity: 3 }] }] });
    if (sub === '/equipment') {
      return json(200, { equipped_items: [
        { item: { id: 7997 }, media: { key: { href: `${API}/data/wow/media/item/7997?namespace=static-1.60.1_70399-forever-us` }, id: 7997 }, slot: { type: 'HEAD', name: 'Head' }, name: 'Fixture Mask', quality: { type: 'POOR' }, level: { value: 15 }, binding: { name: 'Binds when picked up' }, stats: [{ type: { type: 'AGILITY' }, value: 2, display: { display_string: '+2 Agility', color: { r: 255, g: 255, b: 255 } } }] },
        { item: { id: 8001 }, media: { key: { href: `${API}/data/wow/media/item/8001?namespace=static-1.60.1_70399-forever-us` }, id: 8001 }, slot: { type: 'CHEST', name: 'Chest' }, name: 'Fixture Tunic', quality: { type: 'RARE' }, level: { value: 24 } },
      ] });
    }
    if (sub === '/statistics') return json(200, { health: 100 });
    if (sub === '/character-media') return json(404, {});
  }
  return json(404, {});
}

let t;
let crawler;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  const { createCrawler } = await import('../crawler/service.js');
  crawler = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await crawler.start();
});
after(async () => {
  await crawler.stop();
  await t.close();
});

async function oauth(c, provider, code, intent = 'sign_in') {
  const start = await c.post(`/api/auth/${provider}/start`, { intent });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const cb = await c.get(`/auth/${provider}/callback?code=${code}&state=${new URL(start.json.url).searchParams.get('state')}`);
  return cb.headers.get('location');
}
const adminHeaders = async () => {
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};
const settle = async () => {
  for (let i = 0; i < 100; i++) {
    if ((await t.db.one("SELECT count(*)::int AS n FROM crawl_queue WHERE state IN ('queued', 'running')")).n === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
};

test('username rules: shape, placeholders, reserved names with lookalikes, blocked stems, profanity', async () => {
  const { checkUsername, checkDisplayName, RESERVED_SEED, normalForms } = await import('../accounts/names.js');
  const reserved = new Set(Object.values(RESERVED_SEED).flat().flatMap(normalForms));
  const ok = (n) => checkUsername(n, reserved).ok;
  const why = (n) => checkUsername(n, reserved).reason;
  assert.equal(ok('galewhisper'), true);
  assert.equal(ok('path'), true);
  assert.equal(ok('Path_V-2'), true); // stored lower case
  for (const bad of ['ab', 'a'.repeat(21), '9lives', 'a--b', 'a-_b', 'abc_', 'ab-', 'ab c', 'héros']) assert.equal(why(bad), 'format', bad);
  assert.equal(why('user-7k2f9q'), 'placeholder');
  assert.equal(ok('0fficial'), false); // refused already: a username starts with a letter
  for (const r of ['blizzard', 'b1izzard', 'bl-izzard', 'the0fficial', 'm0derat0r', 'everstats', 'raider-io', 'raiderio', 'wowhead', 'meownet']) assert.equal(why(r), 'reserved', r);
  for (const r of ['notanadmin', 'thestaffer', 'blizzardfan', 'sup-port-team']) assert.equal(why(r), 'reserved', r);
  assert.equal(why('fuckface'), 'not_allowed');
  assert.equal(why('sh1thead'), 'not_allowed');
  assert.equal(ok('classicgamer'), true); // "ass" is only refused as a whole name
  assert.equal(checkUsername('blizzard', reserved).message, 'That name is reserved.'); // never which entry
  // Display names: free text, duplicates fine, no speaking for a company.
  const display = new Set([...RESERVED_SEED.everstats, ...RESERVED_SEED.companies, ...RESERVED_SEED.community].flatMap(normalForms));
  assert.equal(checkDisplayName('Path the Healer', display).ok, true);
  assert.equal(checkDisplayName('Support Main', display).ok, true);
  assert.equal(checkDisplayName('Blizzard Support', display).ok, false);
  assert.equal(checkDisplayName('Ever Stats', display).ok, false);
  assert.equal(checkDisplayName('@someone', display).ok, false);
  assert.equal(checkDisplayName('a‮b', display).ok, false);
  assert.equal(checkDisplayName('x'.repeat(33), display).ok, false);
});

test('a new account gets a placeholder and a prompt on every sign-in until it claims a name', async () => {
  const c = t.client({ ip: '198.51.100.40' });
  await oauth(c, 'battlenet', 'u1');
  const s = (await c.get('/api/session')).json.user;
  assert.match(s.username, /^user-[a-z0-9]{6}$/);
  assert.equal(s.claimed, false);
  assert.equal(s.displayName, null); // never the BattleTag
  assert.equal(s.promptUsername, true);
  await c.post('/api/account/username/prompt-dismiss');
  assert.equal((await c.get('/api/session')).json.user.promptUsername, false);
  const again = t.client({ ip: '198.51.100.40' });
  await oauth(again, 'battlenet', 'u1');
  assert.equal((await again.get('/api/session')).json.user.promptUsername, true);
  // A placeholder has no profile.
  const res = await t.client().get(`/api/users/${s.username}`);
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'placeholder');
});

test('claiming is free; a rename uses the allowance; the old name is held 30 days and redirects', async () => {
  accounts.set('u2', [{ character: { href: `${API}/profile/wow/character/zeta-fixture` }, id: 501, name: 'Zeta', surname: 'Fixture', level: 20 }]);
  const c = t.client({ ip: '198.51.100.41' });
  await oauth(c, 'battlenet', 'u2');
  await settle();
  const avail = (await c.get('/api/account/username/check?name=pathfinder')).json;
  assert.deepEqual(avail, { ok: true, name: 'pathfinder' });
  let a = (await c.put('/api/account/username', { username: 'PathFinder' })).json.account;
  assert.deepEqual([a.username, a.usernameClaimed, a.renamesLeft, a.displayName], ['pathfinder', true, 1, 'pathfinder']);
  // Another player can't take it, and is told why in plain words.
  const other = t.client({ ip: '198.51.100.42' });
  await oauth(other, 'discord', 'u3');
  assert.equal((await other.get('/api/account/username/check?name=pathfinder')).json.message, 'That name is taken.');
  assert.equal((await other.get('/api/account/username/check?name=b1izzard')).json.message, 'That name is reserved.');

  a = (await c.put('/api/account/username', { username: 'pathseeker' })).json.account;
  assert.deepEqual([a.username, a.renamesLeft], ['pathseeker', 0]);
  assert.deepEqual((await t.client().get('/api/users/pathfinder')).json, { status: 'moved', username: 'pathseeker' });
  assert.equal((await other.put('/api/account/username', { username: 'pathfinder' })).status, 409); // held
  const none = await c.put('/api/account/username', { username: 'pathwalker' });
  assert.equal(none.status, 409);
  assert.equal(none.json.error, 'Renames aren’t available on your account right now.');

  const profile = (await t.client().get('/api/users/pathseeker')).json;
  assert.equal(profile.profile.displayName, 'pathseeker');
  assert.equal(profile.profile.beta.since !== null, true);
  assert.equal(profile.sections.find((x) => x.id === 'featured').character.name, 'zeta');
  // Character pages say who claimed them, by @username only (0.7.0: plus that player's one inline badge, here the
  // Beta Tester badge this account earned at sign-in during the open beta).
  const claimed = (await t.client({ ip: '198.51.100.43' }).get('/api/characters/zeta-fixture')).json.character.claimedBy;
  assert.deepEqual(Object.keys(claimed).sort(), ['badge', 'username']);
  assert.equal(claimed.username, 'pathseeker');
  assert.equal(claimed.badge.id, 'beta-tester');
});

test('availability checks are rate limited per account (and per network), so names can’t be walked', async () => {
  const c = t.client({ ip: '198.51.100.50' });
  await oauth(c, 'discord', 'u4');
  let last;
  for (let i = 0; i < 31; i++) last = await c.get(`/api/account/username/check?name=probe${i}x`);
  assert.equal(last.status, 429);
  // Signed out, there is no check at all.
  assert.equal((await t.client().get('/api/account/username/check?name=abc')).status, 401);
});

test('after a rename and an admin reclaim, sign-in, 2FA, linking, ownership, pins and beta membership are untouched', async () => {
  const c = t.client({ ip: '198.51.100.60' });
  await oauth(c, 'battlenet', 'u2'); // pathseeker
  const before = (await c.get('/api/account')).json.account;
  // 2FA on, a pin, Discord linked.
  const setup = (await c.post('/api/account/2fa/setup')).json.setup;
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30, algorithm: 'SHA1' });
  assert.equal((await c.post('/api/account/2fa/enable', { code: totp.generate() })).status, 200);
  await c.put('/api/account/pins', { statisticIds: [64222] });
  assert.equal(await oauth(c, 'discord', 'u5', 'link'), '/settings?linked=discord');

  const h = await adminHeaders();
  const admin = t.client({ ip: '198.51.100.61' });
  const reclaimed = (await admin.post(`/api/admin/players/${before.id}/reclaim`, { note: 'test' }, h)).json.player;
  assert.equal(reclaimed.claimed, false);
  assert.equal(reclaimed.renamesLeft, 0); // a reclaim never costs a rename
  assert.deepEqual(reclaimed.history.map((x) => x.kind), ['reclaim', 'rename', 'claim']);
  assert.equal((await t.client().get('/api/users/pathseeker')).status, 404); // no redirect for a reclaimed name

  // Signing in again (Battle.net, then the 2FA code; and Discord) reaches the SAME account, with everything intact.
  const again = t.client({ ip: '198.51.100.62' });
  assert.match(await oauth(again, 'battlenet', 'u2'), /^\/sign-in\/2fa/);
  await new Promise((r) => setTimeout(r, 1100)); // a fresh 30 s step isn't guaranteed; the counter refuses replays
  const code = totp.generate({ timestamp: Date.now() + 30_000 });
  assert.equal((await again.post('/api/auth/second-factor', { code })).status, 200);
  const after1 = (await again.get('/api/account')).json.account;
  assert.equal(after1.id, before.id);
  assert.equal(after1.twoFactor.state, 'on');
  assert.deepEqual(after1.identities.map((i) => i.provider).sort(), ['battlenet', 'discord']);
  assert.deepEqual(after1.beta, before.beta);
  assert.deepEqual(after1.characters.map((x) => x.id), [501]);
  assert.deepEqual((await again.get('/api/account/pins')).json.pinIds, [64222]);
  assert.equal((await again.get('/api/session')).json.user.promptUsername, true); // asked to choose again
  const viaDiscord = t.client({ ip: '198.51.100.63' });
  await oauth(viaDiscord, 'discord', 'u5');
  assert.equal((await viaDiscord.get('/api/session')).json.stage, 'second_factor'); // same account, same 2FA

  // The admin can grant a reserved name to a verified partner; it is still refused to everyone else.
  const granted = (await admin.post(`/api/admin/players/${before.id}/grant`, { username: 'raiderio', note: 'partner' }, h)).json.player;
  assert.equal(granted.username, 'raiderio');
  assert.equal((await admin.put(`/api/admin/players/${before.id}/allowance`, { value: 3 }, h)).json.player.renamesLeft, 3);
});

test('merging keeps the kept account’s name, or gives it the merged one’s if it had none', async () => {
  const { mergeAccounts } = await import('../account/merge.js');
  const a = t.client({ ip: '198.51.100.70' });
  await oauth(a, 'discord', 'm1');
  await a.put('/api/account/username', { username: 'mergesource' });
  const b = t.client({ ip: '198.51.100.71' });
  await oauth(b, 'discord', 'm2');
  const [src, dst] = [(await a.get('/api/account')).json.account.id, (await b.get('/api/account')).json.account.id];
  await t.db.tx((q) => mergeAccounts(q, src, dst));
  const kept = await t.db.one('SELECT username, username_claimed FROM accounts WHERE id = $1', [dst]);
  assert.deepEqual(kept, { username: 'mergesource', username_claimed: true });
});

test('TRUSTED_PROXIES is checked against the container’s own networks', async () => {
  const { trustedProxyCheck } = await import('../core/network.js');
  const ifaces = { eth0: [{ address: '10.213.47.3', cidr: '10.213.47.3/24', family: 'IPv4', internal: false }], lo: [{ address: '127.0.0.1', cidr: '127.0.0.1/8', family: 'IPv4', internal: true }] };
  assert.equal(trustedProxyCheck('10.213.47.1', ifaces).state, 'ok');
  assert.equal(trustedProxyCheck('172.27.0.1', ifaces).state, 'outside');
  assert.equal(trustedProxyCheck('', ifaces).state, 'unset');
});

test('icons: fetched once per item for the first character, never again for the next one wearing it', async () => {
  const c = t.client({ ip: '198.51.100.80' });
  await settle();
  const first = (await t.db.query('SELECT item_id, state, icon_url FROM item_media ORDER BY item_id')).map((r) => [r.item_id, r.state]);
  assert.deepEqual(first, [[7997, 'ok'], [8001, 'ok']]); // zeta's lookup earlier queued them
  const mark = calls.length;
  const res = (await c.get('/api/characters/kappa-fixture')).json; // same two items
  await settle();
  const media = calls.slice(mark).filter((p) => p.startsWith('/data/wow/media/item/')).length;
  assert.equal(media, 0);
  const head = res.character.equipment.find((i) => i.slot === 'HEAD');
  assert.equal(head.icon, 'https://render.worldofwarcraft.com/classic-us/icons/56/fixture_7997.jpg');
  assert.deepEqual(head.tooltip, { binding: 'Binds when picked up', stats: [{ text: '+2 Agility', green: false }] }); // only what Blizzard sent
  assert.equal(head.mediaHref, undefined);
});
