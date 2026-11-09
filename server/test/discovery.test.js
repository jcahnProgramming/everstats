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
  }, {
    id: 133, name: 'Quests', statistics: [{ id: 5, name: 'Average quests completed per day', quantity: 0 }],
  }, {
    id: 21, name: 'Player vs. Player', sub_categories: [{ id: 154, name: 'World', statistics: [{ id: 6, name: 'Duels lost', quantity: deaths }] }],
  }, {
    id: 128, name: 'Kills', statistics: [{ id: 7, name: 'Creature type killed the most', description: 'Undead', quantity: gold + 1 }],
  }, {
    id: 131, name: 'Social', statistics: [{ id: 8, name: 'Total waves', quantity: camped }],
  }],
  statistics: [{ id: 9, name: 'Loose statistic', quantity: 1 }],
});

function blizzard(path, auth) {
  const char = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(path);
  if (path === '/data/wow/ruleset/index') {
    return {
      _links: { self: { href: `${API}/data/wow/ruleset/?namespace=dynamic-forever-us` } },
      rulesets: [{ key: { href: `${API}/data/wow/ruleset/7?namespace=dynamic-forever-us` }, id: 7 }],
    };
  }
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
        ruleset: { key: { href: `${API}/data/wow/ruleset/7?namespace=dynamic-forever-us` }, name: 'Fixture Ruleset', id: 7 },
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

const latestDone = async () => (await t.db.one("SELECT id FROM discovery_runs WHERE status = 'done' ORDER BY id DESC LIMIT 1")).id;

test('every discovery route is a plain 404 without an admin session', async () => {
  const c = t.client();
  for (const [m, p] of [['get', '/api/admin/discovery'], ['post', '/api/admin/discovery/runs'], ['post', '/api/admin/discovery/authorize'], ['get', '/api/admin/discovery/runs/1/export.json'], ['get', '/api/admin/discovery/responses/1'], ['put', '/api/admin/discovery/decisions'], ['post', '/api/admin/discovery/runs/1/reanalyse'], ['get', '/api/admin/discovery/catalog'], ['post', '/api/admin/discovery/reanalyse'], ['get', '/api/admin/discovery/catalog/export.csv']]) {
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

  // Rulesets as returned (names come from each ruleset, the index has none); the index's self-link is not fetched.
  assert.deepEqual(s.rulesets.listed.map((x) => x.id), [7]);
  assert.deepEqual(s.rulesets.details.map((x) => x.path), ['/data/wow/ruleset/7']);
  assert.ok(!calls.some((x) => new URL(x.url).pathname === '/data/wow/ruleset/'));
  // The static namespace detected from the account's links, then used.
  assert.equal(s.namespaces.staticDetected, STATIC_NS);
  assert.ok(calls.some((x) => x.url.includes('/data/wow/playable-race/index') && x.url.includes(`namespace=${STATIC_NS}`)));

  // Seeds: primary, the account's character, the guild roster's member, each with its ruleset. No realm.
  assert.deepEqual(s.characters.map((x) => [x.path, x.source]), [
    ['/profile/wow/character/test-primary', 'primary'], ['/profile/wow/character/alpha-one', 'account'], ['/profile/wow/character/beta-two', 'guild'],
  ]);
  assert.ok(s.characters.every((x) => x.ruleset?.name === 'Fixture Ruleset' && x.ruleset.id === 7));
  assert.deepEqual(s.rulesetsSampled, { 'Fixture Ruleset (id 7)': 3 });
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
  const sug = (id, kind) => byId[id].suggestions.find((x) => x.kind === kind);
  assert.deepEqual(byId[3].categoryPath.map((x) => x.name), ['Character', 'Wealth']);
  // "Most gold ever owned": the word "gold" alone isn't evidence of a gold amount (0.3.2); a guess, labelled as one.
  assert.equal(byId[3].valueType, 'highest-ever');
  assert.equal(byId[3].valueTypeGuessed, true);
  assert.equal(byId[7].valueTypeGuessed, false); // seen in the samples, not guessed
  assert.deepEqual(byId[1].runs, [run.id]);
  // No pairing is ever suggested from three characters.
  assert.ok(catalog.every((x) => !x.suggestions.some((y) => y.kind === 'duplicate')));
  assert.equal(byId[1].charactersSampled, 3);
  assert.equal(byId[1].charactersNonzero, 2);
  assert.equal(sug(1, 'grading').value, 'none');
  assert.match(sug(1, 'grading').reasoning, /deaths/);
  assert.equal(sug(1, 'category').value, 'Deaths & mishaps');
  assert.equal(sug(3, 'grading').value, 'overall');
  // Every statistic gets a leaderboard, the tie and the rare one included.
  assert.ok(catalog.every((x) => x.suggestions.find((y) => y.kind === 'leaderboard').value === true));
  // Farmable: its own category tier, never the overall tier.
  assert.equal(sug(2, 'category').value, 'Camping & Hearth');
  assert.equal(sug(2, 'grading').value, 'category');
  assert.equal(sug(8, 'category').value, 'Social');
  assert.equal(sug(8, 'grading').value, 'category');
  // "… per day" is a rate, not a duration; Duels lost is a bad statistic.
  assert.equal(byId[5].valueType, 'rate');
  assert.equal(sug(6, 'grading').value, 'none');
  assert.equal(sug(6, 'category').value, 'Deaths & mishaps');
  // A number with a text description beside it: name + number, ranked by its number, not graded.
  assert.equal(byId[7].valueType, 'name-and-number');
  assert.equal(byId[7].hasText, true);
  assert.match(byId[7].valueTypeBasis, /Undead/);
  assert.equal(sug(7, 'grading').value, 'none');
  // No category anywhere: unknown, said so.
  assert.equal(sug(9, 'category').value, null);
});

test('decisions persist, a rejected suggestion is not suggested again, and unknowns cannot be approved', async () => {
  const c = t.client();
  const runId = await latestDone();
  const rej = await c.put('/api/admin/discovery/decisions', { runId, statisticId: 1, kind: 'grading', decision: 'rejected' }, admin);
  assert.equal(rej.status, 200);
  const s = rej.json.statistic.suggestions.find((x) => x.kind === 'grading');
  assert.equal(s.decision, 'rejected');
  assert.equal(s.hidden, true);
  const unknown = await c.put('/api/admin/discovery/decisions', { runId, statisticId: 9, kind: 'category', decision: 'approved' }, admin);
  assert.equal(unknown.status, 400);
  await c.put('/api/admin/discovery/decisions', { runId, statisticId: 3, kind: 'category', decision: 'approved' }, admin);
  const { catalog } = (await c.get(`/api/admin/discovery/runs/${runId}/catalog`, admin)).json;
  assert.equal(catalog.find((x) => x.statisticId === 3).suggestions.find((x) => x.kind === 'category').decision, 'approved');
  assert.equal(catalog.find((x) => x.statisticId === 1).suggestions.find((x) => x.kind === 'grading').hidden, true);
});

test('exports: CSV defuses formulas; JSON carries the summary, catalog, request log and primary raw bodies', async () => {
  const c = t.client();
  const runId = await latestDone();
  const csv = await c.get(`/api/admin/discovery/runs/${runId}/export.csv`, admin);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(csv.text, /^statistic_id,name,blizzard_category/);
  assert.match(csv.text.split('\r\n')[0], /suggested_grading/);
  assert.ok(csv.text.includes(`"'=HYPERLINK(""x"")"`));
  const json = await c.get(`/api/admin/discovery/runs/${runId}/export.json`, admin);
  assert.equal(json.json.run.summary.catalogSize, 9);
  assert.ok(json.json.run.summary.skeletons['account.profile']);
  assert.ok(json.json.raw.some((r) => r.endpoint === 'character.achievement-statistics' && r.subject === '/profile/wow/character/test-primary' && r.body.includes('Times camped')));
  assert.ok(!json.json.raw.some((r) => r.subject === '/profile/wow/character/beta-two'));
  assert.ok(json.json.requests.length > 50);
});

test('re-analysing a finished run rebuilds its catalog and summary from stored responses only', async () => {
  const c = t.client();
  const runId = await latestDone();
  // Pretend the run was analysed by older rules: a wrong value type, and no per-character rulesets.
  await t.db.query("UPDATE discovery_statistics SET value_type = 'time' WHERE run_id = $1 AND statistic_id = 5", [runId]);
  await t.db.query("UPDATE discovery_runs SET summary = (summary - 'rulesetsSampled') WHERE id = $1", [runId]);
  const before = calls.length;
  const res = await c.post(`/api/admin/discovery/runs/${runId}/reanalyse`, {}, admin);
  assert.equal(res.status, 200);
  assert.equal(calls.length, before); // nothing was asked of Blizzard
  assert.deepEqual(res.json.run.summary.rulesetsSampled, { 'Fixture Ruleset (id 7)': 3 });
  assert.equal(res.json.run.summary.slugs.probes.length, 6); // what only the run itself knew is kept
  assert.equal((await t.db.one('SELECT value_type FROM discovery_statistics WHERE run_id = $1 AND statistic_id = 5', [runId])).value_type, 'rate');
  // Decisions made before the re-analysis still apply.
  const { catalog } = (await c.get(`/api/admin/discovery/runs/${runId}/catalog`, admin)).json;
  assert.equal(catalog.find((x) => x.statisticId === 1).suggestions.find((x) => x.kind === 'grading').decision, 'rejected');
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
  // Only a finished run can be re-analysed.
  assert.equal((await t.client().post(`/api/admin/discovery/runs/${queued.json.run.id}/reanalyse`, {}, admin)).status, 409);
});

test('expired discovery tokens are swept', async () => {
  const { sweepExpired } = await import('../app.js');
  await t.db.query("UPDATE discovery_grants SET expires_at = now() - interval '1 minute'");
  await sweepExpired(t.db);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM discovery_grants')).n, 0);
});

test('equal values only suggest a possible duplicate; nothing is ungraded until the admin approves the pairing', async () => {
  const { findDuplicateCandidates, present } = await import('../discovery/suggest.js');
  const subjects = ['a', 'b', 'c', 'd', 'e', 'f'];
  const row = (statisticId, name, values) => ({
    statisticId, name, categoryPath: [{ id: 132, name: 'Skills' }], valueType: 'count', valueTypeGuessed: true, charactersSampled: 6, charactersPresent: values.length,
    charactersNonzero: values.filter((v) => v).length, numericSamples: values.length, minValue: Math.min(...values), maxValue: Math.max(...values),
    valuesBySubject: new Map(values.map((v, i) => [subjects[i], v])),
  });
  const raw = [
    row(1518, 'Fish caught', [1, 2, 3, 4, 5]), row(1456, 'Fish and other things caught', [1, 2, 3, 4, 5]), row(1519, 'Fishing skill', [1, 2, 3, 4, 6]),
    row(1199, 'Professions learned', [1, 2, 2, 2, 1]), row(1201, 'Professions at maximum skill', [1, 2, 2, 2, 1]),
    row(70, 'Rare one', [1, 1]), row(71, 'Rare two', [1, 1]),
    row(80, 'Always zero', [0, 0, 0, 0, 0, 0]), row(81, 'Also always zero', [0, 0, 0, 0, 0, 0]),
  ];
  const dups = findDuplicateCandidates(raw);
  // Fewer than 5 characters, or one value for everyone, is never evidence of a duplicate.
  assert.deepEqual([...dups.keys()].sort((a, b) => a - b), [1199, 1201, 1456, 1518]);
  const catalog = raw.map((s) => ({ ...s, duplicate: dups.get(s.statisticId) ?? null }));
  const byId = Object.fromEntries(catalog.map((s) => [s.statisticId, s]));
  const sug = (s, kind, decisions) => present(s, decisions).suggestions.find((x) => x.kind === kind);

  // Suggested, with its evidence and a confidence from the names; still graded until approved.
  const fish = sug(byId[1518], 'duplicate');
  assert.deepEqual(fish.value, { of: 1456 });
  assert.equal(fish.evidence.confidence, 'likely');
  assert.equal(fish.evidence.present, 5);
  assert.equal(fish.evidence.nonzero, 5);
  assert.equal(sug(byId[1201], 'duplicate').evidence.confidence, 'possible'); // the names count different things
  assert.match(sug(byId[1201], 'duplicate').reasoning, /Possibly the same as "Professions learned".*Unknown from 5 samples/);
  assert.equal(sug(byId[1201], 'grading').value, 'overall');
  assert.match(sug(byId[1201], 'grading').reasoning, /if you approve that pairing/);
  assert.equal(sug(byId[1199], 'duplicate'), undefined); // the primary has nothing to approve

  // Approved: only now does it stop counting toward tiers. Its leaderboard stays.
  const approved = new Map([['duplicate', { value: { of: 1199 }, decision: 'approved', decidedAt: 'now' }]]);
  assert.equal(sug(byId[1201], 'duplicate', approved).decision, 'approved');
  assert.equal(sug(byId[1201], 'grading', approved).value, 'none');
  assert.equal(sug(byId[1201], 'leaderboard', approved).value, true);
  // Rejected: graded as normal, the pairing hidden.
  const rejected = new Map([['duplicate', { value: { of: 1199 }, decision: 'rejected', decidedAt: 'now' }]]);
  assert.equal(sug(byId[1201], 'duplicate', rejected).hidden, true);
  assert.equal(sug(byId[1201], 'grading', rejected).value, 'overall');
  // Approved, but later samples differ: the approval stands, and the page says it no longer has support.
  const diverged = { ...byId[1201], duplicate: null };
  const stale = sug(diverged, 'duplicate', approved);
  assert.equal(stale.stale, true);
  assert.equal(stale.decision, 'approved');
  assert.match(stale.reasoning, /no longer support/);
  assert.equal(sug(diverged, 'grading', approved).value, 'none');
});

test('the combined catalog joins every finished run; value-type corrections and decisions survive re-analysis', async () => {
  const c = t.client();
  const first = await latestDone();
  const queued = await c.post('/api/admin/discovery/runs', { name: 'Test', surname: 'Primary' }, admin);
  await runQueued();
  const second = queued.json.run.id;
  assert.equal((await t.db.one('SELECT status FROM discovery_runs WHERE id = $1', [second])).status, 'done');

  const { combined, catalog } = (await c.get('/api/admin/discovery/catalog', admin)).json;
  assert.deepEqual(combined.runs, [first, second]);
  assert.equal(combined.characters, 3); // the same three characters in both runs count once
  assert.deepEqual(combined.rulesets, { 'Fixture Ruleset': 3 });
  const stat = (cat, id) => cat.find((x) => x.statisticId === id);
  assert.deepEqual(stat(catalog, 1).runs, [first, second]);
  assert.equal(stat(catalog, 1).charactersPresent, 3);
  assert.equal(stat(catalog, 5).valueType, 'rate');
  assert.equal(stat(catalog, 5).valueTypeGuessed, true);
  // Decisions made on a run's catalog show in the combined one: they belong to the statistic.
  assert.equal(stat(catalog, 1).suggestions.find((x) => x.kind === 'grading').decision, 'rejected');

  // Correct a value type from the combined view.
  const bad = await c.put('/api/admin/discovery/decisions', { combined: true, statisticId: 5, kind: 'value_type', decision: 'approved', value: 'furlongs' }, admin);
  assert.equal(bad.status, 400);
  const set = await c.put('/api/admin/discovery/decisions', { combined: true, statisticId: 5, kind: 'value_type', decision: 'approved', value: 'decimal' }, admin);
  assert.equal(set.status, 200);
  assert.equal(set.json.statistic.valueType, 'decimal');
  assert.equal(set.json.statistic.valueTypeGuessed, false);
  assert.match(set.json.statistic.valueTypeBasis, /set by you/);
  // A correction that makes it name + number feeds the grading rule at once.
  await c.put('/api/admin/discovery/decisions', { combined: true, statisticId: 9, kind: 'value_type', decision: 'approved', value: 'name-and-number' }, admin);

  const before = calls.length;
  const re = await c.post('/api/admin/discovery/reanalyse', {}, admin);
  assert.equal(re.status, 200);
  assert.equal(calls.length, before); // nothing asked of Blizzard
  assert.deepEqual(re.json.combined.runs, [first, second]);
  const after = (await c.get('/api/admin/discovery/catalog', admin)).json.catalog;
  assert.equal(stat(after, 5).valueType, 'decimal');
  assert.equal(stat(after, 9).suggestions.find((x) => x.kind === 'grading').value, 'none');
  const perRun = (await c.get(`/api/admin/discovery/runs/${second}/catalog`, admin)).json.catalog;
  assert.equal(stat(perRun, 5).valueType, 'decimal');

  // Clearing the correction goes back to the analysis.
  const cleared = await c.put('/api/admin/discovery/decisions', { combined: true, statisticId: 5, kind: 'value_type', decision: 'cleared' }, admin);
  assert.equal(cleared.json.statistic.valueType, 'rate');
  assert.equal(cleared.json.statistic.valueTypeGuessed, true);

  const csv = await c.get('/api/admin/discovery/catalog/export.csv', admin);
  assert.match(csv.text.split('\r\n')[0], /,runs,value_type,value_type_guessed,/);
  assert.ok(csv.text.includes(`,${first} ${second},`));
});

test('analysis helpers: statistic shapes, value-type guesses, slug findings', async () => {
  const { statisticsIn, guessValueType, slugFindings, pickStaticNamespace } = await import('../discovery/analyze.js');
  const found = statisticsIn({ character: { id: 1, name: 'x', quantity: 1 }, categories: [{ id: 5, name: 'Combat', statistics: [{ id: 9, name: 'Kills', quantity: 4 }] }] });
  assert.deepEqual(found.map((s) => [s.id, s.categoryPath.map((c) => c.name)]), [[9, ['Combat']]]);
  assert.equal(guessValueType('Total time played').type, 'time');
  assert.equal(guessValueType('Largest hit dealt').type, 'highest-ever');
  assert.equal(guessValueType('Creatures killed').type, 'count');
  assert.equal(guessValueType('Average quests completed per day').type, 'rate');
  assert.equal(guessValueType('Bandage used most', { namedExample: 'Linen Bandage' }).type, 'name-and-number');
  assert.match(guessValueType('Gold looted').basis, /guessed/);
  assert.equal(guessValueType('Gold looted').type, 'gold');
  // 0.3.2: words that only hint at a unit are no evidence. These are counts, and the default is labelled a guess.
  for (const name of ['Battlegrounds played', 'Times camped', 'Flight paths taken', 'Deaths from falling', 'Summons accepted']) {
    assert.equal(guessValueType(name).type, 'count', name);
    assert.equal(guessValueType(name).guessed, true, name);
  }
  assert.equal(guessValueType('Bandage used most', { namedExample: 'Linen Bandage' }).guessed, false);
  const f = slugFindings(['/profile/wow/character/ann-de-la-rue', '/profile/wow/character/bob-smith']);
  assert.deepEqual(f.withMoreThanOneHyphen, ['ann-de-la-rue']);
  assert.equal(pickStaticNamespace({ 'static-forever-1.0_1-us': { count: 1, firstEndpoint: 'x' } }, { region: 'us' }), 'static-forever-1.0_1-us');
  assert.equal(pickStaticNamespace({ 'dynamic-forever-us': { count: 9, firstEndpoint: 'x' } }, { region: 'us' }), null);
});
