import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { PRIORITY } from '../crawler/queue.js';

// 0.10.0: game versions and regions. A second (disabled) version, enabled for this file only, with a realm-based
// character whose Blizzard id, statistic ids and guild id are THE SAME numbers as a Forever character's: nothing may
// collide, nothing may leak between versions, and Forever's boards must not move. Every name here is a test fixture.
const API = 'https://us.api.blizzard.com';
const calls = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stat = (id, name, quantity) => ({ id, name, quantity, last_updated_timestamp: 1794000000000 });
const statsDoc = (deaths, kills) => ({
  categories: [
    { id: 122, name: 'Deaths', statistics: [stat(60, 'Total deaths', deaths)] },
    { id: 128, name: 'Kills', sub_categories: [{ id: 135, name: 'Creatures', statistics: [stat(107, 'Creatures killed', kills)] }] },
  ],
});
const SAME_ID = 4242; // the Forever character's id, the Retail character's id, and both guilds' id

async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  const ns = u.searchParams.get('namespace');
  calls.push({ path: u.pathname, ns });
  if (u.href === 'https://oauth.battle.net/token') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
  if (u.origin !== API) return json(404, {});
  // ---- Forever (realmless): profile-forever-us
  if (ns === 'profile-forever-us' && u.pathname.startsWith('/profile/wow/character/vexa-fixture')) {
    const sub = u.pathname.slice('/profile/wow/character/vexa-fixture'.length);
    if (sub === '') {
      return json(200, {
        _links: { self: { href: `${API}/profile/wow/character/vexa-fixture?namespace=profile-forever-us` } },
        id: SAME_ID, name: 'Vexa', surname: 'Fixture', level: 30, faction: { name: 'Horde' }, race: { name: 'Undead' }, character_class: { name: 'Priest' },
        ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000, guild: { id: SAME_ID, name: 'Fixture Guild', slug: 'fixture-guild' },
      });
    }
    if (sub === '/achievements/statistics') return json(200, statsDoc(3, 900));
    if (sub === '/statistics') return json(200, { health: 400 });
    if (sub === '/equipment') return json(200, { equipped_items: [] });
    if (sub === '/character-media') return json(404, {});
    return json(404, {});
  }
  // ---- Retail (realms): profile-us / dynamic-us
  if (ns === 'dynamic-us' && u.pathname === '/data/wow/realm/area-52') return json(200, { id: 3676, name: 'Area 52', slug: 'area-52', type: { type: 'NORMAL', name: 'Normal' } });
  if (ns === 'profile-us' && u.pathname.startsWith('/profile/wow/character/area-52/thrall')) {
    const sub = u.pathname.slice('/profile/wow/character/area-52/thrall'.length);
    if (sub === '') {
      return json(200, {
        _links: { self: { href: `${API}/profile/wow/character/area-52/thrall?namespace=profile-us` } },
        id: SAME_ID, name: 'Thrall', level: 80, faction: { name: 'Horde' }, race: { name: 'Orc' }, character_class: { name: 'Shaman' },
        realm: { id: 3676, name: 'Area 52', slug: 'area-52' }, last_login_timestamp: 1794100000000,
        guild: { id: SAME_ID, name: 'Fixture Guild', slug: 'fixture-guild', realm: { id: 3676, slug: 'area-52', name: 'Area 52' } },
      });
    }
    if (sub === '/achievements/statistics') return json(200, statsDoc(999, 5));
    if (sub === '/statistics') return json(200, { health: 9000 });
    if (sub === '/equipment') return json(200, { equipped_items: [] });
    if (sub === '/character-media') return json(404, {});
    return json(404, {});
  }
  return json(404, {});
}

let t;
let crawler;
before(async () => {
  const { enableVersionForTests } = await import('../core/gameVersions.js');
  enableVersionForTests('retail');
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  const { createCrawler } = await import('../crawler/service.js');
  crawler = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await crawler.start();
});
after(async () => {
  await crawler.stop();
  await t.close();
  const { enableVersionForTests } = await import('../core/gameVersions.js');
  enableVersionForTests('retail', false);
});

async function fetchItem(item) {
  const { enqueue, waitFor } = await import('../crawler/queue.js');
  const row = await enqueue(t.db, item);
  const done = await waitFor(t.db, row.id, { timeoutMs: 20_000 });
  assert.equal(done?.state, 'done', JSON.stringify(done));
  return done;
}

test('the registry: namespaces, static patterns, paths, and only the primary version and US enabled', async () => {
  const gv = await import('../core/gameVersions.js');
  const ns = (v) => gv.blizzardContext(v, 'us').namespaces;
  assert.deepEqual(ns('forever'), { profile: 'profile-forever-us', dynamic: 'dynamic-forever-us' });
  assert.deepEqual(ns('retail'), { profile: 'profile-us', dynamic: 'dynamic-us' });
  assert.deepEqual(ns('classic'), { profile: 'profile-classic-us', dynamic: 'dynamic-classic-us' });
  assert.deepEqual(ns('classic-era'), { profile: 'profile-classic1x-us', dynamic: 'dynamic-classic1x-us' });
  assert.deepEqual(ns('classic-anniversary'), { profile: 'profile-classicann-us', dynamic: 'dynamic-classicann-us' });
  // Static: only ever detected, and each pattern takes its own version's namespace only.
  assert.equal(gv.isStaticNamespace('forever', 'us', 'static-1.60.1_70399-forever-us'), true);
  assert.equal(gv.isStaticNamespace('retail', 'us', 'static-us'), true);
  assert.equal(gv.isStaticNamespace('retail', 'us', 'static-classic-us'), false);
  assert.equal(gv.isStaticNamespace('classic', 'us', 'static-classic1x-us'), false);
  assert.equal(gv.versionOfNamespace('static-2.5.4_44833-classicann-us')?.version, 'classic-anniversary');
  assert.equal(gv.blizzardContext('retail', 'us').characterPath({ realmSlug: 'area-52', slug: 'thrall' }), '/profile/wow/character/area-52/thrall');
  assert.equal(gv.blizzardContext('forever', 'us').characterPath({ slug: 'vexa-fixture' }), '/profile/wow/character/vexa-fixture');
  assert.throws(() => gv.blizzardContext('retail', 'us').characterPath({ slug: 'thrall' }));
  // Only the primary version is on for players (retail is on in THIS file only, through the test hook).
  assert.deepEqual(gv.GAME_VERSIONS.filter((v) => v.enabled).map((v) => v.id), [gv.PRIMARY_VERSION.id]);
  assert.deepEqual(gv.REGIONS.filter((r) => r.enabled).map((r) => r.id), ['us']);
  assert.equal(gv.PRIMARY_VERSION.nativeIds, true);
});

test('no namespace, version or region string is written outside the registry, config and migrations', () => {
  const root = join(import.meta.dirname, '..', '..');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (['node_modules', 'dist', 'kit', 'test', 'fonts', 'art'].includes(name)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(name)) files.push(p);
    }
  };
  for (const d of ['server', join('client', 'src'), 'scripts']) walk(join(root, d));
  // Allowed: the registry itself, and the shipped migration 027 with its measurement (the historical backfill literals:
  // every row before 0.10.0 was Forever in the US, written once, like every shipped migration).
  const ALLOWED = new Set(['server/core/gameVersions.js', 'server/core/schema.js', 'scripts/measure-migration-027.js']);
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
  const NAMESPACE = /\b(?:profile|dynamic|static)-(?:[0-9][\w.]*-)?(?:forever|classic1x|classicann|classic)?-?(?:us|eu|kr|tw)\b/;
  const VERSION_ID = /['"`](?:retail|classic-era|classic-anniversary|classic1x|classicann)['"`]/;
  const REGION_ID = /['"`](?:us|eu|kr|tw)['"`]/;
  const API_HOST = /\b(?:us|eu|kr|tw)\.api\.blizzard\.com\b/;
  const found = [];
  for (const f of files) {
    const rel = relative(root, f).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const [what, re] of [['namespace', NAMESPACE], ['version id', VERSION_ID], ['region id', REGION_ID], ['API host', API_HOST]]) {
      const line = code.split('\n').find((l) => re.test(l));
      if (line) found.push(`${rel}: ${what}: ${line.trim().slice(0, 100)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('a realm character with the SAME Blizzard ids as a Forever one: two characters, two catalogs, no leak', async () => {
  await fetchItem({ key: 'vexa-fixture', priority: PRIORITY.lookup, mode: 'full' });
  const mark = calls.length;
  await fetchItem({ key: 'area-52/thrall', priority: PRIORITY.lookup, mode: 'full', version: 'retail', region: 'us' });
  // Retail was asked in Retail's namespaces, at realm paths: never a Forever namespace.
  // (Forever's own guild roster, queued by the Forever fetch, may interleave: it is Forever's, in Forever's namespace.)
  const asked = calls.slice(mark).filter((c) => /area-52|thrall/.test(c.path));
  assert.ok(asked.length >= 6);
  assert.ok(asked.every((c) => c.ns === 'profile-us' || c.ns === 'dynamic-us'), JSON.stringify(asked));
  assert.ok(calls.slice(mark).every((c) => !/forever/.test(c.ns ?? '') || !/area-52|thrall/.test(c.path)));
  assert.ok(asked.some((c) => c.path === '/profile/wow/character/area-52/thrall'));
  assert.ok(asked.some((c) => c.path === '/data/wow/realm/area-52'));

  const rows = await t.db.query('SELECT id, game_version, region, realm_slug, blizzard_id, slug, guild_id, ruleset_id FROM characters ORDER BY id');
  assert.equal(rows.length, 2);
  const [forever, retail] = rows;
  assert.deepEqual([forever.id, forever.game_version, forever.realm_slug, forever.blizzard_id], [SAME_ID, 'forever', null, SAME_ID]);
  assert.equal(retail.game_version, 'retail');
  assert.equal(retail.realm_slug, 'area-52');
  assert.equal(retail.blizzard_id, SAME_ID);
  assert.ok(retail.id >= 1e15 && Number.isSafeInteger(retail.id), `allocated id ${retail.id}`);
  // Two guilds with one Blizzard id, two realm categories (Forever's ruleset; Retail's realm type).
  assert.notEqual(forever.guild_id, retail.guild_id);
  assert.equal(forever.guild_id, SAME_ID);
  const cats = await t.db.query('SELECT id, game_version, category_key, name FROM rulesets ORDER BY id');
  assert.deepEqual(cats.map((c) => [c.game_version, c.category_key]), [['forever', null], ['retail', 'NORMAL']]);
  assert.notEqual(forever.ruleset_id, retail.ruleset_id);

  // The same statistic id is two statistics: Forever's keeps Blizzard's id, Retail's an allocated one.
  const stats = await t.db.query("SELECT id, game_version, blizzard_id FROM statistics WHERE derived IS NULL AND blizzard_id = 60 ORDER BY id");
  assert.equal(stats.length, 2);
  assert.deepEqual([stats[0].id, stats[0].game_version], [60, 'forever']);
  assert.equal(stats[1].game_version, 'retail');
  assert.ok(stats[1].id >= 1e9 && stats[1].id < 2e9);

  // Forever's board for "Total deaths": only Forever's character, its own value (3, never Retail's 999).
  const { boardPage, statCounts } = await import('../stats/boards.js');
  const page = await boardPage(t.db, { statisticId: 60, rulesetId: forever.ruleset_id });
  assert.deepEqual(page.rows.map((r) => [Number(r.character_id ?? r.characterId ?? r.id), r.value]), [[SAME_ID, 3]]);
  assert.equal((await statCounts(t.db, { statisticId: 60, rulesetId: forever.ruleset_id })).population, 1);
  // Forever's catalog has none of Retail's statistics; Retail's none of Forever's.
  const { loadCatalogFresh } = await import('../stats/catalog.js');
  const fc = await loadCatalogFresh(t.db);
  const rc = await loadCatalogFresh(t.db, { version: 'retail' });
  assert.ok([...fc.statistics.keys()].every((id) => id < 1e9 || id >= 2e9));
  assert.ok([...rc.statistics.values()].every((s) => s.id !== 60));
  // Feed boards (rule A7) are per version too: "Health (character stats)" exists once per version.
  const health = await t.db.query("SELECT game_version, name FROM statistics WHERE derived = 'feed:statistics:health' ORDER BY game_version");
  assert.deepEqual(health.map((h) => h.game_version), ['forever', 'retail']);

  // The Forever page: one character at its old address, Retail nowhere in it.
  const res = await t.client().get('/api/characters/vexa-fixture');
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.character.name, 'Vexa');
  const search = await t.client().get('/api/search?q=thr');
  assert.ok(!JSON.stringify(search.json ?? {}).includes('Thrall'));
});

test('a disabled version is never queued, claimed or asked', async () => {
  const { enqueue } = await import('../crawler/queue.js');
  await assert.rejects(enqueue(t.db, { key: 'stormrage/someone', priority: PRIORITY.lookup, version: 'classic', region: 'us' }), /not enabled/);
  await assert.rejects(crawler.client.request('profile', '/profile/wow/character/x/y', { version: 'classic', region: 'us', namespace: 'profile-classic-us' }), /not enabled/);
});

test('URLs: every Forever URL as before; /{version}/{region}/… is 404 while a version is off; the primary prefix redirects', async () => {
  const c = t.client();
  const r1 = await c.get('/classic/us/c/stormrage/someone');
  assert.equal(r1.status, 404);
  const r2 = await c.get('/retail/us/c/area-52/thrall'); // enabled in this file, but not built until 0.11.0
  assert.equal(r2.status, 404);
  const r3 = await c.get('/forever/us/c/vexa-fixture?x=1');
  assert.equal(r3.status, 301);
  assert.equal(r3.headers.get('location'), '/c/vexa-fixture?x=1');
  assert.equal((await c.get('/api/v/classic/us/characters/x')).status, 404);
  // No client route's first segment is a version id (the prefix can never shadow a page).
  const app = readFileSync(join(import.meta.dirname, '..', '..', 'client', 'src', 'App.jsx'), 'utf8');
  const roots = new Set([...app.matchAll(/path="([a-z0-9-]+)/g)].map((m) => m[1]));
  const { VERSION_IDS } = await import('../core/gameVersions.js');
  assert.deepEqual(VERSION_IDS.filter((v) => roots.has(v)), []);
});

test('tier settings are per version: the primary keeps its row; another version starts at the default', async () => {
  const { getSetting, setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'grading.minPopulation', 77);
  await setSetting(t.db, 'grading.minPopulation', 12, { version: 'retail' });
  assert.equal(await getSetting(t.db, 'grading.minPopulation'), 77);
  assert.equal(await getSetting(t.db, 'grading.minPopulation', { version: 'forever' }), 77);
  assert.equal(await getSetting(t.db, 'grading.minPopulation', { version: 'retail' }), 12);
  assert.equal(await getSetting(t.db, 'grading.minPopulation', { version: 'classic' }), 50);
  const keys = (await t.db.query("SELECT key FROM settings WHERE key LIKE 'grading.minPopulation%' ORDER BY key")).map((r) => r.key);
  assert.deepEqual(keys, ['grading.minPopulation', 'grading.minPopulation@retail']);
});

test('budget: a version share is a ceiling; the primary version keeps its rate; lookups still go first', async () => {
  const { createBudget } = await import('../crawler/budget.js');
  let clock = 0;
  const timers = [];
  const budget = createBudget({ perSecond: 10, now: () => clock, setTimer: (fn, ms) => timers.push({ fn, at: clock + ms }), clearTimer: () => {}, versionShares: () => ({ forever: 1, retail: 0.25 }) });
  const started = [];
  for (let i = 0; i < 8; i++) budget.take(PRIORITY.daily, 'retail').then(() => started.push(['retail', clock]));
  for (let i = 0; i < 8; i++) budget.take(PRIORITY.daily, 'forever').then(() => started.push(['forever', clock]));
  budget.take(PRIORITY.lookup, 'retail').then(() => started.push(['retail-lookup', clock]));
  for (let i = 0; i < 200 && started.length < 17; i++) {
    await new Promise((r) => setImmediate(r));
    timers.sort((a, b) => a.at - b.at);
    const tm = timers.shift();
    if (!tm) continue;
    clock = Math.max(clock, tm.at);
    tm.fn();
  }
  await new Promise((r) => setImmediate(r));
  const inFirstSecond = (v) => started.filter(([x, at]) => x === v && at < 1000).length;
  // Retail: at most a quarter of 10/s (its lookup included); Forever: everything else it asked for.
  assert.ok(inFirstSecond('retail') + inFirstSecond('retail-lookup') <= 3, JSON.stringify(started));
  assert.ok(inFirstSecond('forever') >= 7, JSON.stringify(started));
  // The retail lookup, queued after eight retail daily requests, goes before all but the one already started.
  const order = started.map(([x]) => x).filter((x) => x.startsWith('retail'));
  assert.equal(order.indexOf('retail-lookup'), 1, JSON.stringify(started));
});

test('server modules the CLIENT imports stay browser-safe: no node: module and no core/config.js, transitively', () => {
  // 0.10.0: queue.js briefly imported core/config.js (node:url), and every page of the built client was blank.
  const root = join(import.meta.dirname, '..', '..');
  const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1]);
  const clientFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(name)) clientFiles.push(p);
    }
  };
  walk(join(root, 'client', 'src'));
  const seen = new Set();
  const bad = [];
  const visit = (file, via) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) {
        if (spec.startsWith('node:') || ['fs', 'path', 'url', 'crypto', 'pg'].includes(spec)) bad.push(`${relative(root, file)} imports ${spec} (via ${via})`);
        continue;
      }
      const next = join(file, '..', spec);
      if (relative(root, next).split(String.fromCharCode(92)).join('/') === 'server/core/config.js') bad.push(`${relative(root, file)} imports core/config.js (via ${via})`);
      else visit(next, via);
    }
  };
  for (const f of clientFiles) {
    for (const spec of importsOf(f)) if (spec.includes('/server/')) visit(join(f, '..', spec), relative(root, f));
  }
  assert.deepEqual(bad, []);
});
