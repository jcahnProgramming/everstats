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
