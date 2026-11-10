import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// Public profile fields (0.4.2). Fixture names only.
let t;
before(async () => {
  t = await startApp({
    fetch: async (url, opts = {}) => {
      const u = String(url);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (u === 'https://discord.com/api/oauth2/token') return json(200, { access_token: `tok-${new URLSearchParams(String(opts.body)).get('code')}` });
      if (u === 'https://discord.com/api/users/@me') return json(200, { id: '100000000000009001', username: 'fixture' });
      return json(404, {});
    },
  });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
});
after(() => t.close());

async function signIn(c) {
  const start = await c.post('/api/auth/discord/start', {});
  await c.get(`/auth/discord/callback?code=p1&state=${new URL(start.json.url).searchParams.get('state')}`);
}

test('profile fields: handles only (never URLs), each checked against its platform; bio is plain text; empty fields don’t show', async () => {
  const c = t.client({ ip: '198.51.100.90' });
  await signIn(c);
  await c.put('/api/account/username', { username: 'fixtureplayer' });
  const id = (await c.get('/api/account')).json.account.id;

  // A link instead of a handle, a bad handle, a profane bio: each refused with a plain reason, nothing saved.
  assert.equal((await c.put('/api/account/profile', { links: { twitch: 'https://twitch.tv/x' } })).json.error, 'Type just your Twitch handle, not a link.');
  assert.match((await c.put('/api/account/profile', { links: { bluesky: 'not a domain' } })).json.error, /Bluesky handle is a domain/);
  assert.equal((await c.put('/api/account/profile', { bio: 'what a sh1t day' })).json.error, 'Your bio has a word in it that isn’t allowed.');

  const saved = (await c.put('/api/account/profile', { bio: 'Healer.\nCamps a lot.', links: { bluesky: '@Fixture.bsky.social', discord: 'fixtureinv', x: '' }, showPins: false })).json.account.profile;
  assert.deepEqual(saved.links, { bluesky: 'fixture.bsky.social', discord: 'fixtureinv' });
  // 0.8.1: an X handle saves (the one-letter platform id 'x' was refused by the database check until migration 018).
  const withX = await c.put('/api/account/profile', { bio: 'Healer.\nCamps a lot.', links: { bluesky: 'fixture.bsky.social', discord: 'fixtureinv', x: '@fixture_x' }, showPins: false });
  assert.equal(withX.status, 200);
  assert.equal(withX.json.account.profile.links.x, 'fixture_x');
  await c.put('/api/account/profile', { bio: 'Healer.\nCamps a lot.', links: { bluesky: 'fixture.bsky.social', discord: 'fixtureinv' }, showPins: false });

  // Characters: one shown (in a guild), one hidden (in another guild, which must never appear).
  await t.db.query("INSERT INTO rulesets (id, name) VALUES (2, 'Normal') ON CONFLICT DO NOTHING");
  await t.db.query("INSERT INTO guilds (id, slug, name, ruleset_id) VALUES (1, 'seen-guild', 'Seen Guild', 2), (2, 'secret-guild', 'Secret Guild', 2)");
  await t.db.query(
    `INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, profile_state, source, data_fetched_at, stats_fetched_at, last_fetched_at, guild_id, owner_account_id, hidden)
     VALUES (8001, 'shown-fixture', 'Shown', 'Fixture', 2, 'Horde', 'ok', 'account', now(), now(), now(), 1, $1, false),
            (8002, 'secret-fixture', 'Secret', 'Fixture', 2, 'Alliance', 'ok', 'account', now(), now(), now(), 2, $1, true)`,
    [id],
  );
  const res = (await t.client().get('/api/users/fixtureplayer')).json;
  const ids = res.sections.map((s) => s.id);
  assert.deepEqual(ids, ['about', 'featured', 'guilds']); // no pins (turned off), no empty "other characters"
  const about = res.sections[0];
  assert.equal(about.bio, 'Healer.\nCamps a lot.');
  assert.deepEqual(about.links.map((l) => l.url), ['https://bsky.app/profile/fixture.bsky.social', 'https://discord.gg/fixtureinv']);
  assert.deepEqual(res.sections[2].guilds.map((g) => g.name), ['Seen Guild']);
  assert.deepEqual(res.profile.main, { ruleset: 'Normal', faction: 'Horde' });
  assert.ok(res.profile.joinedAt);
  assert.ok(!JSON.stringify(res).includes('Secret'));

  // Pins on, and an empty bio: the about section keeps only the links.
  await c.put('/api/account/profile', { bio: '', links: { discord: 'fixtureinv' }, showPins: true });
  const again = (await t.client().get('/api/users/fixtureplayer')).json;
  assert.equal(again.sections[0].bio, null);
});

test('0.10.4: the featured character shows its best placements: never a tied board, a board of one, or a death', async () => {
  // Continues from the profile above: fixtureplayer's featured character is 8001 on ruleset 2.
  const q = t.db;
  await q.query(`INSERT INTO characters (id, slug, name, surname, ruleset_id, profile_state, source, data_fetched_at, stats_fetched_at, level)
                 VALUES (8101, 'rival-one', 'Rival', 'One', 2, 'ok', 'lookup', now(), now(), 20), (8102, 'rival-two', 'Rival', 'Two', 2, 'ok', 'lookup', now(), now(), 20)`);
  await q.query(`INSERT INTO statistics (id, name, category_path) VALUES
     (701, 'Fixture best', '[{"name":"Kills"}]'), (702, 'Fixture second', '[{"name":"Kills"}]'), (703, 'Fixture tied', '[{"name":"Kills"}]'),
     (704, 'Fixture alone', '[{"name":"Kills"}]'), (705, 'Fixture deaths', '[{"name":"Deaths"}]')`);
  const v = (c, s, n) => `(${c}, ${s}, 2, ${n}, now())`;
  await q.query(`INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at) VALUES
     ${[v(8001, 701, 50), v(8101, 701, 10), v(8102, 701, 5),   // #1 of 3
        v(8001, 702, 20), v(8101, 702, 30), v(8102, 702, 5),   // #2 of 3
        v(8001, 703, 4), v(8101, 703, 4), v(8102, 703, 4),      // everyone tied: no placement
        v(8001, 704, 9),                                        // the only one with any: no placement
        v(8001, 705, 99), v(8101, 705, 1)].join(', ')}`);      // deaths: leaderboard-only, never shown off
  (await import('../stats/catalog.js')).clearCatalogCache();
  const res = (await t.client().get('/api/users/fixtureplayer')).json;
  const f = res.sections.find((s) => s.id === 'featured').character;
  assert.deepEqual(f.placements.map((p) => [p.id, p.rank, p.withAny]), [[701, 1, 3], [702, 2, 3]]);
  assert.equal(f.badge?.id, 'beta-tester'); // its one inline badge: created while the beta was open
});
