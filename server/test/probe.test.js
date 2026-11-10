import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { PROBE_ENDPOINTS, templateParams } from '../discovery/probe/endpoints.js';
import { candidatesFrom, listsOf, templateRegex } from '../discovery/probe/run.js';

// A fake Blizzard for the endpoint probe. Its names and numbers are test fixtures, never shipped data.
const APP_TOKEN = 'app-token-PROBE-NEVER-STORED-01';
const USER_TOKEN = 'user-token-PROBE-NEVER-STORED-02';
const API = 'https://us.api.blizzard.com';
// The shape Blizzard's links use on Forever (static-{build}-forever-us); core/gameVersions.js staticPattern matches it.
const STATIC_NS = 'static-1.0.0_12345-forever-us';
const DYN = 'dynamic-forever-us';
const PROF = 'profile-forever-us';
const C = '/profile/wow/character/path-vexley';
const calls = [];
let onCall = null;

function blizzard(path, ns, auth, query) {
  if (path === C) {
    return {
      _links: { self: { href: `${API}${C}?namespace=${PROF}` } }, id: 77, name: 'Path', achievement_points: 0,
      character_class: { key: { href: `${API}/data/wow/playable-class/5?namespace=${STATIC_NS}` }, id: 5 },
      guild: { key: { href: `${API}/data/wow/guild/post-nerf-clarity?namespace=${PROF}` }, name: 'Post Nerf Clarity' },
    };
  }
  if (path === `${C}/achievements`) return { total_points: 0, achievements: [{ id: 6, achievement: { key: { href: `${API}/data/wow/achievement/6?namespace=${STATIC_NS}` }, id: 6 }, completed_timestamp: 1762560000000 }] };
  if (path === `${C}/collections/mounts`) return { mounts: [{ mount: { key: { href: `${API}/data/wow/mount/6?namespace=${STATIC_NS}` }, id: 6 }, is_useable: true }] };
  if (path === `${C}/legacy`) return { legacy_points: 3 };
  if (path === '/profile/user/wow') {
    if (auth !== `Bearer ${USER_TOKEN}`) return [401, { code: 401 }];
    return { wow_accounts: [{ characters: [
      { name: 'Other', id: 12, protected_character: { href: `${API}/profile/user/wow/protected-character/0-12?namespace=${PROF}` } },
      { name: 'Path', id: 77, protected_character: { href: `${API}/profile/user/wow/protected-character/0-77?namespace=${PROF}` } },
    ] }] };
  }
  if (path === '/profile/user/wow/protected-character/0-77') return auth === `Bearer ${USER_TOKEN}` ? { id: 77, money: 1 } : [401, {}];
  if (path === '/data/wow/guild/post-nerf-clarity') return { name: 'Post Nerf Clarity', achievement_points: 0 };
  if (path === '/data/wow/ruleset/index' && ns === DYN) return { rulesets: [{ key: { href: `${API}/data/wow/ruleset/7?namespace=${DYN}` }, id: 7 }] };
  if (path === '/data/wow/connected-realm/index' && ns === DYN) return { connected_realms: [] };
  if (path === '/data/wow/mount/index' && ns === STATIC_NS) {
    return { _links: { self: { href: `${API}/data/wow/mount/index?namespace=${STATIC_NS}` } }, mounts: [6, 7, 8, 9, 10, 11, 12].map((id) => ({ key: { href: `${API}/data/wow/mount/${id}?namespace=${STATIC_NS}` }, id })) };
  }
  if (path === '/data/wow/mount/6' && ns === STATIC_NS) return { id: 6, name: 'Fixture mount' };
  if (path === '/data/wow/pet/index' && ns === DYN) return { pets: [{ id: 39 }, { id: 40 }] }; // only in the "other" namespace
  if (path === '/data/wow/pet/39' && ns === DYN) return { id: 39 };
  if (path === '/data/wow/search/mount' && query.get('orderby') === 'id' && query.get('_page') === '1') return { page: 1, results: [{ key: { href: `${API}/data/wow/mount/7` }, data: { id: 7 } }] };
  if (path === '/data/wow/journal-encounter/index' && ns === STATIC_NS) return { encounters: [{ key: { href: `${API}/data/wow/journal-encounter/89?namespace=${STATIC_NS}` }, id: 89 }] };
  if (path === '/data/wow/journal-encounter/89') return { id: 89, items: [{ id: 1 }, { id: 2 }] };
  return [404, { code: 404 }];
}

// ---- 0.10.0: a fake Retail (a realm version: profile-us / dynamic-us, realm paths). Fixture names and numbers only.
const R_PROF = 'profile-us';
const R_DYN = 'dynamic-us';
const R_STATIC = 'static-11.0.0_55555-us';
const RC = '/profile/wow/character/fixture-realm/fixturo';
const RG = '/data/wow/guild/fixture-realm/fixture-guild';
const RENDER = 'https://render.worldofwarcraft.com/us/character/fixture-realm/1/2-main-raw.png';
const isRetail = (ns) => ns === R_PROF || ns === R_DYN || ns === R_STATIC;
function retail(path, ns, auth) {
  if (path === '/profile/user/wow' && ns === R_PROF) {
    if (auth !== `Bearer ${USER_TOKEN}`) return [401, {}];
    return { wow_accounts: [{ characters: [
      { name: 'Lowbie', id: 31, level: 12, realm: { slug: 'fixture-realm', name: 'Fixture Realm' }, character: { href: `${API}/profile/wow/character/fixture-realm/lowbie?namespace=${R_PROF}` }, playable_race: { name: 'Gnome' } },
      { name: 'Fixturo', id: 33, level: 80, realm: { slug: 'fixture-realm', name: 'Fixture Realm' }, character: { href: `${API}${RC}?namespace=${R_PROF}` }, playable_race: { name: 'Orc' }, playable_class: { name: 'Shaman' } },
    ] }] };
  }
  if (path === RC && ns === R_PROF) {
    return {
      _links: { self: { href: `${API}${RC}?namespace=${R_PROF}` } }, id: 33, name: 'Fixturo', level: 80, race: { name: 'Orc' }, gender: { name: 'Male' },
      realm: { key: { href: `${API}/data/wow/realm/3?namespace=${R_DYN}` }, id: 3, slug: 'fixture-realm', name: 'Fixture Realm' },
      character_class: { key: { href: `${API}/data/wow/playable-class/7?namespace=${R_STATIC}` }, id: 7 },
      guild: { key: { href: `${API}${RG}?namespace=${R_PROF}` }, id: 500, name: 'Fixture Guild', slug: 'fixture-guild', realm: { slug: 'fixture-realm', id: 3 } },
      average_item_level: 600, equipped_item_level: 598,
    };
  }
  if (path === `${RC}/achievements/statistics` && ns === R_PROF) {
    return { categories: [
      { id: 1, name: 'Kills', statistics: [{ id: 60, name: 'Fixture kills', quantity: 5 }, { id: 61, name: 'Fixture new kills', quantity: 2 }] },
      { id: 2, name: 'Mythic+', statistics: [{ id: 62, name: 'Fixture keys timed', quantity: 3 }] },
    ] };
  }
  if (path === `${RC}/statistics` && ns === R_PROF) return { health: 9000, strength: { base: 10, effective: 12 }, character: { id: 33, name: 'Fixturo' } };
  if (path === `${RC}/character-media` && ns === R_PROF) return { assets: [{ key: 'main-raw', value: RENDER }] };
  if (path === `${RC}/pvp-summary` && ns === R_PROF) return { honorable_kills: 7, pvp_map_statistics: [{ world_map: { id: 30, name: 'Fixture Valley' }, match_statistics: { played: 4, won: 2 } }] };
  if (path === RG && ns === R_PROF) return { id: 500, name: 'Fixture Guild', member_count: 9, achievement_points: 120 };
  if (path === '/data/wow/realm/index' && ns === R_DYN) {
    return { realms: [{ key: { href: `${API}/data/wow/realm/3?namespace=${R_DYN}` }, id: 3, slug: 'fixture-realm', name: 'Fixture Realm' }, { id: 4, slug: 'fixture-pvp', name: 'Fixture PvP' }, { id: 5, slug: 'fixture-gone', name: 'Fixture Gone' }] };
  }
  if (path === '/data/wow/realm/fixture-realm' && ns === R_DYN) return { id: 3, slug: 'fixture-realm', name: 'Fixture Realm', type: { type: 'NORMAL', name: 'Normal' }, category: 'United States', timezone: 'America/Chicago', locale: 'enUS', is_tournament: false };
  if (path === '/data/wow/realm/fixture-pvp' && ns === R_DYN) return { id: 4, slug: 'fixture-pvp', name: 'Fixture PvP', type: { type: 'PVP', name: 'PvP' }, category: 'United States', timezone: 'America/New_York', locale: 'enUS', is_tournament: false };
  if (path === '/data/wow/realm/3' && ns === R_DYN) return { id: 3, slug: 'fixture-realm', name: 'Fixture Realm', type: { type: 'NORMAL', name: 'Normal' } };
  if (path === '/data/wow/connected-realm/index' && ns === R_DYN) return { connected_realms: [] };
  if (path === '/data/wow/mount/index' && ns === R_STATIC) return { mounts: [{ id: 1 }, { id: 2 }] };
  return [404, { code: 404 }];
}

async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  const auth = init.headers?.Authorization ?? null;
  calls.push({ url: String(url), auth });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.origin === 'https://oauth.battle.net' && u.pathname === '/token') {
    const grant = new URLSearchParams(String(init.body)).get('grant_type');
    return json(grant === 'client_credentials' ? { access_token: APP_TOKEN, expires_in: 86399 } : { access_token: USER_TOKEN, expires_in: 86399, scope: 'openid wow.profile' });
  }
  if (u.origin === 'https://oauth.battle.net' && u.pathname === '/userinfo') return json({ sub: '515151', battletag: 'Fixture#5151' });
  if (u.origin !== API) throw new Error('the test fetch refuses other hosts');
  if (onCall) await onCall(u);
  const ns = u.searchParams.get('namespace');
  const out = isRetail(ns) ? retail(u.pathname, ns, auth) : blizzard(u.pathname, ns, auth, u.searchParams);
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
  const c = t.client();
  assert.equal((await c.put('/api/admin/credentials/blizzard', { clientId: 'fixture-client-id-0002', clientSecret: 'fixture-client-secret-02' }, admin)).status, 200);
  await c.put('/api/admin/settings/discovery.requestsPerSecond', { value: 100 }, admin);
});
after(() => t.close());

async function runQueued() {
  const { discoveryJob } = await import('../worker/jobs.js');
  const job = discoveryJob({ fetch: fakeFetch, sleep: async () => {} });
  await job.run({ db: t.db });
  await job.inFlight();
}
const startProbe = (body = { name: 'Path', surname: 'Vexley', guild: 'Post Nerf Clarity' }) => t.client().post('/api/admin/discovery/probes', body, admin);
const getRun = async (id) => (await t.client().get(`/api/admin/discovery/runs/${id}?skeletons=1`, admin)).json.run;
const entry = (s, id) => s.entries.find((e) => e.id === id);
const answer = (s, id) => s.answers.find((a) => a.id === id);

test('the registry runs in order: every source comes before the entries that take ids from it', () => {
  const seen = new Set();
  for (const e of PROBE_ENDPOINTS) {
    assert.ok(!seen.has(e.id), `duplicate ${e.id}`);
    for (const src of e.from ?? []) assert.ok(seen.has(src), `${e.id} takes ids from ${src}, which runs later or not at all`);
    if (templateParams(e.path).some((p) => !(p in (e.fixed ?? {})))) assert.ok(e.from?.length || e.common?.length, `${e.id} has a {param} and nowhere to get it`);
    seen.add(e.id);
  }
  assert.ok(PROBE_ENDPOINTS.length > 200);
});

test('templates match real links only; dots are literal; an index never stands in for an id', () => {
  const { re } = templateRegex('/data/wow/a.b/{x}');
  assert.ok(re.test('/data/wow/a.b/1'));
  assert.ok(!re.test('/data/wow/aXb/1'));
  assert.ok(!re.test('/data/wow/a.b/1/2'));
  const ctx = { C, G: '/data/wow/guild/g' };
  const e = PROBE_ENDPOINTS.find((x) => x.id === 'data.mount');
  const json = { _links: { self: { href: `${API}/data/wow/mount/index` } }, mounts: [{ key: { href: `${API}/data/wow/mount/6?namespace=${STATIC_NS}` } }] };
  assert.deepEqual(candidatesFrom(e, 'data.mount-index', { json, path: '/data/wow/mount/index', values: {} }, ctx).map((x) => [x.values, x.ns]), [[{ mountId: '6' }, STATIC_NS]]);
  assert.deepEqual(listsOf({ _links: [1], a: [1, 2], b: [] }), { lists: { a: 2, b: 0 }, listKey: 'a', count: 2 });
});

test('probe routes are a plain 404 without an admin session', async () => {
  const c = t.client();
  for (const [m, p] of [['post', '/api/admin/discovery/probes'], ['post', '/api/admin/discovery/runs/1/stop']]) {
    const res = await c[m](p, {});
    assert.equal(res.status, 404, p);
    assert.deepEqual(res.json, { error: 'Not found' });
  }
});

test('without a Battle.net token, protected-character is a recorded skip', async () => {
  const queued = await startProbe();
  assert.equal(queued.status, 201);
  assert.equal(queued.json.run.options.kind, 'probe');
  assert.equal(queued.json.run.options.guild.slug, 'post-nerf-clarity');
  assert.equal((await startProbe()).status, 409); // one run at a time
  await runQueued();
  const run = await getRun(queued.json.run.id);
  assert.equal(run.status, 'done', run.problem);
  assert.match(entry(run.summary, 'account.protected-character').skipped, /needs user token/);
  assert.equal(answer(run.summary, 'by-id').verdict, 'unknown');
});

test('a probe tries every endpoint, takes real ids, records 404s, skips with reasons and answers in words', async () => {
  const c = t.client();
  const start = await c.post('/api/admin/discovery/authorize', {}, admin);
  const state = new URL(start.json.url).searchParams.get('state');
  assert.equal((await c.get(`/auth/battlenet/callback?code=fixture-code&state=${encodeURIComponent(state)}`)).status, 303);

  calls.length = 0;
  const queued = await startProbe();
  await runQueued();
  const run = await getRun(queued.json.run.id);
  assert.equal(run.status, 'done', run.problem);
  const s = run.summary;
  assert.equal(s.kind, 'probe');
  assert.equal(s.entries.length, PROBE_ENDPOINTS.length);
  assert.equal(s.namespaces.staticDetected, STATIC_NS);

  // Real ids from the index's own links, in the namespace the link names.
  assert.equal(entry(s, 'data.mount-index').attempts[0].count, 7);
  assert.deepEqual(entry(s, 'data.mount').attempts.map((a) => [a.path, a.namespace, a.status]), [['/data/wow/mount/6', STATIC_NS, 200]]);
  // A 404 in the static namespace is asked once more in the dynamic one; its ids then use that namespace.
  assert.deepEqual(entry(s, 'data.pet-index').attempts.map((a) => [a.namespace, a.status]), [[STATIC_NS, 404], [DYN, 200]]);
  assert.deepEqual(entry(s, 'data.pet').attempts.map((a) => [a.path, a.namespace, a.status]), [['/data/wow/pet/39', DYN, 200]]);
  // Common values only where nothing lists them, every one tried and recorded.
  assert.deepEqual(entry(s, 'character.pvp-bracket').attempts.map((a) => [a.values.pvpBracket, a.basis.startsWith('common'), a.status]), [['2v2', true, 404], ['3v3', true, 404], ['rbg', true, 404]]);
  // No id, no request: a recorded skip naming why.
  assert.equal(entry(s, 'data.toy').attempts.length, 0);
  assert.match(entry(s, 'data.toy').skipped, /no real toyId to try \(toy-index 404\/404; collections-toys 404\)/);
  assert.match(entry(s, 'data.connected-realm').skipped, /no connected realms/);
  assert.match(entry(s, 'data.auctions-commodities').skipped, /no connected realms/);
  // Search: the minimal query is part of the stored path.
  assert.equal(entry(s, 'search.mount').attempts[0].path, '/data/wow/search/mount?orderby=id&_page=1');
  assert.equal(entry(s, 'search.mount').outcome, 'answered');
  // The user token: protected-character for the primary character (by its id), not the first one listed.
  assert.deepEqual(entry(s, 'account.protected-character').attempts.map((a) => [a.path, a.status]), [['/profile/user/wow/protected-character/0-77', 200]]);

  // Answers in words.
  assert.equal(answer(s, 'catalog-mounts').verdict, 'yes');
  assert.match(answer(s, 'catalog-mounts').text, /7 mounts.*own list has 1/);
  assert.equal(answer(s, 'catalog-pets').verdict, 'yes');
  assert.equal(answer(s, 'catalog-toys').verdict, 'no');
  assert.equal(answer(s, 'sources').verdict, 'yes');
  assert.equal(answer(s, 'legacy').verdict, 'yes');
  assert.equal(answer(s, 'by-id').verdict, 'yes');
  assert.equal(answer(s, 'achievement-points').verdict, 'no'); // zero, although an achievement is listed
  assert.equal(answer(s, 'search').verdict, 'yes');
  assert.equal(answer(s, 'realms').verdict, 'no');
  assert.ok(s.unexpected.some((u) => u.id === 'character.guess-legacy'));
  // Field outlines by response id, and the area totals.
  const legacy = entry(s, 'character.guess-legacy').attempts[0];
  assert.equal(s.skeletons[legacy.responseId].legacy_points, 'number');
  const guesses = s.areas.find((a) => a.id === 'guesses');
  assert.equal(guesses.entries, 20);
  assert.equal(guesses.answered, 1);

  // Tokens: only ever in an Authorization header. Never in a URL, a stored row or the summary.
  for (const x of calls) {
    assert.ok(!x.url.includes(APP_TOKEN) && !x.url.includes(USER_TOKEN));
  }
  const rows = await t.db.query('SELECT path, headers, body FROM discovery_responses WHERE run_id = $1 LIMIT 2000', [run.id]);
  assert.equal(rows.length, s.requests);
  assert.ok(s.requests > 150 && s.requests < 600, `${s.requests} requests`);
  const stored = JSON.stringify(rows) + JSON.stringify(s);
  assert.ok(!stored.includes(APP_TOKEN) && !stored.includes(USER_TOKEN));

  // Exports.
  const csv = await c.get(`/api/admin/discovery/runs/${run.id}/export.csv`, admin);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^area,endpoint_id,template/);
  assert.match(csv.text, /data\.mount-index/);
  const exp = await c.get(`/api/admin/discovery/runs/${run.id}/export.json`, admin);
  assert.equal(exp.status, 200);
  assert.equal(exp.json.raw.length, s.requests);
  assert.ok(exp.json.run.summary.skeletons);

  // A probe isn't a statistics sample: the combined catalog leaves it out, and re-analysing keeps it a probe.
  const all = await c.post('/api/admin/discovery/reanalyse', {}, admin);
  assert.equal(all.status, 200);
  assert.ok(!all.json.combined.runs.includes(Number(run.id)));
  const again = await c.post(`/api/admin/discovery/runs/${run.id}/reanalyse`, {}, admin);
  assert.equal(again.status, 200);
  assert.equal(again.json.run.summary.kind, 'probe');
  assert.equal(again.json.run.summary.requests, s.requests);
});

test('a probe can be stopped: queued it never starts; running it stops before the next request and keeps its results', async () => {
  const c = t.client();
  const q1 = await startProbe();
  const stopped = await c.post(`/api/admin/discovery/runs/${q1.json.run.id}/stop`, {}, admin);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.run.status, 'stopped');
  assert.equal((await c.post(`/api/admin/discovery/runs/${q1.json.run.id}/stop`, {}, admin)).status, 409);

  const q2 = await startProbe();
  onCall = async (u) => {
    if (u.pathname === '/data/wow/mount/index') await t.db.query('UPDATE discovery_runs SET stop_requested_at = now() WHERE id = $1', [q2.json.run.id]);
  };
  await runQueued();
  onCall = null;
  const run = await getRun(q2.json.run.id);
  assert.equal(run.status, 'stopped');
  assert.ok(run.summary.stopped);
  assert.equal(entry(run.summary, 'data.mount-index').outcome, 'answered');
  assert.equal(entry(run.summary, 'data.mount').outcome, 'not asked');
  assert.equal(entry(run.summary, 'character.guess-legacy').outcome, 'not asked');

  // A discovery run is not a probe: it can't be stopped here.
  const plain = await t.db.one("INSERT INTO discovery_runs (status, options) VALUES ('done', '{}'::jsonb) RETURNING id");
  assert.equal((await c.post(`/api/admin/discovery/runs/${plain.id}/stop`, {}, admin)).json.code, 'not_probe');
});

test('0.10.0: a Retail probe (a realm version, disabled for players): realm paths, its own namespaces, every realm, Forever compared, nothing stored', async () => {
  const c = t.client();
  // Forever's production catalog (fixtures) and a Forever group choice, to compare against.
  await t.db.query(`INSERT INTO statistics (id, name, category_path, blizzard_id) VALUES (60, 'Fixture kills', '[{"id":1,"name":"Kills"}]'::jsonb, 60), (70, 'Fixture forever only', '[{"id":9,"name":"Character"}]'::jsonb, 70) ON CONFLICT DO NOTHING`);
  await t.db.query("INSERT INTO discovery_group_decisions (game_version, group_label, choice) VALUES ('forever', 'Combat', 'counts')");
  const counts = async () => Object.fromEntries(await Promise.all(['characters', 'statistics', 'discovery_decisions', 'discovery_group_decisions', 'guilds', 'rulesets', 'realms', 'blizzard_ids'].map(async (tb) => [tb, (await t.db.one(`SELECT count(*)::int AS n FROM ${tb}`)).n])));
  const before = await counts();

  // The prefill: the admin's own Retail characters (the Discovery grant from the earlier test), highest level first.
  const pre = await c.get('/api/admin/discovery/probe-characters?version=retail&region=us', admin);
  assert.equal(pre.status, 200, JSON.stringify(pre.json));
  assert.equal(pre.json.characters.length, 2);
  assert.deepEqual([pre.json.pick.name, pre.json.pick.realmSlug, pre.json.pick.level], ['Fixturo', 'fixture-realm', 80]);
  assert.deepEqual(pre.json.guild, { name: 'Fixture Guild', slug: 'fixture-guild', realmSlug: 'fixture-realm' });
  // No such version, or a region Everstats doesn't cover: refused.
  assert.equal((await c.get('/api/admin/discovery/probe-characters?version=nope&region=us', admin)).status, 400);
  assert.equal((await c.get('/api/admin/discovery/probe-characters?version=retail&region=eu', admin)).status, 400);
  // A realm version needs a realm.
  assert.equal((await startProbe({ version: 'retail', region: 'us', name: 'Fixturo', guild: 'Fixture Guild' })).status, 400);

  calls.length = 0;
  const queued = await startProbe({ version: 'retail', region: 'us', name: 'Fixturo', realm: 'Fixture Realm', guild: 'Fixture Guild' });
  assert.equal(queued.status, 201, JSON.stringify(queued.json));
  assert.deepEqual(queued.json.run.options.primary, { name: 'Fixturo', surname: '', realmSlug: 'fixture-realm', slug: 'fixturo' });
  const row = await t.db.one('SELECT game_version, region FROM discovery_runs WHERE id = $1', [queued.json.run.id]);
  assert.deepEqual(row, { game_version: 'retail', region: 'us' });
  await runQueued();
  const run = await getRun(queued.json.run.id);
  assert.equal(run.status, 'done', run.problem);
  const s = run.summary;
  assert.equal(s.version, 'retail');
  assert.equal(s.namespaces.profile, 'profile-us');
  assert.equal(s.namespaces.dynamic, 'dynamic-us');
  assert.equal(s.namespaces.staticDetected, R_STATIC);
  // Realm paths; no Forever namespace or Forever-only guess asked.
  assert.equal(entry(s, 'character.profile').attempts[0].path, RC);
  assert.equal(entry(s, 'guild.profile').attempts[0].path, RG);
  assert.ok(!s.entries.some((e) => e.id.includes('guess')));
  assert.ok(!calls.some((x) => /forever/.test(x.url)), 'nothing asked in a Forever namespace');
  assert.ok(!s.answers.some((a) => a.id === 'legacy'));

  // Every realm realm/index lists, with its type; one that 404s is recorded as such.
  assert.equal(s.realms.asked, 3);
  assert.equal(s.realms.answered, 2);
  assert.deepEqual(s.realms.byType.map((x) => [x.value, x.realms]), [['NORMAL (Normal)', 1], ['PVP (PvP)', 1]]);
  assert.equal(s.realms.realms.find((r) => r.slug === 'fixture-gone').status, 404);
  assert.equal(s.answers.find((a) => a.id === 'realm-categories').verdict, 'yes');
  assert.match(s.answers.find((a) => a.id === 'realm-categories').text, /NORMAL \(Normal\): 1 realm/);

  // Statistics compared with Forever's: 60 shared, 61 and 62 new, 70 missing.
  assert.deepEqual([s.statistics.probed, s.statistics.shared, s.statistics.sharedSameName, s.statistics.new.length], [3, 1, 1, 2]);
  assert.ok(s.statistics.missing.some((m) => m.id === 70));
  assert.deepEqual(s.statistics.categories.onlyHere, ['Mythic+']);
  // Groups with Forever's choice as a suggestion, never applied; Mythic+ is a proposed new group.
  const combat = s.groups.find((g) => g.label === 'Combat');
  assert.equal(combat.forever.choice, 'counts');
  assert.match(combat.suggestion, /Forever counts this group · 1 of 2 statistic ids match/);
  assert.equal(combat.applied, false);
  assert.equal(s.groups.find((g) => g.label === 'Mythic+').proposed, true);

  // Boards (rule A7): one per statistic id, the feeds' numbers, the PvP family once; ids and texts skipped with reasons.
  const keys = s.boards.list.map((b) => b.key);
  for (const k of ['statistic:60', 'statistic:62', 'feed:statistics:health', 'feed:profile:average_item_level', 'collections:pvp:honorable_kills', 'feed:pvp-summary:pvp_map_statistics[world_map-30].match_statistics.won', 'feed:guild-profile:achievement_points']) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(!keys.includes('feed:pvp-summary:honorable_kills'), 'the PvP family board is not counted twice');
  assert.ok(s.boards.skipped.some((x) => x.feed === 'statistics' && x.path === 'character.id' && x.rule === 'id'));
  assert.ok(s.boards.groups.some((g) => g.group === 'PvP'));
  assert.equal(s.answers.find((a) => a.id === 'boards').verdict, 'yes');

  // Renders: the URL beside Blizzard's race, unknown until the admin looks; the tick is kept through a re-analyse.
  assert.equal(s.render.race, 'Orc');
  assert.equal(s.render.main, RENDER);
  assert.equal(s.answers.find((a) => a.id === 'renders').verdict, 'unknown');
  const ticked = await c.post(`/api/admin/discovery/runs/${run.id}/render-check`, { verdict: 'wrong' }, admin);
  assert.equal(ticked.status, 200);
  assert.equal(ticked.json.run.summary.answers.find((a) => a.id === 'renders').verdict, 'no');
  const again = await c.post(`/api/admin/discovery/runs/${run.id}/reanalyse`, {}, admin);
  assert.equal(again.json.run.summary.render.verdict, 'wrong');
  assert.equal((await c.post(`/api/admin/discovery/runs/${run.id}/render-check`, { verdict: 'maybe' }, admin)).status, 400);

  // Exports: the boards CSV lists boards, skipped fields and realms.
  const csv = await c.get(`/api/admin/discovery/runs/${run.id}/export-boards.csv`, admin);
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^section,key_or_path/);
  assert.match(csv.text, /board,statistic:62/);
  assert.match(csv.text, /skipped,/);
  assert.match(csv.text, /realm,fixture-pvp,Fixture PvP,PVP \(PvP\)/);
  const exp = await c.get(`/api/admin/discovery/runs/${run.id}/export.json`, admin);
  assert.ok(exp.json.run.summary.boards.list.length > 5);

  // Nothing written outside the probe's own records: no character, statistic, decision, group choice, guild,
  // realm category, realm or id mapping.
  assert.deepEqual(await counts(), before);
});
