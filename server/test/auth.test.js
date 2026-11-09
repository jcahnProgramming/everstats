import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as OTPAuth from 'otpauth';
import { startApp } from './helpers.js';

// A fake Battle.net and Discord: the authorization code IS the person ("p1", "p2"…), the token carries it through,
// and the identity endpoints answer with a stable id for it. Nothing leaves the machine.
const fakeFetch = async (url, opts = {}) => {
  const u = String(url);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://discord.com/api/oauth2/token' || u === 'https://oauth.battle.net/token') {
    const code = new URLSearchParams(String(opts.body)).get('code');
    if (code === 'refused') return reply(400, { error: 'invalid_grant' });
    return reply(200, { access_token: `tok-${code}`, token_type: 'bearer' });
  }
  const who = String(opts.headers?.Authorization ?? '').replace('Bearer tok-', '');
  if (u === 'https://discord.com/api/users/@me') return reply(200, { id: `1000000000000${who.replace(/\D/g, '').padStart(5, '0')}`, username: `discord_${who}` });
  if (u === 'https://oauth.battle.net/userinfo') return reply(200, { sub: `bnet-${who}`, id: 1, battletag: `Player${who}#1234` });
  return reply(404, {});
};

let t;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
});
after(() => t.close());

async function configure(provider) {
  const { saveCredential } = await import('../credentials/store.js');
  const values = provider === 'discord'
    ? { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' }
    : { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' };
  await saveCredential(t.db, provider === 'discord' ? 'discord' : 'blizzard', values);
}

/** Runs a whole OAuth round trip for `client` as person `code`. Returns the callback's redirect target. */
async function oauth(client, provider, code, intent = 'sign_in') {
  const start = await client.post(`/api/auth/${provider}/start`, { intent });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const state = new URL(start.json.url).searchParams.get('state');
  const cb = await client.get(`/auth/${provider}/callback?code=${code}&state=${state}`);
  assert.equal(cb.status, 303);
  return cb.headers.get('location');
}

const accountOf = async (client) => (await client.get('/api/account')).json?.account ?? null;

test('sign-in is honestly "not configured" until keys exist', async () => {
  const c = t.client();
  const providers = (await c.get('/api/session')).json.providers;
  assert.deepEqual(providers.map((p) => [p.id, p.configured]), [['battlenet', false], ['discord', false]]);
  const res = await c.post('/api/auth/discord/start', {});
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'not_configured');
  await configure('discord');
  await configure('battlenet');
  assert.ok((await c.get('/api/session')).json.providers.every((p) => p.configured));
});

test('first sign-in creates an account; signing in again finds it', async () => {
  const c = t.client();
  assert.equal(await oauth(c, 'discord', 'p1'), '/');
  const a = await accountOf(c);
  assert.ok(a);
  assert.equal(a.identities[0].provider, 'discord');
  assert.equal(a.identities[0].displayName, 'discord_p1');

  const again = t.client();
  await oauth(again, 'discord', 'p1');
  assert.equal((await accountOf(again)).id, a.id);
});

test('a callback with the wrong state, or from another browser, signs nobody in', async () => {
  const c = t.client();
  await c.post('/api/auth/discord/start', {});
  const bad = await c.get('/auth/discord/callback?code=p9&state=wrong');
  assert.equal(bad.headers.get('location'), '/sign-in?error=state_mismatch');
  assert.equal(await accountOf(c), null);

  const victim = t.client();
  const start = await t.client().post('/api/auth/discord/start', {});
  const state = new URL(start.json.url).searchParams.get('state');
  const stolen = await victim.get(`/auth/discord/callback?code=p9&state=${state}`);
  assert.equal(stolen.headers.get('location'), '/sign-in?error=expired');
});

test('a fresh sign-in with an unlinked provider makes a SEPARATE account (never auto-linked)', async () => {
  const c = t.client();
  await oauth(c, 'battlenet', 'p1'); // same person "p1", but Battle.net is not linked to their Discord account
  const bnetAccount = await accountOf(c);
  const discordClient = t.client();
  await oauth(discordClient, 'discord', 'p1');
  assert.notEqual(bnetAccount.id, (await accountOf(discordClient)).id);
});

test('linking from Settings adds a provider; an identity linked elsewhere is refused', async () => {
  const c = t.client();
  await oauth(c, 'discord', 'p2');
  assert.equal(await oauth(c, 'battlenet', 'p2', 'link'), '/settings?linked=battlenet');
  const a = await accountOf(c);
  assert.deepEqual(a.identities.map((i) => i.provider).sort(), ['battlenet', 'discord']);

  // Battle.net "p1" already has its own account (previous test): linking it here is refused, not moved.
  assert.equal(await oauth(c, 'battlenet', 'p1', 'link'), '/settings?error=linked_elsewhere');

  // Signed out, a link can't even start.
  const res = await t.client().post('/api/auth/battlenet/start', { intent: 'link' });
  assert.equal(res.status, 401);
});

test('the last way into an account cannot be removed', async () => {
  const c = t.client();
  await oauth(c, 'discord', 'p3');
  const a = await accountOf(c);
  const res = await c.del(`/api/account/identities/${a.identities[0].id}`);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'last_method');
});

test('merge: prove the other account, confirm, and the signed-in one folds into it', async () => {
  const keep = t.client();
  await oauth(keep, 'battlenet', 'p4');
  const keepId = (await accountOf(keep)).id;

  const mistake = t.client();
  await oauth(mistake, 'discord', 'p4');
  const mistakeId = (await accountOf(mistake)).id;

  assert.equal(await oauth(mistake, 'battlenet', 'p4', 'merge'), '/settings/merge');
  const proposal = (await mistake.get('/api/account/merge')).json.merge;
  assert.equal(proposal.target.id, keepId);
  assert.equal(proposal.needsCode, false);

  const done = await mistake.post('/api/account/merge/confirm', {});
  assert.equal(done.status, 200);
  const merged = await accountOf(mistake);
  assert.equal(merged.id, keepId);
  assert.deepEqual(merged.identities.map((i) => i.provider).sort(), ['battlenet', 'discord']);
  assert.equal(await t.db.one('SELECT id FROM accounts WHERE id = $1', [mistakeId]), null);

  // Merging into an identity nobody has is refused (it never creates an account).
  const lone = t.client();
  await oauth(lone, 'discord', 'p5');
  assert.equal(await oauth(lone, 'battlenet', 'p5', 'merge'), '/settings?error=merge_no_account');
});

test('2FA: setup, recovery codes once, asked after a provider sign-in, codes never replay', async () => {
  const c = t.client();
  await oauth(c, 'discord', 'p6');
  const setup = (await c.post('/api/account/2fa/setup', {})).json.setup;
  assert.match(setup.qr, /^data:image\/svg\+xml;base64,/);
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });

  assert.equal((await c.post('/api/account/2fa/enable', { code: '000000' })).status, 400);
  const enabled = await c.post('/api/account/2fa/enable', { code: totp.generate() });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json.recoveryCodes.length, 10);
  assert.equal(enabled.json.account.twoFactor.state, 'on');
  const [recovery] = enabled.json.recoveryCodes;

  // A new sign-in now stops at the code.
  const b = t.client();
  assert.equal(await oauth(b, 'discord', 'p6'), '/sign-in/2fa?next=%2F');
  assert.equal((await b.get('/api/session')).json.stage, 'second_factor');
  assert.equal((await b.get('/api/account')).status, 401);
  assert.equal((await b.get('/api/theme-boot.js')).text.includes("'forever'"), true);

  // The code used to enable can't be replayed; the next step's can.
  assert.equal((await b.post('/api/auth/second-factor', { code: totp.generate() })).status, 401);
  const next = totp.generate({ timestamp: Date.now() + 30_000 });
  assert.equal((await b.post('/api/auth/second-factor', { code: next })).status, 200);
  assert.equal((await b.get('/api/session')).json.signedIn, true);

  // A recovery code works exactly once.
  const r1 = t.client();
  await oauth(r1, 'discord', 'p6');
  assert.equal((await r1.post('/api/auth/second-factor', { code: recovery.toUpperCase() })).status, 200);
  const r2 = t.client();
  await oauth(r2, 'discord', 'p6');
  assert.equal((await r2.post('/api/auth/second-factor', { code: recovery })).status, 401);
  assert.equal((await accountOf(r1)).twoFactor.recoveryCodesLeft, 9);
});

test('wrong 2FA codes are limited per account', async () => {
  const c = t.client({ ip: '198.51.100.50' });
  await oauth(c, 'discord', 'p7');
  const setup = (await c.post('/api/account/2fa/setup', {})).json.setup;
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret) });
  await c.post('/api/account/2fa/enable', { code: totp.generate() });

  let last;
  for (let i = 0; i < 6; i++) {
    const attacker = t.client({ ip: `198.51.100.${60 + i}` });
    await oauth(attacker, 'discord', 'p7');
    last = await attacker.post('/api/auth/second-factor', { code: '123456' });
  }
  assert.equal(last.status, 429);
});

test('themes are an account perk, stored on the account', async () => {
  const c = t.client();
  assert.equal((await c.put('/api/account/theme', { theme: 'horde' })).status, 401);
  await oauth(c, 'discord', 'p8');
  assert.equal((await c.put('/api/account/theme', { theme: 'purple' })).status, 400);
  assert.equal((await c.put('/api/account/theme', { theme: 'horde' })).status, 200);
  assert.match((await c.get('/api/theme-boot.js')).text, /'horde'/);
  // Another device signed in to the same account gets it too.
  const other = t.client();
  await oauth(other, 'discord', 'p8');
  assert.match((await other.get('/api/theme-boot.js')).text, /'horde'/);
  await c.post('/api/auth/sign-out', {});
  assert.match((await c.get('/api/theme-boot.js')).text, /'forever'/);
});

test('a refused token exchange ends on an honest error, not a broken page', async () => {
  const c = t.client();
  assert.equal(await oauth(c, 'discord', 'refused'), '/sign-in?error=provider_failed');
  assert.equal(await accountOf(c), null);
});
