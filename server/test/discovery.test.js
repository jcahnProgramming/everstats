import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// A fake Blizzard: just enough shape to drive a run end to end. Its names are test fixtures, never shipped data.
const APP_TOKEN = 'app-token-NEVER-STORED-0001';
const USER_TOKEN = 'user-token-NEVER-STORED-0002';
const API = 'https://us.api.blizzard.com';
const STATIC_NS = 'static-forever-1.0.0_99999-us';
const calls = [];
let tokenStatus = 200;

const statsDoc = (deaths, camped, gold, formula = false) => ({
  _links: { self: { href: `${API}/x?namespace=profile-forever-us` } },
  character: { id: 9, name: 'Owner of these stats' },
  categories: [{
    id: 130,
    name: 'Character',
    statistics: [
      { id: 1, name: 'Total deaths', quantity: deaths, last_updated_timestamp: 1762560000000 },
      { id: 2, name: 'Times camped', quantity: camped },
      ...(formula ? [{ id: 4, name: '=HYPERLINK("x")', quantity: 1 }] : []),
    ],
    sub_categories: [{ id: 131, name: 'Wealth', statistics: [{ id: 3, name: 'Most gold ever owned', quantity: gold }] }],
  }],
});

function blizzard(path, auth) {
  const char = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(path);
  if (path === '/data/wow/ruleset/index') return { rulesets: [{ key: { href: `${API}/data/wow/ruleset/7?namespace=dynamic-forever-us` }, name: 'Fixture Ruleset', id: 7 }] };
  if (path === '/data/wow/ruleset/7') return { id: 7, name: 'Fixture Ruleset' };
  if (path === '/profile/user/wow') {
    if (auth !== `Bearer ${USER_TOKEN}`) return [401, { code: 401 }];
    return {
      _links: { self: { href: `${API}/profile/user/wow?namespace=profile-forever-us` } },
      wow_accounts: [{ id: 1, characters: [{
        character: { href: `${API}/profile/wow/character/alpha-one?namespace=profile-forever-us` },
        protected_character: { href: `${API}/profile/user/wow/protected-character/1-2?namespace=profile-forever-us` },
        name: 'Alpha', id: 2, level: 20,
        playable_class: { key: { href: `${API}/data/wow/playable-class/5?namespace=${STATIC_NS}` }, name: 'Priest' },
      }] }],
    };
  }
  if (char) {
    const [, slug, sub = ''] = char;
    if (!['test-primary', 'alpha-one', 'beta-two'].includes(slug)) return [404, { code: 404, type: 'BLZWEBAPI00000404' }];
    if (sub === '') {
      return {
        name: slug.split('-')[0], level: 30, last_login_timestamp: 1762560000000,
        guild: slug === 'test-primary' ? { key: { href: `${API}/data/wow/guild/fixture-guild?namespace=profile-forever-us` }, name: 'Fixture Guild' } : undefined,
        achievements: { href: `${API}/profile/wow/character/${slug}/achievements?namespace=profile-forever-us` },
        novel: { href: `${API}/profile/wow/character/${slug}/novel-endpoint?namespace=profile-forever-us` },
        elsewhere: { href: 'https://evil.example/profile/wow/character/x' },
      };
    }
    if (sub === '/achievements/statistics') return statsDoc(slug === 'alpha-one' ? 0 : 3, 5, slug === 'beta-two' ? 1 : 12345, slug === 'test-primary');
    if (sub === '/novel-endpoint') return { camp_count: 2 };
    if (sub === '/character-media') return { assets: [{ key: 'avatar', value: 'https://render.example/a.jpg' }] };
    return [404, { code: 404 }];
  }
  if (path === '/data/wow/guild/fixture-guild') return { name: 'Fixture Guild' };
  if (path === '/data/wow/guild/fixture-guild/roster') {
    return { members: [{ character: { key: { href: `${API}/profile/wow/character/beta-two?namespace=profile-forever-us` }, name: 'Beta', id: 3 }, rank: 1 }] };
  }
  if (path === '/data/wow/playable-race/index') return { races: [{ id: 1, name: 'Skyborne' }] };
  return [404, { code: 404 }];
}

async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  const auth = init.headers?.Authorization ?? init.headers?.authorization ?? null;
  calls.push({ url: String(url), auth });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-fixture-quota-remaining': '35999', 'set-cookie': 'tracker=1' } });
  if (u.origin === 'https://oauth.battle.net' && u.pathname === '/token') {
    if (tokenStatus !== 200) return json({ error: 'invalid_client' }, tokenStatus);
    const grant = new URLSearchParams(String(init.body)).get('grant_type');
    return json(grant === 'client_credentials' ? { access_token: APP_TOKEN, expires_in: 86399 } : { access_token: USER_TOKEN, expires_in: 86399, scope: 'openid wow.profile' });
  }
  if (u.origin === 'https://oauth.battle.net' && u.pathname === '/userinfo') return json({ sub: '424242', battletag: 'Fixture#1234' });
  if (u.origin !== API) throw new Error('the test fetch refuses other hosts');
  const out = blizzard(u.pathname, auth);
  return Array.isArray(out) ? json(out[1], out[0]) : json(out);
}

let t;
let admin;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
});
after(() => t.close());

async function runQueued() {
  const { discoveryJob } = await import('../worker/jobs.js');
  const job = discoveryJob({ fetch: fakeFetch, sleep: async () => {} });
  const r = await job.run({ db: t.db });
  await job.inFlight();
  return r;
}

test('every discovery route is a plain 404 without an admin session', async () => {
  const c = t.client();
  for (const [m, p] of [['get', '/api/admin/discovery'], ['post', '/api/admin/discovery/runs'], ['post', '/api/admin/discovery/authorize'], ['get', '/api/admin/discovery/runs/1/export.json'], ['get', '/api/admin/discovery/responses/1'], ['put', '/api/admin/discovery/decisions']]) {
    const res = await c[m](p, m === 'get' ? undefined : {});
    assert.equal(res.status, 404, p);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
});

test('a run needs the Blizzard keys first', async () => {
  const res = await t.client().post('/api/admin/discovery/runs', { name: 'Test', surname: 'Primary' }, admin);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'not_configured');
});

test('authorizing Battle.net for discovery stores the token sealed and lands on the Discovery page', async () => {
  const c = t.client();
  assert.equal((await c.put('/api/admin/credentials/blizzard', { clientId: 'fixture-client-id-0001', clientSecret: 'fixture-client-secret-01' }, admin)).status, 200);
  const start = await c.post('/api/admin/discovery/authorize', {}, admin);
  assert.equal(start.status, 200);
  const state = new URL(start.json.url).searchParams.get('state');
  assert.equal(new URL(start.json.url).searchParams.get('redirect_uri'), 'http://localhost:3000/auth/battlenet/callback');
  // Battle.net sends the browser back cross-site: the Strict admin cookie doesn't come along, only the flow cookie.
  const cb = await c.get(`/auth/battlenet/callback?code=fixture-code&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 303);
  assert.equal(cb.headers.get('location'), '/admin/discovery?authorized=1');
  const row = await t.db.one('SELECT * FROM discovery_grants');
  assert.ok(!row.ciphertext.toString('latin1').includes(USER_TOKEN));
  const page = await c.get('/api/admin/discovery', admin);
  assert.equal(page.json.grant.battletag, 'Fixture#1234');
  assert.ok(!page.text.includes(USER_TOKEN));
  // No account or session came out of it.
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM accounts')).n, 0);
});

test('a forged discovery callback without its flow goes nowhere', async () => {
  const cb = await t.client().get('/auth/battlenet/callback?code=x&state=y');
  assert.equal(cb.status, 303);
  assert.equal(cb.headers.get('location'), '/sign-in?error=expired');
});

test('a run records every answer, follows only Blizzard links, and builds the catalog', async () => {
  const c = t.client();
  await c.put('/api/admin/settings/discovery.requestsPerSecond', { value: 100 }, admin);
  const queued = await c.post('/api/admin/discovery/runs', { name: 'Test', surname: 'Primary' }, admin);
  assert.equal(queued.status, 201);
  assert.equal(queued.json.run.status, 'queued');
  assert.equal((await c.post('/api/admin/discovery/runs', { name: 'Test', surname: 'Primary' }, admin)).status, 409);

  assert.match((await runQueued()).summary, /Started discovery run/);
  const { run } = (await c.get(`/api/admin/discovery/runs/${queued.json.run.id}`, admin)).json;
  assert.equal(run.status, 'done', run.problem);
  const s = run.summary;

  // Rulesets as returned, and the static namespace detected from the account's links, then used.
  assert.deepEqual(s.rulesets.listed.map((x) => [x.id, x.name]), [[7, 'Fixture Ruleset']]);
  assert.equal(s.namespaces.staticDetected, STATIC_NS);
  assert.ok(calls.some((x) => x.url.includes('/data/wow/playable-race/index') && x.url.includes(`namespace=${STATIC_NS}`)));

  // Seeds: primary, the account's character, the guild roster's member. Account shape has no realm.
  assert.deepEqual(s.characters.map((x) => [x.path, x.source]), [
    ['/profile/wow/character/test-primary', 'primary'], ['/profile/wow/character/alpha-one', 'account'], ['/profile/wow/character/beta-two', 'guild'],
  ]);
  assert.equal(s.account.realmShaped, false);
  assert.equal(s.guild.members, 1);

  // 404s are rows; the advertised extra link was fetched; the foreign link was refused, never requested.
  const statuses = await t.db.query('SELECT endpoint, status, error, headers, path FROM discovery_responses WHERE run_id = $1 LIMIT 2000', [run.id]);
  assert.ok(statuses.some((x) => x.endpoint === 'character.hunter-pets' && x.status === 404));
  assert.ok(statuses.some((x) => x.endpoint === 'character.linked' && x.path.endsWith('/novel-endpoint') && x.status === 200));
  assert.ok(!calls.some((x) => x.url.includes('evil.example')));
  assert.ok(statuses.every((x) => !('set-cookie' in x.headers)));
  assert.equal(s.rateHeaders['x-fixture-quota-remaining'].first, '35999');

  // Tokens: only ever in an Authorization header. Never in a URL, a stored row or the summary.
  assert.ok(calls.every((x) => !x.url.includes(APP_TOKEN) && !x.url.includes(USER_TOKEN)));
  assert.ok(calls.filter((x) => x.url.includes('/profile/user/wow')).every((x) => x.auth === `Bearer ${USER_TOKEN}`));
  assert.ok(calls.filter((x) => x.url.includes('/profile/wow/character/')).every((x) => x.auth === `Bearer ${APP_TOKEN}`));
  const dump = JSON.stringify(await t.db.query('SELECT * FROM discovery_responses LIMIT 5000')) + JSON.stringify(run);
  assert.ok(!dump.includes(APP_TOKEN) && !dump.includes(USER_TOKEN));

  // Slug probes, character media, Forever terms.
  assert.equal(s.slugs.probes.length, 6);
  assert.equal(s.primaryMedia.status, 200);
  assert.deepEqual(s.primaryMedia.assets, ['avatar']);
  assert.deepEqual(s.foreverInCatalog.find((x) => x.id === 'camping').statistics.map((x) => x.id), [2]);
  assert.ok(s.foreverTerms.find((x) => x.id === 'skyborne').hits.length >= 1);
  assert.ok(s.freshness.some((f) => f.field === 'last_login_timestamp' && f.iso === new Date(1762560000000).toISOString()));

  // The catalog: Blizzard's grouping, counts across the three samples, suggestions with reasoning.
  const { catalog } = (await c.get(`/api/admin/discovery/runs/${run.id}/catalog`, admin)).json;
  const byId = Object.fromEntries(catalog.map((x) => [x.statisticId, x]));
  assert.deepEqual(byId[3].categoryPath.map((x) => x.name), ['Character', 'Wealth']);
  assert.equal(byId[3].valueType, 'gold');
  assert.equal(byId[1].charactersSampled, 3);
  assert.equal(byId[1].charactersNonzero, 2);
  const bad = byId[1].suggestions.find((x) => x.kind === 'bad');
  assert.equal(bad.value, true);
  assert.match(bad.reasoning, /deaths/);
  // Three samples can't prove a statistic is meaningless: unknown, not a verdict.
  assert.equal(byId[2].suggestions.find((x) => x.kind === 'leaderboard').value, null);
});

test('decisions persist, a rejected suggestion is not suggested again, and unknowns cannot be approved', async () => {
  const c = t.client();
  const runId = (await t.db.one("SELECT id FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1")).id;
  const rej = await c.put('/api/admin/discovery/decisions', { runId, statisticId: 1, kind: 'bad', decision: 'rejected' }, admin);
  assert.equal(rej.status, 200);
  const s = rej.json.statistic.suggestions.find((x) => x.kind === 'bad');
  assert.equal(s.decision, 'rejected');
  assert.equal(s.hidden, true);
  const unknown = await c.put('/api/admin/discovery/decisions', { runId, statisticId: 2, kind: 'leaderboard', decision: 'approved' }, admin);
  assert.equal(unknown.status, 400);
  await c.put('/api/admin/discovery/decisions', { runId, statisticId: 3, kind: 'category', decision: 'approved' }, admin);
  const { catalog } = (await c.get(`/api/admin/discovery/runs/${runId}/catalog`, admin)).json;
  assert.equal(catalog.find((x) => x.statisticId === 3).suggestions.find((x) => x.kind === 'category').decision, 'approved');
  assert.equal(catalog.find((x) => x.statisticId === 1).suggestions.find((x) => x.kind === 'bad').hidden, true);
});

test('exports: CSV defuses formulas; JSON carries the summary, catalog, request log and primary raw bodies', async () => {
  const c = t.client();
  const runId = (await t.db.one("SELECT id FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1")).id;
  const csv = await c.get(`/api/admin/discovery/runs/${runId}/export.csv`, admin);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(csv.text, /^statistic_id,name,blizzard_category/);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""x"")"`));
  const json = await c.get(`/api/admin/discovery/runs/${runId}/export.json`, admin);
  assert.equal(json.json.run.summary.catalogSize, 4);
  assert.ok(json.json.run.summary.skeletons['account.profile']);
  assert.ok(json.json.raw.some((r) => r.endpoint === 'character.achievement-statistics' && r.subject === '/profile/wow/character/test-primary' && r.body.includes('Times camped')));
  assert.ok(!json.json.raw.some((r) => r.subject === '/profile/wow/character/beta-two'));
  assert.ok(json.json.requests.length > 50);
});

test('a run whose worker stopped shows as interrupted, and bad keys fail with a reason', async () => {
  const stale = await t.db.one("INSERT INTO discovery_runs (status, started_at, heartbeat_at, options) VALUES ('running', now() - interval '1 hour', now() - interval '1 hour', '{}') RETURNING id");
  await runQueued();
  assert.equal((await t.db.one('SELECT status FROM discovery_runs WHERE id = $1', [stale.id])).status, 'interrupted');

  tokenStatus = 401;
  const queued = await t.client().post('/api/admin/discovery/runs', { name: 'Test', surname: 'Primary' }, admin);
  await runQueued();
  const row = await t.db.one('SELECT status, problem FROM discovery_runs WHERE id = $1', [queued.json.run.id]);
  tokenStatus = 200;
  assert.equal(row.status, 'failed');
  assert.match(row.problem, /refused an app token \(HTTP 401\)/);
});

test('expired discovery tokens are swept', async () => {
  const { sweepExpired } = await import('../app.js');
  await t.db.query("UPDATE discovery_grants SET expires_at = now() - interval '1 minute'");
  await sweepExpired(t.db);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM discovery_grants')).n, 0);
});

test('analysis helpers: statistic shapes, value-type guesses, slug findings', async () => {
  const { statisticsIn, guessValueType, slugFindings, pickStaticNamespace } = await import('../discovery/analyze.js');
  const found = statisticsIn({ character: { id: 1, name: 'x', quantity: 1 }, categories: [{ id: 5, name: 'Combat', statistics: [{ id: 9, name: 'Kills', quantity: 4 }] }] });
  assert.deepEqual(found.map((s) => [s.id, s.categoryPath.map((c) => c.name)]), [[9, ['Combat']]]);
  assert.equal(guessValueType('Total time played').type, 'time');
  assert.equal(guessValueType('Largest hit dealt').type, 'highest-ever');
  assert.equal(guessValueType('Creatures killed').type, 'count');
  assert.match(guessValueType('Gold looted').basis, /guessed/);
  const f = slugFindings(['/profile/wow/character/ann-de-la-rue', '/profile/wow/character/bob-smith']);
  assert.deepEqual(f.withMoreThanOneHyphen, ['ann-de-la-rue']);
  assert.equal(pickStaticNamespace({ 'static-forever-1.0_1-us': { count: 1, firstEndpoint: 'x' } }, { region: 'us' }), 'static-forever-1.0_1-us');
  assert.equal(pickStaticNamespace({ 'dynamic-forever-us': { count: 9, firstEndpoint: 'x' } }, { region: 'us' }), null);
});
