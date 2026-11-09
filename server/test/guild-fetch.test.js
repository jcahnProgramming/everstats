import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';
import { BUDGET_SHARES, PRIORITY } from '../crawler/queue.js';

// "Fetch all members" (0.9.0). A fake Blizzard shaped like the guild and character responses discovery runs 1 and 2
// stored. Every name here is a test fixture, never shipped data.
const API = 'https://us.api.blizzard.com';
const calls = [];
const world = { characters: new Map(), guilds: new Map() };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function addGuild(slug, id, members) {
  world.guilds.set(slug, { id, slug, name: slug.replace(/-/g, ' '), members });
  for (const [mslug, level, mid, opts = {}] of members) {
    if (!opts.missing) world.characters.set(mslug, { id: mid, slug: mslug, level, guild: slug });
  }
}

async function fakeFetch(url) {
  const u = new URL(String(url));
  calls.push(u.pathname);
  if (u.href === 'https://oauth.battle.net/token') return json(200, { access_token: 'app-token-fixture', expires_in: 86399 });
  if (u.origin !== API) return json(404, {});
  const gm = /^\/data\/wow\/guild\/([^/]+)(\/roster)?$/.exec(u.pathname);
  if (gm) {
    const g = world.guilds.get(decodeURIComponent(gm[1]));
    if (!g) return json(404, {});
    if (gm[2]) {
      return json(200, {
        members: g.members.map(([slug, level, id]) => {
          const [name, surname] = slug.split('-');
          return { character: { key: { href: `${API}/profile/wow/character/${slug}?namespace=profile-forever-us` }, name, surname, id, level, slug }, rank: 3 };
        }),
      });
    }
    return json(200, { id: g.id, name: g.name, slug: g.slug, faction: { type: 'HORDE', name: 'Horde' }, member_count: g.members.length, created_timestamp: 1793847870000, ruleset: { name: 'Normal', id: 2 } });
  }
  const m = /^\/profile\/wow\/character\/([^/]+)(\/.*)?$/.exec(u.pathname);
  const c = m ? world.characters.get(decodeURIComponent(m[1])) : null;
  if (!c) return json(404, {});
  const sub = m[2] ?? '';
  const g = world.guilds.get(c.guild);
  if (sub === '') {
    const [name, surname] = c.slug.split('-');
    return json(200, {
      _links: { self: { href: `${API}/profile/wow/character/${c.slug}?namespace=profile-forever-us` } },
      id: c.id, name, surname, level: c.level, faction: { type: 'HORDE', name: 'Horde' }, race: { name: 'Orc' }, character_class: { name: 'Warrior' },
      ruleset: { id: 2, name: 'Normal' }, last_login_timestamp: 1794100000000, guild: { id: g.id, name: g.name, slug: g.slug },
    });
  }
  if (sub === '/achievements/statistics') return json(200, { categories: [{ id: 128, name: 'Kills', statistics: [{ id: 107, name: 'Creatures killed', quantity: 10, last_updated_timestamp: 1794000000000 }] }] });
  if (sub === '/statistics') return json(200, { health: 400 });
  if (sub === '/equipment') return json(200, { equipped_items: [] });
  return json(404, {});
}

let t;
let crawler;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'crawler.requestsPerSecond', 50);
  // Paused to start with: the roster read (a person waiting, priority 1) runs anyway; a guild fetch waits.
  await setSetting(t.db, 'crawler.paused', true);
  const { createCrawler } = await import('../crawler/service.js');
  crawler = createCrawler({ db: t.db, fetch: fakeFetch, log: { error() {}, warn() {} } });
  await crawler.start();
});
after(async () => {
  await crawler.stop();
  await t.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs the worker job until the guild's fetch is done (or gives up). */
async function driveUntilDone(slug, tries = 200) {
  const { runGuildFetches } = await import('../guilds/fetchAll.js');
  for (let i = 0; i < tries; i++) {
    await runGuildFetches(t.db);
    const s = (await t.client({ ip: '198.51.100.90' }).get(`/api/guilds/${slug}/fetch-all`)).json;
    if (s.state === 'done') return s;
    await sleep(50);
  }
  throw new Error('the guild fetch never finished');
}

// "Big": 2 tracked already, 4 untracked level 10+, one of them hidden by its player, one Blizzard 404s, 1 under 10.
const BIG = [
  ['ana-fixture', 30, 3001], ['bo-fixture', 30, 3002], ['cy-fixture', 30, 3003], ['di-fixture', 25, 3004],
  ['ed-fixture', 20, 3005, { missing: true }], ['flo-fixture', 30, 3006], ['gus-fixture', 5, 3007],
];

test('step 1 reads the roster (2 requests) and shows the counts and the cost; nothing else is asked yet', async () => {
  addGuild('big-guild', 900, BIG);
  const { fetchCharacter } = await import('../crawler/fetch.js');
  const ctx = { db: t.db, client: crawler.client };
  for (const slug of ['ana-fixture', 'bo-fixture', 'flo-fixture']) await fetchCharacter(ctx, { key: slug, priority: PRIORITY.lookup, mode: 'full' });
  const { setHidden } = await import('../crawler/store.js');
  await t.db.tx((q) => setHidden(q, 3006, true)); // flo: hidden by their player

  const c = t.client({ ip: '198.51.100.40' });
  assert.equal((await c.get('/api/guilds/big-guild/fetch-all')).json.state, 'idle');
  const mark = calls.length;
  const r = await c.post('/api/guilds/big-guild/fetch-all/roster');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.state, 'ready');
  assert.equal(calls.slice(mark).filter((p) => p.startsWith('/data/wow/guild/')).length, 2);
  assert.equal(calls.slice(mark).filter((p) => p.startsWith('/profile/')).length, 0);
  // 7 on the roster · 2 tracked · 3 to fetch (cy, di, ed; flo is hidden, so in no count) · 1 under level 10
  assert.deepEqual(r.json.counts, { roster: 7, tracked: 2, toFetch: 3, underTen: 1 });
  assert.equal(r.json.cost.requests, 15);
  assert.equal(r.json.perSecond, 50 * BUDGET_SHARES[PRIORITY.guild]);
  // The work list holds no hidden character.
  const listed = (await t.db.query('SELECT character_id FROM guild_fetch_members ORDER BY 1')).map((x) => Number(x.character_id));
  assert.deepEqual(listed, [3003, 3004, 3005]);
});

test('the POST passes the Origin check like every write', async () => {
  const r = await t.client({ ip: '198.51.100.41', origin: null }).post('/api/guilds/big-guild/fetch-all/start');
  assert.equal(r.status, 403);
});

test('step 2 queues it; paused it waits; then members are fetched at guild priority, 404s recorded, and the guild recomputes', async () => {
  const c = t.client({ ip: '198.51.100.42' });
  const started = await c.post('/api/guilds/big-guild/fetch-all/start');
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.state, 'queued');
  // Pressing it again shows the same fetch.
  assert.equal((await c.post('/api/guilds/big-guild/fetch-all/start')).json.state, 'queued');
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM guild_fetches WHERE guild_id = 900')).n, 1);

  const { runGuildFetches } = await import('../guilds/fetchAll.js');
  assert.match(await runGuildFetches(t.db), /Paused/);
  assert.equal((await c.get('/api/guilds/big-guild/fetch-all')).json.paused, true);

  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'crawler.paused', false);
  await runGuildFetches(t.db);
  const running = (await c.get('/api/guilds/big-guild/fetch-all')).json;
  assert.equal(running.state, 'running');
  assert.equal(running.progress.total, 3);
  const items = await t.db.query("SELECT key, priority FROM crawl_queue WHERE kind = 'character' AND key = ANY($1::text[]) LIMIT 10", [['cy-fixture', 'di-fixture', 'ed-fixture']]);
  assert.ok(items.length > 0 && items.every((i) => i.priority === PRIORITY.guild));

  const done = await driveUntilDone('big-guild');
  assert.equal(done.result.added, 2); // cy and di; ed 404'd
  assert.equal(done.result.notFound, 1);
  assert.equal(done.result.fetched, 2);
  assert.ok(done.availableAt);
  assert.equal((await t.db.one('SELECT hidden FROM characters WHERE id = 3006')).hidden, true, 'a hidden character stays hidden');
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM guild_fetch_members')).n, 0, 'the work list is deleted when the fetch ends');
  assert.ok((await t.db.one('SELECT totals_dirty_at FROM guilds WHERE id = 900')).totals_dirty_at, 'guild totals rebuild');
  assert.ok(await t.db.one("SELECT 1 AS x FROM tier_runs WHERE status = 'pending' AND 'guild fetch' = ANY(reasons)"), 'a tier grading is requested');
  const acts = await t.db.query("SELECT kind, sum(n)::int AS n FROM activity_counts WHERE kind LIKE 'guild.fetch%' GROUP BY kind ORDER BY kind");
  assert.deepEqual(acts.map((a) => [a.kind, a.n]), [['guild.fetch', 1], ['guild.fetch.members', 3]]);
});

test('after a fetch the guild rests for the cooldown; the button says when it opens', async () => {
  const c = t.client({ ip: '198.51.100.43' });
  const r = await c.post('/api/guilds/big-guild/fetch-all/roster');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'cooldown');
  await t.db.query("UPDATE guild_fetches SET finished_at = now() - interval '1 hour' WHERE guild_id = 900");
  const s = (await c.get('/api/guilds/big-guild/fetch-all')).json;
  assert.equal(s.state, 'cooldown');
  assert.equal(Math.round((Date.parse(s.availableAt) - Date.now()) / 3_600_000), 5);
  await t.db.query("UPDATE guild_fetches SET finished_at = now() - interval '7 hours' WHERE guild_id = 900");
  assert.equal((await c.get('/api/guilds/big-guild/fetch-all')).json.state, 'idle');
});

test('a site-wide cap: the rest wait their turn and say how many guilds are ahead', async () => {
  const { setSetting } = await import('../admin/settings.js');
  await setSetting(t.db, 'guilds.fetchConcurrent', 1);
  await setSetting(t.db, 'crawler.paused', true); // keep them from finishing while we look
  addGuild('one-guild', 901, [['ha-fixture', 30, 4001], ['io-fixture', 30, 4002]]);
  addGuild('two-guild', 902, [['ju-fixture', 30, 4003]]);
  for (const slug of ['one-guild', 'two-guild']) {
    const c = t.client({ ip: '198.51.100.44' });
    assert.equal((await c.get(`/api/guilds/${slug}`)).json.status, 'ok'); // the page's own look-up
    assert.equal((await c.post(`/api/guilds/${slug}/fetch-all/roster`)).json.state, 'ready');
    assert.equal((await c.post(`/api/guilds/${slug}/fetch-all/start`)).json.state, 'queued');
  }
  await t.db.query("UPDATE guild_fetches SET state = 'running', started_at = now() WHERE guild_id = 901");
  const s = (await t.client({ ip: '198.51.100.45' }).get('/api/guilds/two-guild/fetch-all')).json;
  assert.equal(s.state, 'queued');
  assert.equal(s.ahead, 1);
  await setSetting(t.db, 'crawler.paused', false);
  await driveUntilDone('one-guild');
  await driveUntilDone('two-guild');
  await setSetting(t.db, 'guilds.fetchConcurrent', 2);
});

test('budget: a guild fetch never uses more than half, a lookup is never behind it, and the daily refresh keeps moving', async () => {
  const { createBudget } = await import('../crawler/budget.js');
  let clock = 0;
  const timers = [];
  const budget = createBudget({
    perSecond: 4, now: () => clock,
    setTimer: (fn, ms) => { const tm = { fn, at: clock + ms }; timers.push(tm); return tm; },
    clearTimer: (tm) => { const i = timers.indexOf(tm); if (i >= 0) timers.splice(i, 1); },
  });
  const order = [];
  for (let i = 0; i < 40; i++) budget.take(PRIORITY.guild).then(() => order.push({ p: 'guild', at: clock }));
  for (let i = 0; i < 40; i++) budget.take(PRIORITY.daily).then(() => order.push({ p: 'daily', at: clock }));
  const tick = async () => {
    await new Promise((r) => setImmediate(r));
    timers.sort((a, b) => a.at - b.at);
    const tm = timers.shift();
    if (!tm) return false;
    clock = tm.at;
    tm.fn();
    return true;
  };
  while (clock < 5000 && (await tick()));
  await new Promise((r) => setImmediate(r));
  const inFive = order.filter((o) => o.at < 5000);
  const guild = inFive.filter((o) => o.p === 'guild').length;
  const daily = inFive.filter((o) => o.p === 'daily').length;
  assert.ok(guild <= 11, `guild took ${guild} of ${inFive.length} starts in 5 s at 4/s`);
  assert.ok(daily >= 8, `the daily refresh got ${daily}`);
  // A lookup arriving now is next, ahead of the guild requests still waiting.
  const before = order.length;
  budget.take(PRIORITY.lookup).then(() => order.push({ p: 'lookup', at: clock }));
  for (let i = 0; i < 2 && order.length === before; i++) await tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(order[before]?.p, 'lookup');
});

test('slots: guild members hold at most two, lookups always have one, background shares what is left', async () => {
  const { claimable } = await import('../crawler/service.js');
  const run = (...ps) => ps.map((priority) => ({ priority }));
  const allowed = ({ maxPriority, skip }) => [1, 2, 3, 4, 5].filter((p) => p <= maxPriority && !skip.includes(p));
  assert.deepEqual(allowed(claimable({ inFlight: run(), paused: false })), [1, 2, 3, 4, 5]);
  assert.deepEqual(allowed(claimable({ inFlight: run(PRIORITY.guild, PRIORITY.guild), paused: false })), [PRIORITY.lookup, PRIORITY.auto, PRIORITY.daily, PRIORITY.roster]);
  assert.deepEqual(allowed(claimable({ inFlight: run(PRIORITY.guild, PRIORITY.guild, PRIORITY.daily), paused: false })), [PRIORITY.lookup, PRIORITY.auto]);
  assert.deepEqual(allowed(claimable({ inFlight: run(PRIORITY.daily, PRIORITY.daily, PRIORITY.roster), paused: false })), [PRIORITY.lookup, PRIORITY.auto]);
  assert.deepEqual(allowed(claimable({ inFlight: run(), paused: true })), [PRIORITY.lookup, PRIORITY.auto]);
});

test('retention: a guild fetch\'s work list and old fetches are Blizzard data, swept with the window', async () => {
  await t.db.query("INSERT INTO guild_fetches (slug, state, requested_at, finished_at) VALUES ('old-guild', 'done', now() - interval '40 days', now() - interval '40 days')");
  const old = await t.db.one("SELECT id FROM guild_fetches WHERE slug = 'old-guild'");
  await t.db.query("INSERT INTO guild_fetch_members (fetch_id, character_id, slug, listed_at) VALUES ($1, 9, 'old-fixture', now() - interval '40 days')", [old.id]);
  const { runRetentionSweep } = await import('../retention/sweep.js');
  await runRetentionSweep(t.db, { log: { log() {}, warn() {}, error() {} } });
  assert.equal(await t.db.one("SELECT 1 AS x FROM guild_fetches WHERE slug = 'old-guild'"), null);
  assert.equal(await t.db.one("SELECT 1 AS x FROM guild_fetch_members WHERE slug = 'old-fixture'"), null);
});

test('the crawl queue takes the five priorities and nothing else', async () => {
  await t.db.query("INSERT INTO crawl_queue (kind, key, priority) VALUES ('character', 'prio-fixture', 5)");
  await assert.rejects(t.db.query("INSERT INTO crawl_queue (kind, key, priority) VALUES ('character', 'prio6-fixture', 6)"));
  await t.db.query("DELETE FROM crawl_queue WHERE key = 'prio-fixture'");
});
