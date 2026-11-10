import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

/**
 * 0.10.3: the dev tester gate. PRODUCTION answers one question (POST /api/internal/dev-tester, devgate/endpoint.js); the
 * DEV site (devgate/gate.js) asks it after sign-in and lets only testers (and its own admin) in. Two apps here: one
 * running as production, one as dev, whose outbound fetch is a fake production.
 */
const { ENVIRONMENTS } = await import('../core/environment.js');
const { newToken, sha256Hex } = await import('../credentials/crypto.js');
const { CACHE_MS } = await import('../devgate/gate.js');

const SECRET = 'test-dev-tester-secret-0123456789abcdef';
const PATH = '/api/internal/dev-tester';
const PROD_URL = `${ENVIRONMENTS.production.origin}${PATH}`;

let prod;
let dev;
let clock = Date.now();
// The fake production the dev app asks: { 'provider:subject': true|false }, or down / a bad status.
const fake = { answers: new Map(), mode: 'answer', calls: [] };
async function fakeProduction(url, init = {}) {
  fake.calls.push({ url, auth: init.headers?.Authorization ?? null, body: init.body ? JSON.parse(init.body) : null });
  if (url !== PROD_URL) throw new Error(`unexpected outbound request to ${url}`);
  if (fake.mode === 'down') throw new TypeError('fetch failed');
  if (fake.mode === 'status') return new Response('{"error":"Not found"}', { status: 404 });
  if (init.headers?.Authorization !== `Bearer ${SECRET}`) return new Response('{"error":"Not found"}', { status: 404 });
  const { provider, subject } = JSON.parse(init.body);
  return Response.json({ tester: fake.answers.get(`${provider}:${subject}`) === true });
}

before(async () => {
  prod = await startApp({ environment: ENVIRONMENTS.production });
  dev = await startApp({ environment: ENVIRONMENTS.dev, fetch: fakeProduction, now: () => clock });
});
after(async () => {
  delete process.env.DEV_TESTER_SECRET;
  await prod?.close();
  await dev?.close();
});

let nextSubject = 100_000_000;
/** A player account on `t` with the given identities ([provider, subject?]); returns { id, subjects, cookie }. */
async function player(t, providers = ['discord']) {
  const id = Number((await t.db.one('INSERT INTO accounts DEFAULT VALUES RETURNING id')).id);
  const subjects = {};
  for (const p of providers) {
    subjects[p] = String(nextSubject++) + '1234567';
    await t.db.query('INSERT INTO account_identities (account_id, provider, subject, display_name) VALUES ($1, $2, $3, $4)', [id, p, subjects[p], 'Fixture']);
  }
  const token = newToken();
  await t.db.query("INSERT INTO sessions (id_hash, account_id, stage, method, expires_at) VALUES ($1, $2, 'full', $3, now() + interval '1 hour')", [sha256Hex(token), id, providers[0] ?? 'passkey']);
  return { id, subjects, cookie: { Cookie: `es_session=${token}` } };
}
async function adminCookie(t) {
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
}
const ask = (body, { secret = SECRET, origin = null, ip = '198.51.100.20' } = {}) =>
  prod.client({ origin, ip }).post(PATH, body, secret === null ? {} : { Authorization: `Bearer ${secret}` });

// ---------------------------------------------------------------- production: the endpoint

let holder;
let adminH;
test('production: the endpoint is a plain 404 until DEV_TESTER_SECRET is set (and when it is too short)', async () => {
  delete process.env.DEV_TESTER_SECRET;
  adminH = await adminCookie(prod);
  holder = await player(prod, ['battlenet', 'discord']);
  for (const secret of [SECRET, null]) {
    const res = await ask({ provider: 'discord', subject: holder.subjects.discord }, { secret });
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
  process.env.DEV_TESTER_SECRET = 'too-short';
  assert.equal((await ask({ provider: 'discord', subject: holder.subjects.discord }, { secret: 'too-short' })).status, 404);
  process.env.DEV_TESTER_SECRET = SECRET;
});

test('production: a wrong or missing secret is the same plain 404 (it doesn’t even say the endpoint exists)', async () => {
  for (const secret of [null, 'wrong-secret-wrong-secret-wrong-secret-x', `${SECRET}x`, SECRET.slice(0, -1)]) {
    const res = await ask({ provider: 'discord', subject: holder.subjects.discord }, { secret });
    assert.equal(res.status, 404, String(secret));
    assert.deepEqual(res.json, { error: 'Not found' });
  }
  const basic = await prod.client({ origin: null }).post(PATH, { provider: 'discord', subject: '1' }, { Authorization: `Basic ${SECRET}` });
  assert.equal(basic.status, 404);
});

test('production: Dev Tester is granted by the admin and starts HIDDEN; the holder can show it; a re-grant keeps their choice', async () => {
  // The definition, as migrations leave a FRESH database (015 seeds every SEED_BADGES row, so 030 must update the
  // dev-tester row it finds, not skip it). Admin-granted only: no automatic rule ever gives it.
  const def = await prod.db.one("SELECT award, rule, shown_by_default, art_temporary FROM badge_definitions WHERE id = 'dev-tester'");
  assert.deepEqual(def, { award: 'manual', rule: null, shown_by_default: false, art_temporary: true });
  const c = prod.client();
  const granted = await c.post(`/api/admin/badges/accounts/${holder.id}/grant`, { badgeId: 'dev-tester', reason: 'Tests the dev site' }, adminH);
  assert.equal(granted.status, 200, granted.text);
  let row = await prod.db.one("SELECT shown, featured, pinned, state FROM badge_awards WHERE account_id = $1 AND badge_id = 'dev-tester'", [holder.id]);
  assert.deepEqual(row, { shown: false, featured: false, pinned: false, state: 'held' });
  // Not on the holder's public profile while hidden.
  await prod.db.query("UPDATE accounts SET username = 'devholder', username_claimed = true WHERE id = $1", [holder.id]);
  const pub = await c.get('/api/users/devholder');
  assert.equal(pub.status, 200, pub.text);
  assert.ok(!pub.text.includes('dev-tester'));

  // The holder shows it from Settings → Badges like any badge.
  const mine = await c.get('/api/account/badges', holder.cookie);
  assert.equal(mine.status, 200);
  assert.equal(mine.json.earned.find((b) => b.id === 'dev-tester')?.shown, false);
  const shown = await c.put('/api/account/badges', { shown: ['dev-tester'], featured: ['dev-tester'], pinned: null }, holder.cookie);
  assert.equal(shown.status, 200, shown.text);
  assert.equal(shown.json.earned.find((b) => b.id === 'dev-tester')?.shown, true);
  assert.ok((await c.get('/api/users/devholder')).text.includes('dev-tester'), 'shown: on the profile like any badge');

  // Revoke and grant again: the holder's choice (shown) stays.
  assert.equal((await c.post(`/api/admin/badges/accounts/${holder.id}/revoke`, { badgeId: 'dev-tester', reason: 'Pause' }, adminH)).status, 200);
  assert.equal((await c.post(`/api/admin/badges/accounts/${holder.id}/grant`, { badgeId: 'dev-tester', reason: 'Back' }, adminH)).status, 200);
  row = await prod.db.one("SELECT shown FROM badge_awards WHERE account_id = $1 AND badge_id = 'dev-tester'", [holder.id]);
  assert.equal(row.shown, true);

  // Other manual badges still start shown.
  const other = await player(prod, ['discord']);
  assert.equal((await c.post(`/api/admin/badges/accounts/${other.id}/grant`, { badgeId: 'community-partner', reason: 'Partner' }, adminH)).status, 200);
  assert.equal((await prod.db.one("SELECT shown FROM badge_awards WHERE account_id = $1 AND badge_id = 'community-partner'", [other.id])).shown, true);
});

test('production: yes for a holder via Battle.net and via Discord; no for unknown, never-held, revoked and banned — the same shape', async () => {
  const logs = [];
  const orig = {};
  for (const k of ['log', 'warn', 'error', 'info']) {
    orig[k] = console[k];
    console[k] = (...a) => logs.push(a.map(String).join(' '));
  }
  try {
    for (const provider of ['battlenet', 'discord']) {
      const res = await ask({ provider, subject: holder.subjects[provider] });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json, { tester: true });
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    const no = async (provider, subject, why) => {
      const res = await ask({ provider, subject });
      assert.equal(res.status, 200, why);
      assert.deepEqual(res.json, { tester: false }, why);
    };
    await no('discord', '999999999999999999', 'unknown identity');
    await no('battlenet', holder.subjects.discord, 'the right subject under the wrong provider');
    const plain = await player(prod, ['discord']);
    await no('discord', plain.subjects.discord, 'never held');

    const revoked = await player(prod, ['discord']);
    const c = prod.client();
    assert.equal((await c.post(`/api/admin/badges/accounts/${revoked.id}/grant`, { badgeId: 'dev-tester', reason: 'r' }, adminH)).status, 200);
    assert.deepEqual((await ask({ provider: 'discord', subject: revoked.subjects.discord })).json, { tester: true });
    assert.equal((await c.post(`/api/admin/badges/accounts/${revoked.id}/revoke`, { badgeId: 'dev-tester', reason: 'r' }, adminH)).status, 200);
    await no('discord', revoked.subjects.discord, 'revoked');

    const banned = await player(prod, ['battlenet']);
    assert.equal((await c.post(`/api/admin/badges/accounts/${banned.id}/grant`, { badgeId: 'dev-tester', reason: 'r' }, adminH)).status, 200);
    await prod.db.query("INSERT INTO account_bans (account_id, kind, reason, ends_at, actor) VALUES ($1, 'temporary', 'test', now() + interval '1 day', 'admin')", [banned.id]);
    await no('battlenet', banned.subjects.battlenet, 'a live ban');

    const bad = await ask({ provider: 'email', subject: 'x' });
    assert.equal(bad.status, 400);

    // Nothing logged names an id, a subject or the secret.
    const all = logs.join('\n');
    for (const s of [SECRET, holder.subjects.battlenet, holder.subjects.discord, revoked.subjects.discord, banned.subjects.battlenet]) assert.ok(!all.includes(s), 'a log line held an id or the secret');
  } finally {
    Object.assign(console, orig);
  }
});

test('production: the CSRF Origin check is exempt ONLY for this path', async () => {
  // The endpoint works without Origin (the dev server sends none) …
  assert.equal((await ask({ provider: 'discord', subject: holder.subjects.discord }, { origin: null })).status, 200);
  // … every other write still needs it.
  const noOrigin = prod.client({ origin: null });
  for (const path of ['/api/auth/sign-out', '/api/internal/other', '/api/internal/dev-tester-x', '/api/feedback']) {
    const res = await noOrigin.post(path, {}, { Authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 403, path);
    assert.equal(res.json.code, 'cross_origin', path);
  }
  const wrongOrigin = prod.client({ origin: 'https://evil.example' });
  assert.equal((await wrongOrigin.post('/api/auth/sign-out', {})).json.code, 'cross_origin');
  // Other methods on the path are ordinary unknown paths.
  assert.equal((await prod.client().get(PATH)).status, 404);
});

test('the dev site never answers the question, whatever its .env says', async () => {
  const res = await dev.client({ origin: null }).post(PATH, { provider: 'discord', subject: holder.subjects.discord }, { Authorization: `Bearer ${SECRET}` });
  assert.equal(res.status, 404);
  assert.deepEqual(res.json, { error: 'Not found' });
});

test('production: rate-limited per network, and site-wide', async () => {
  const { limits } = prod.app.locals;
  const per = limits.devTesterByNetwork.limit;
  const c = prod.client({ origin: null, ip: '198.51.100.99' });
  // Guesses count too: fill this network's allowance with wrong secrets.
  for (let i = 0; i < per; i++) {
    const r = await c.post(PATH, { provider: 'discord', subject: '1' }, { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong-1' });
    assert.equal(r.status, 404);
  }
  const limited = await c.post(PATH, { provider: 'discord', subject: holder.subjects.discord }, { Authorization: `Bearer ${SECRET}` });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.code, 'rate_limited');
  // Another network still gets answers, until the site-wide cap is used up.
  assert.equal((await ask({ provider: 'discord', subject: holder.subjects.discord }, { ip: '198.51.100.100' })).status, 200);
  while (limits.devTesterGlobal.take('global'));
  assert.equal((await ask({ provider: 'discord', subject: holder.subjects.discord }, { ip: '198.51.100.101' })).status, 429);
});

// ---------------------------------------------------------------- dev: the gate

const setGate = async (on) => {
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(dev.db, 'features.devGate', on, { reason: 'test' });
};

test('dev: the gate is OFF by default and changes nothing', async () => {
  const { getSetting } = await import('../admin/settings.js');
  assert.equal(await getSetting(dev.db, 'features.devGate'), false);
  const c = dev.client();
  assert.deepEqual((await c.get('/api/dev-gate')).json, { gate: 'off' });
  assert.equal((await c.get('/api/statistics')).status, 200);
  assert.equal((await prod.client().get('/api/dev-gate')).json.gate, 'off', 'production is always off');
  assert.equal(fake.calls.length, 0);
});

test('dev, gate on, signed out: data APIs answer 403 dev_gate; sign-in, /api/health and the admin sign-in pass', async () => {
  process.env.DEV_TESTER_SECRET = SECRET;
  await setGate(true);
  const c = dev.client();
  assert.deepEqual((await c.get('/api/dev-gate')).json, { gate: 'sign-in' });
  for (const path of ['/api/statistics', '/api/leaderboards', '/api/why-sign-in', '/api/characters/path-vexley', '/api/admin/moderation/reports', '/api/nothing-here']) {
    const res = await c.get(path);
    assert.equal(res.status, 403, path);
    assert.equal(res.json.code, 'dev_gate', path);
  }
  assert.equal((await c.post('/api/feedback', { message: 'hello there, testing' })).json.code, 'dev_gate');
  assert.equal((await c.get('/api/health')).status, 200);
  assert.equal((await c.get('/api/session')).status, 200);
  assert.equal((await c.get('/api/auth/providers')).status, 200);
  assert.equal((await c.get('/api/theme-boot.js')).status, 200);
  assert.notEqual((await c.post('/api/auth/passkey/options', {})).json?.code, 'dev_gate');
  assert.notEqual((await c.post('/api/admin/sign-in/options', {})).json?.code, 'dev_gate');
  assert.notEqual((await c.get('/auth/discord/callback')).status, 403);
  assert.equal((await c.get('/og/c/path-vexley.png')).status, 403);
  if (existsSync(new URL('../../client/dist/index.html', import.meta.url))) {
    const page = await c.get('/c/path-vexley');
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('og:image'), 'pages are the plain shell while the gate is on');
  }
  assert.equal(fake.calls.length, 0, 'nobody signed in: production is never asked');
});

test('dev, gate on: a tester gets in (asked per identity until one says yes); a non-tester is denied', async () => {
  const tester = await player(dev, ['battlenet', 'discord']);
  fake.answers.set(`discord:${tester.subjects.discord}`, true);
  const c = dev.client();
  assert.deepEqual((await c.get('/api/dev-gate', tester.cookie)).json, { gate: 'allowed' });
  assert.equal((await c.get('/api/statistics', tester.cookie)).status, 200);
  const asked = fake.calls.filter((x) => x.body?.subject === tester.subjects.battlenet || x.body?.subject === tester.subjects.discord);
  assert.deepEqual(asked.map((x) => x.body.provider), ['battlenet', 'discord']);
  assert.ok(asked.every((x) => x.auth === `Bearer ${SECRET}`));
  assert.deepEqual(Object.keys(asked[0].body).sort(), ['provider', 'subject'], 'only the identity is sent');

  const viaBattleNet = await player(dev, ['battlenet']);
  fake.answers.set(`battlenet:${viaBattleNet.subjects.battlenet}`, true);
  assert.deepEqual((await c.get('/api/dev-gate', viaBattleNet.cookie)).json, { gate: 'allowed' });

  const outsider = await player(dev, ['discord']);
  assert.deepEqual((await c.get('/api/dev-gate', outsider.cookie)).json, { gate: 'denied' });
  const refused = await c.get('/api/statistics', outsider.cookie);
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, 'dev_gate');
  // A denied visitor can still sign out.
  assert.equal((await c.post('/api/auth/sign-out', {}, outsider.cookie)).status, 200);
});

test('dev, gate on: production down or answering wrongly → nobody gets in (fail closed), but the admin passes', async () => {
  const tester = await player(dev, ['discord']);
  fake.answers.set(`discord:${tester.subjects.discord}`, true);
  const c = dev.client();
  const warn = console.warn;
  const logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    fake.mode = 'down';
    assert.deepEqual((await c.get('/api/dev-gate', tester.cookie)).json, { gate: 'unavailable' });
    const res = await c.get('/api/statistics', tester.cookie);
    assert.equal(res.status, 403);
    assert.equal(res.json.gate, 'unavailable');

    fake.mode = 'status';
    clock += 20_000; // past the short failure cache
    assert.deepEqual((await c.get('/api/dev-gate', tester.cookie)).json, { gate: 'unavailable' });

    const admin = await adminCookie(dev);
    assert.deepEqual((await c.get('/api/dev-gate', admin)).json, { gate: 'allowed' });
    assert.equal((await c.get('/api/statistics', admin)).status, 200);
    assert.equal((await c.get('/api/admin/state', admin)).status, 200);
  } finally {
    console.warn = warn;
    fake.mode = 'answer';
  }
  assert.ok(logs.length > 0, 'the failure is logged');
  assert.ok(!logs.join('\n').includes(tester.subjects.discord) && !logs.join('\n').includes(SECRET), 'never an id or the secret');
  // Production back: in again once the short failure cache runs out.
  clock += 20_000;
  assert.deepEqual((await c.get('/api/dev-gate', tester.cookie)).json, { gate: 'allowed' });
});

test('dev, gate on: no secret on dev → nobody asked, nobody in (fail closed)', async () => {
  const tester = await player(dev, ['discord']);
  fake.answers.set(`discord:${tester.subjects.discord}`, true);
  delete process.env.DEV_TESTER_SECRET;
  const before = fake.calls.length;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual((await dev.client().get('/api/dev-gate', tester.cookie)).json, { gate: 'unavailable' });
  } finally {
    console.warn = warn;
    process.env.DEV_TESTER_SECRET = SECRET;
  }
  assert.equal(fake.calls.length, before);
});

test('dev, gate on: answers are cached 3 minutes; a revoked badge locks the person out after that', async () => {
  const tester = await player(dev, ['discord']);
  fake.answers.set(`discord:${tester.subjects.discord}`, true);
  const c = dev.client();
  assert.deepEqual((await c.get('/api/dev-gate', tester.cookie)).json, { gate: 'allowed' });
  const asked = () => fake.calls.filter((x) => x.body?.subject === tester.subjects.discord).length;
  assert.equal(asked(), 1);
  fake.answers.set(`discord:${tester.subjects.discord}`, false); // revoked on production
  clock += CACHE_MS - 1000;
  assert.equal((await c.get('/api/statistics', tester.cookie)).status, 200, 'still cached');
  assert.equal(asked(), 1, 'cached: production not asked again');
  clock += 2000;
  assert.equal((await c.get('/api/statistics', tester.cookie)).json.code, 'dev_gate');
  assert.equal(asked(), 2);
});

test('dev, gate switched off again: open as before', async () => {
  await setGate(false);
  assert.deepEqual((await dev.client().get('/api/dev-gate')).json, { gate: 'off' });
  assert.equal((await dev.client().get('/api/statistics')).status, 200);
});

test('the dev deploy’s key-reuse check leaves DEV_TESTER_SECRET alone (it must be the same on both sites) and prints no value', () => {
  const wf = readFileSync(new URL('../../.gitea/workflows/deploy-dev.yml', import.meta.url), 'utf8');
  const line = wf.split('\n').find((l) => l.includes('for k in EVERSTATS_ROOT_KEY'));
  assert.ok(line, 'the reuse loop is where it was');
  assert.ok(!line.includes('DEV_TESTER_SECRET'));
  assert.ok(!wf.includes('DEV_TESTER_SECRET'), 'the workflow never reads it');
  for (const f of ['docker-compose.yml', 'docker-compose.dev.yml']) {
    const compose = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.match(compose, /env_file:\s*\n\s*- path: \.env/, `${f} passes .env (and so DEV_TESTER_SECRET) to the app`);
  }
});
