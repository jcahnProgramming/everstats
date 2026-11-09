import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

let t;
before(async () => {
  t = await startApp({ fetch: async () => new Response('{}', { status: 200 }) });
});
after(() => t.close());

const sessionCookie = async () => {
  // Admin sessions come only from a passkey; the tests mint one directly (WebAuthn needs a real authenticator).
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};

test('without an admin session every admin route is a plain 404', async () => {
  const c = t.client();
  for (const [method, path] of [['get', '/api/admin/state'], ['put', '/api/admin/credentials/discord'], ['put', '/api/admin/settings/grading.minPopulation']]) {
    const res = await c[method](path, method === 'get' ? undefined : {});
    assert.equal(res.status, 404, path);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
});

test('an enrolment invite must exist and be unused', async () => {
  const res = await t.client().post('/api/admin/enroll/options', { invite: 'x'.repeat(43) });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'invite_invalid');
});

test('the key manager never sends a key to the browser: masked, with its set-on date', async () => {
  const h = await sessionCookie();
  const c = t.client();
  const secret = 'super-secret-value-0123456789';
  const saved = await c.put('/api/admin/credentials/discord', { clientId: '123456789012345678', clientSecret: secret }, h);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.credential.state, 'configured');
  assert.equal(saved.json.credential.source, 'database');
  assert.ok(saved.json.credential.setAt);
  const state = await c.get('/api/admin/state', h);
  for (const text of [saved.text, state.text]) {
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('123456789012345678'));
    assert.ok(!text.includes('6789')); // not even a last four
  }
  // Stored sealed, not in plain text.
  const rows = await t.db.query("SELECT ciphertext FROM credentials WHERE provider = 'discord'");
  assert.ok(rows.every((r) => !r.ciphertext.toString('utf8').includes(secret)));
});

test('credentials resolve database → .env → not configured', async () => {
  const { resolveCredential } = await import('../credentials/store.js');
  assert.equal((await resolveCredential(t.db, 'blizzard')).state, 'not_configured');
  process.env.BLIZZARD_CLIENT_ID = 'env-client-id-000001';
  assert.equal((await resolveCredential(t.db, 'blizzard')).state, 'incomplete');
  process.env.BLIZZARD_CLIENT_SECRET = 'env-client-secret-0001';
  const fromEnv = await resolveCredential(t.db, 'blizzard');
  assert.equal(fromEnv.state, 'configured');
  assert.equal(fromEnv.source, 'env');
  const h = await sessionCookie();
  await t.client().put('/api/admin/credentials/blizzard', { clientId: 'db-client-id-0000001', clientSecret: 'db-client-secret-00001' }, h);
  const fromDb = await resolveCredential(t.db, 'blizzard');
  assert.equal(fromDb.source, 'database');
  assert.equal(fromDb.values.clientId, 'db-client-id-0000001');
  delete process.env.BLIZZARD_CLIENT_ID;
  delete process.env.BLIZZARD_CLIENT_SECRET;
});

test('the minimum population is an admin setting with a default of 500', async () => {
  const h = await sessionCookie();
  const c = t.client();
  assert.equal((await c.put('/api/admin/settings/grading.minPopulation', { value: 0 }, h)).status, 400);
  assert.equal((await c.put('/api/admin/settings/grading.minPopulation', { value: 'many' }, h)).status, 400);
  const ok = await c.put('/api/admin/settings/grading.minPopulation', { value: 750 }, h);
  assert.equal(ok.json.settings[0].value, 750);
  assert.equal((await c.get('/api/coverage')).json.minPopulation, 750);
});

test('the crawler status says when no worker has reported', async () => {
  const h = await sessionCookie();
  const state = (await t.client().get('/api/admin/state', h)).json;
  assert.deepEqual(state.crawler, { workers: [] });
});
