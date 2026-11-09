import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

const version = JSON.parse(readFileSync(new URL('../../CHANGELOG.json', import.meta.url), 'utf8')).releases[0].version;
let t;
before(async () => {
  t = await startApp();
});
after(() => t.close());

test('/api/health reports status, service, version and the database, nothing else', async () => {
  const res = await t.client().get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { status: 'ok', service: 'web', version, database: 'ok' });
  // The deploy greps the raw body for "version":"x.y.z".
  assert.match(res.text, new RegExp(`"version":"${version.replace(/\./g, '\\.')}"`));
});

test('security headers allow passkeys on this origin and nothing from elsewhere', async () => {
  const res = await t.client().get('/api/health');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(res.headers.get('permissions-policy'), /publickey-credentials-get=\(self\)/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('logged-out visitors always get the Forever theme', async () => {
  const res = await t.client().get('/api/theme-boot.js');
  assert.equal(res.status, 200);
  assert.match(res.text, /'forever'/);
});

test('coverage is honest: no keys means no lookups, no rulesets loaded is null, and zero tracked is a measured zero', async () => {
  const res = await t.client().get('/api/coverage');
  assert.deepEqual(res.json, { region: 'us', lookups: 'not_configured', rulesets: null, trackedCharacters: 0, minPopulation: 50, tierShares: { S: 5, A: 15, B: 30, C: 30, D: 20 }, keepDays: 29 });
});

test('state-changing requests from another origin, or with none, are refused', async () => {
  const evil = await t.client({ origin: 'https://evil.example' }).post('/api/auth/sign-out');
  assert.equal(evil.status, 403);
  const none = await t.client({ origin: null }).post('/api/auth/sign-out');
  assert.equal(none.status, 403);
  const ok = await t.client().post('/api/auth/sign-out');
  assert.equal(ok.status, 200);
});

test('without Blizzard keys a lookup says so, instead of pretending nobody exists', async () => {
  const first = await t.client({ ip: '198.51.100.20' }).get('/api/characters/thrall-durotan');
  assert.deepEqual(first.json, { status: 'unavailable', reason: 'not_configured', slug: 'thrall-durotan' });
  // (Per-network lookup limits with keys set: crawler.test.js.)
});
