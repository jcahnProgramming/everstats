import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// TRUSTED_PROXIES discovery (fix found on the first deploy): in 0.1.0 the header source was only looked at inside
// the rate limiters, so a real page load through the tunnel logged nothing. Every request must be seen.
const lines = [];
const log = { log: (l) => lines.push(l), warn: (l) => lines.push(l) };
let t;
before(async () => {
  const { logHeaderSources } = await import('../core/network.js');
  t = await startApp({ onHeader: logHeaderSources({ log }), trustedProxies: '' });
});
after(() => t.close());

const adminHeaders = async () => {
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};

test('a request to a route with no rate limit logs where CF-Connecting-IP came from, once, without the visitor address', async () => {
  const c = t.client({ ip: '203.0.113.99' });
  await c.get('/api/health');
  await c.get('/api/coverage');
  await c.get('/leaderboards'); // a page, not the API
  const found = lines.filter((l) => l.includes('CF-Connecting-IP'));
  assert.equal(found.length, 1, 'logged exactly once per source');
  assert.match(found[0], /from 127\.0\.0\.1: honoured \(TRUSTED_PROXIES not set\)/);
  assert.ok(!lines.join('\n').includes('203.0.113.99'), "never the visitor's own address");
});

test('the admin page sees the observed sources and the configured list', async () => {
  const state = await t.client().get('/api/admin/state', await adminHeaders());
  assert.equal(state.status, 200);
  assert.equal(state.json.proxies.trustedProxies, null);
  const [source] = state.json.proxies.sources;
  assert.equal(source.address, '127.0.0.1');
  assert.equal(source.honoured, true);
  assert.ok(source.requests >= 3);
  assert.ok(!state.text.includes('203.0.113.99'));
});

test('a rate-limited route counts its request once, not twice', async () => {
  const before = (await t.client().get('/api/admin/state', await adminHeaders())).json.proxies.sources[0].requests;
  await t.client({ ip: '198.51.100.5' }).get('/api/characters/thrall-durotan');
  const afterState = (await t.client().get('/api/admin/state', await adminHeaders())).json.proxies.sources[0].requests;
  // +1 for the lookup, +1 for the second admin/state read itself.
  assert.equal(afterState - before, 2);
});
