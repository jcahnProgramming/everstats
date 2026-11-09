import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Guild badges (0.7.1). Fixture names and made-up ids only; nothing here reaches Blizzard or Discord.
let t;
let admin;
let discordUser = 9700;
const CLASSES = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid'];
before(async () => {
  t = await startApp({
    fetch: async (url) => {
      const u = String(url);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u === 'https://discord.com/api/oauth2/token') return json(200, { access_token: 'tok' });
      if (u === 'https://discord.com/api/users/@me') return json(200, { id: `1000000000000${discordUser}`, username: 'fixture' });
      return json(404, {});
    },
  });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
  const { sha256Hex } = await import('../credentials/crypto.js');
  const token = randomBytes(32).toString('base64url');
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  admin = { Cookie: `es_admin=${token}` };
  await t.db.query("INSERT INTO rulesets (id, name) VALUES (2, 'Normal') ON CONFLICT DO NOTHING");
  await t.db.query(`INSERT INTO statistics (id, name) VALUES (98, 'Quests completed'), (107, 'Creatures killed'), (64222, 'Times camped'), (60, 'Total deaths')`);
  const { clearCatalogCache } = await import('../stats/catalog.js');
  clearCatalogCache();
});
after(() => t.close());

let ip = 10;
async function newPlayer(username) {
  discordUser += 1;
  const c = t.client({ ip: `198.51.100.${ip++}` });
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=x&state=${new URL(start.json.url).searchParams.get('state')}`);
  if (username) await c.put('/api/account/username', { username });
  return { c, id: (await c.get('/api/account')).json.account.id };
}

let nextGuild = 500;
async function guild(name) {
  nextGuild += 1;
  const slug = `fixture-guild-${nextGuild}`;
  await t.db.query("INSERT INTO guilds (id, slug, name, ruleset_id, profile_fetched_at, profile_state) VALUES ($1, $2, $3, 2, now(), 'ok')", [nextGuild, slug, name]);
  return { id: nextGuild, slug };
}
let nextChar = 90_000;
/** A tracked member with some statistics. */
async function member(guildId, { cls = 'Warrior', level = 30, quests = 0, camped = 0, owner = null, rank = 3, letter = null } = {}) {
  nextChar += 1;
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, class, level, profile_state, source, data_fetched_at, stats_fetched_at, guild_id, owner_account_id)
     VALUES ($1, $2, 'Fixture', $3, 2, 'Horde', $4, $5, 'ok', 'guild', now(), now(), $6, $7)`,
    [nextChar, `fixture-g${nextChar}`, `G${nextChar}`, cls, level, guildId, owner],
  );
  for (const [id, v] of [[98, quests], [64222, camped]]) {
    if (v > 0) await t.db.query('INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES ($1, $2, 2, $3, now())', [nextChar, id, v]);
  }
  if (rank !== null) await t.db.query('INSERT INTO guild_roster (guild_id, character_id, rank, level, fetched_at) VALUES ($1, $2, $3, $4, now())', [guildId, nextChar, rank, level]);
  if (letter) {
    await t.db.query(
      `INSERT INTO character_tiers (character_id, ruleset_id, score, letter, lettered, needed, total, stat_ids, stat_pcts, graded_by, computed_at)
       VALUES ($1, 2, 0.9, $2, 1, 1, 1, '{}', '{}', 'full', now())`,
      [nextChar, letter],
    );
  }
  return nextChar;
}
const rebuild = async (id) => {
  const { rebuildGuildTotals } = await import('../stats/guildTotals.js');
  await t.db.tx((q) => rebuildGuildTotals(q, id));
};
const evaluate = async (id, opts) => {
  const { evaluateGuild } = await import('../guildBadges/rules.js');
  return evaluateGuild(t.db, id, opts);
};
const awards = async (id) => t.db.query("SELECT badge_id, state, level, ribbon_at FROM guild_badge_awards WHERE guild_id = $1 ORDER BY badge_id", [id]);

test('seeded definitions match the design export: 15 guild badges, five families, the proposed thresholds', async () => {
  const defs = await t.db.query('SELECT id, family, levelled, thresholds, award, kept_while_held, status_mark FROM guild_badge_definitions ORDER BY sort');
  assert.equal(defs.length, 15);
  assert.deepEqual([...new Set(defs.map((d) => d.family))], ['roster', 'deeds', 'standing', 'heritage', 'recognition']);
  const th = Object.fromEntries(defs.filter((d) => d.levelled).map((d) => [d.id, d.thresholds.map(Number)]));
  assert.deepEqual(th, {
    muster: [10, 25, 50, 100, 250], questers: [10000, 50000, 100000, 500000, 1000000], slayers: [100000, 500000, 1000000, 5000000, 10000000],
    campfire: [100, 500, 1000, 5000, 10000], 'fallen-together': [1000, 5000, 10000, 50000, 100000],
  });
  assert.deepEqual(defs.filter((d) => d.award === 'manual').map((d) => d.id), ['partner-guild', 'featured-guild']);
  assert.deepEqual(defs.filter((d) => d.status_mark).map((d) => d.id), ['verified-guild']);
});

test('levels from current tracked members, kept when members leave; Founding during the beta; Every Calling; progress is live', async () => {
  const g = await guild('Fixture Levels');
  for (let i = 0; i < 12; i++) await member(g.id, { cls: CLASSES[i % 9], quests: 1000, camped: 10 });
  await rebuild(g.id);
  await evaluate(g.id);
  const got = Object.fromEntries((await awards(g.id)).map((a) => [a.badge_id, a.level]));
  assert.equal(got.muster, 1, '12 tracked members = Muster I');
  assert.equal(got.questers, 1, '12,000 quests = Questers I');
  assert.equal(got.campfire, 1, '120 times camped = Campfire I');
  assert.ok('every-calling-g' in got, 'all nine classes among level 10+ tracked members');
  assert.ok('founding-guild' in got, 'tracked while the beta window is open');
  assert.ok(!('slayers' in got), 'no creatures killed: nothing');
  // Members leave: levels stay.
  await t.db.query('UPDATE characters SET guild_id = NULL WHERE guild_id = $1', [g.id]);
  await rebuild(g.id);
  await evaluate(g.id);
  const after = Object.fromEntries((await awards(g.id)).map((a) => [a.badge_id, a.level]));
  assert.equal(after.muster, 1);
  assert.equal(after.questers, 1);
  // The page shows progress toward the next level, from live values (0 tracked now).
  const page = (await t.client().get(`/api/guilds/${g.slug}`)).json;
  const m = page.badges.nextUnlocks.find((x) => x.id === 'muster');
  assert.equal(m.progress.level, 2);
  assert.equal(m.progress.value, 0);
  assert.equal(m.progress.threshold, 25);
});

test('raising a threshold never removes a level; lowering one unlocks it', async () => {
  const g = await guild('Fixture Thresholds');
  for (let i = 0; i < 26; i++) await member(g.id);
  await rebuild(g.id);
  await evaluate(g.id);
  assert.equal((await awards(g.id)).find((a) => a.badge_id === 'muster').level, 2);
  const c = t.client({ ip: '192.0.2.50' });
  const up = await c.put('/api/admin/guild-badges/muster/thresholds', { thresholds: [100, 200, 300, 400, 500], reason: 'fixture raise' }, admin);
  assert.equal(up.status, 200);
  await evaluate(g.id);
  assert.equal((await awards(g.id)).find((a) => a.badge_id === 'muster').level, 2, 'kept');
  await c.put('/api/admin/guild-badges/muster/thresholds', { thresholds: [5, 10, 20, 50, 250], reason: 'fixture lower' }, admin);
  await evaluate(g.id);
  assert.equal((await awards(g.id)).find((a) => a.badge_id === 'muster').level, 3, '26 ≥ 20: Muster III at once');
  assert.equal((await c.put('/api/admin/guild-badges/muster/thresholds', { thresholds: [5, 4, 20, 50, 250], reason: 'x' }, admin)).status, 400, 'levels must rise');
  await c.put('/api/admin/guild-badges/muster/thresholds', { thresholds: [10, 25, 50, 100, 250], reason: 'fixture restore' }, admin);
});

test('Board Champion counts only boards with the minimum of ranked guilds; kept while held, then lost', async () => {
  const a = await guild('Fixture Champion A');
  for (let i = 0; i < 5; i++) await member(a.id, { quests: 500 });
  await rebuild(a.id);
  await evaluate(a.id);
  assert.ok(!(await awards(a.id)).some((x) => x.badge_id === 'board-champion'), '#1 of 1 earns nothing');
  const b = await guild('Fixture Champion B');
  const c = await guild('Fixture Champion C');
  for (const g of [b, c]) {
    for (let i = 0; i < 5; i++) await member(g.id, { quests: 100 });
    await rebuild(g.id);
  }
  await evaluate(a.id);
  const held = (await awards(a.id)).find((x) => x.badge_id === 'board-champion');
  assert.equal(held?.state, 'held', '#1 of 3');
  // B overtakes A: A loses it, B holds it.
  for (let i = 0; i < 5; i++) await member(b.id, { quests: 5000 });
  await rebuild(b.id);
  await evaluate(a.id);
  await evaluate(b.id);
  assert.equal((await awards(a.id)).find((x) => x.badge_id === 'board-champion').state, 'lost');
  assert.equal((await awards(b.id)).find((x) => x.badge_id === 'board-champion').state, 'held');
  const ev = await t.db.query("SELECT type FROM guild_badge_events WHERE guild_id = $1 AND badge_id = 'board-champion' ORDER BY id", [a.id]);
  assert.deepEqual(ev.map((e) => e.type), ['unlocked', 'lost']);
});

test('Strong Roster needs an A average over enough lettered members; Verified follows the Guild Master', async () => {
  const g = await guild('Fixture Strong');
  const gm = await newPlayer('fixturegbgm');
  await member(g.id, { owner: gm.id, rank: 0, letter: 'S' });
  for (let i = 0; i < 4; i++) await member(g.id, { letter: 'A' });
  await rebuild(g.id);
  await evaluate(g.id);
  const got = Object.fromEntries((await awards(g.id)).map((a) => [a.badge_id, a.state]));
  assert.equal(got['strong-roster'], 'held', 'average 4.2 over 5 lettered members');
  assert.equal(got['verified-guild'], 'held');
  const page = (await t.client().get(`/api/guilds/${g.slug}`)).json;
  assert.ok(page.badges.verified, 'Verified shows as a status mark');
  assert.ok(!page.badges.row.some((x) => x.id === 'verified-guild'), 'and never takes a badge slot');
  assert.equal(page.badges.automatic, false, 'a guild with a GM uses its own display');
  await t.db.query("UPDATE characters SET owner_account_id = NULL WHERE guild_id = $1 AND owner_account_id IS NOT NULL", [g.id]);
  await evaluate(g.id);
  assert.equal((await awards(g.id)).find((a) => a.badge_id === 'verified-guild').state, 'lost');
});

test('the GM and officers choose display and pin; nobody can award; others are refused', async () => {
  const g = await guild('Fixture Display');
  const gm = await newPlayer('fixturedisplaygm');
  const other = await newPlayer('fixturedisplayx');
  await member(g.id, { owner: gm.id, rank: 0, quests: 20000 });
  for (let i = 0; i < 10; i++) await member(g.id, { cls: CLASSES[i % 9] });
  await rebuild(g.id);
  await evaluate(g.id);
  const v = (await gm.c.get(`/api/guilds/${g.slug}/badges/manage`)).json;
  assert.equal(v.role, 'gm');
  const ids = v.shown.map((b) => b.id);
  assert.ok(ids.includes('muster') && ids.includes('questers'));
  const put = await gm.c.put(`/api/guilds/${g.slug}/badges/manage`, { order: ['questers', 'muster'], shown: ['questers', 'muster'], pinned: 'muster' });
  assert.equal(put.status, 200);
  const page = (await t.client().get(`/api/guilds/${g.slug}`)).json;
  assert.deepEqual(page.badges.row.map((b) => b.id), ['muster', 'questers'], 'pinned first, then the order');
  assert.equal((await gm.c.put(`/api/guilds/${g.slug}/badges/manage`, { order: [], shown: ['board-champion'], pinned: null })).status, 400, 'a badge the guild doesn’t hold can’t be shown');
  assert.equal((await other.c.put(`/api/guilds/${g.slug}/badges/manage`, { order: [], shown: [], pinned: null })).status, 403);
  // There is no route a player can use to award a guild badge: the grant lives behind the admin 404 gate.
  assert.equal((await gm.c.post(`/api/admin/guild-badges/guilds/${g.id}/grant`, { badgeId: 'featured-guild', reason: 'mine' })).status, 404);
  // The /guilds list and boards carry the pinned badge.
  const { guildInlineBadges } = await import('../guildBadges/store.js');
  assert.equal((await guildInlineBadges(t.db, [g.id])).get(g.id).badge.id, 'muster');
});

test('staff badges: Featured with a reason and label; Partner needs a saved emblem; revoke is a state', async () => {
  const g = await guild('Fixture Staff');
  const c = t.client({ ip: '192.0.2.51' });
  assert.equal((await c.post(`/api/admin/guild-badges/guilds/${g.id}/grant`, { badgeId: 'featured-guild' }, admin)).status, 400, 'reason required');
  const ok = await c.post(`/api/admin/guild-badges/guilds/${g.id}/grant`, { badgeId: 'featured-guild', reason: 'fixture event', label: 'Fixture Cup', until: '2099-01-01' }, admin);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.guild.awards.find((a) => a.id === 'featured-guild').detail.label, 'Fixture Cup');
  assert.equal((await c.post(`/api/admin/guild-badges/guilds/${g.id}/grant`, { badgeId: 'partner-guild', reason: 'fixture' }, admin)).status, 409, 'no emblem yet');
  assert.equal((await c.post(`/api/admin/guild-badges/guilds/${g.id}/grant`, { badgeId: 'muster', reason: 'fixture' }, admin)).status, 409, 'automatic badges can’t be granted');
  const r = await c.post(`/api/admin/guild-badges/guilds/${g.id}/revoke`, { badgeId: 'featured-guild', reason: 'fixture over' }, admin);
  assert.equal(r.json.guild.awards.find((a) => a.id === 'featured-guild').state, 'revoked');
  // An SVG emblem is refused.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const res = await fetch(`${t.base}/api/admin/guild-badges/guilds/${g.id}/mark?permission=confirmed`, { method: 'POST', headers: { ...admin, Origin: 'http://localhost:3000', 'CF-Connecting-IP': '192.0.2.51', 'Content-Type': 'image/svg+xml' }, body: svg });
  assert.equal(res.status, 415);
});

test('the back-fill runs once, without toasts or ribbons, and records what it awarded', async () => {
  await t.db.query("DELETE FROM pipeline_facts WHERE key = 'guild_badges_backfilled_at'");
  const g = await guild('Fixture Backfill');
  for (let i = 0; i < 11; i++) await member(g.id);
  await rebuild(g.id);
  const { backfillGuildsOnce } = await import('../guildBadges/rules.js');
  const r = await backfillGuildsOnce(t.db);
  assert.ok(r.guilds >= 1);
  assert.equal(await backfillGuildsOnce(t.db), null, 'once');
  const mine = await awards(g.id);
  assert.ok(mine.length > 0);
  assert.ok(mine.every((a) => a.ribbon_at === null), 'no ribbons');
  const ev = await t.db.query("SELECT notify FROM guild_badge_events WHERE guild_id = $1", [g.id]);
  assert.ok(ev.every((e) => !e.notify), 'no toasts');
  assert.ok((await t.db.one("SELECT 1 AS x FROM guild_badge_events WHERE type = 'backfill'")));
});
