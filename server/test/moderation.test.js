import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.js';

// A fake Battle.net and Discord (the code IS the person), as in auth.test.js. Fixture names only; no Blizzard data.
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function fakeFetch(url, opts = {}) {
  const u = new URL(String(url));
  const auth = String(opts.headers?.Authorization ?? '');
  if (u.href === 'https://oauth.battle.net/token' || u.href === 'https://discord.com/api/oauth2/token') {
    const b = new URLSearchParams(String(opts.body));
    return json(200, { access_token: `tok-${b.get('code')}` });
  }
  const who = auth.replace('Bearer tok-', '');
  if (u.href === 'https://oauth.battle.net/userinfo') return json(200, { sub: `bnet-${who}`, battletag: `Secret${who}#1234` });
  if (u.href === 'https://discord.com/api/users/@me') return json(200, { id: `20000000000000${who.replace(/\D/g, '').padStart(4, '0')}`, username: `discord_${who}` });
  return json(404, {});
}

let t;
before(async () => {
  t = await startApp({ fetch: fakeFetch });
  const { saveCredential } = await import('../credentials/store.js');
  await saveCredential(t.db, 'blizzard', { clientId: 'bnet-client-id-0001', clientSecret: 'bnet-client-secret-0001' });
  await saveCredential(t.db, 'discord', { clientId: '123456789012345678', clientSecret: 'discord-secret-abcdefghijkl' });
});
after(async () => {
  await t.close();
});

async function oauth(c, provider, code, intent = 'sign_in') {
  const start = await c.post(`/api/auth/${provider}/start`, { intent });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const cb = await c.get(`/auth/${provider}/callback?code=${code}&state=${new URL(start.json.url).searchParams.get('state')}`);
  return cb.headers.get('location');
}
const adminHeaders = async () => {
  const { newToken, sha256Hex } = await import('../credentials/crypto.js');
  const token = newToken();
  await t.db.query("INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '1 hour')", [sha256Hex(token)]);
  return { Cookie: `es_admin=${token}` };
};
const idOf = async (provider, subject) => Number((await t.db.one('SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2', [provider, subject])).account_id);

/** A signed-in player with a claimed username (and, optionally, a linked Discord). */
async function player(code, name, { ip, discord = null } = {}) {
  const c = t.client({ ip });
  await oauth(c, 'battlenet', code);
  assert.equal((await c.put('/api/account/username', { username: name })).status, 200);
  if (discord) assert.equal(await oauth(c, 'discord', discord, 'link'), '/settings?linked=discord');
  return { c, id: await idOf('battlenet', `bnet-${code}`) };
}

test('a temporary ban: sessions end, every linked way in shows only the notice, appeal, evasion refused, unban restores', async () => {
  const admin = await adminHeaders();
  const a = await player('ban1', 'banme', { ip: '198.51.100.60', discord: 'ban1d' });
  await a.c.put('/api/account/profile', { bio: 'A bio that will vanish while banned', links: {} });
  assert.equal((await t.client().get('/api/users/banme')).status, 200);

  // Reason required; a moderator-only limit doesn't apply to the admin; 3 days.
  const noReason = await a.c.post(`/api/admin/moderation/accounts/${a.id}/ban`, { kind: 'temporary', days: 3 }, admin);
  assert.equal(noReason.status, 400);
  const banned = await t.client().post(`/api/admin/moderation/accounts/${a.id}/ban`, { kind: 'temporary', days: 3, reason: 'Spam in the bio', message: 'Please keep it friendly.' }, admin);
  assert.equal(banned.status, 200, JSON.stringify(banned.json));
  assert.equal(banned.json.account.status.id, 'temp_banned');
  assert.ok(banned.json.result.sessionsEnded >= 1);
  assert.deepEqual(banned.json.result.identities, { providers: ['Battle.net', 'Discord'], passkeys: 0 });

  // The old session is gone.
  const s0 = await a.c.get('/api/session');
  assert.equal(s0.json.signedIn, false);
  assert.equal(s0.json.stage, null);

  // Public presence hidden, neutrally.
  const prof = await t.client().get('/api/users/banme');
  assert.equal(prof.status, 404);
  assert.equal(prof.json.code, 'unavailable');
  assert.equal(prof.json.error, 'This profile isn’t available.');

  // Signing back in with Battle.net or Discord: only the notice.
  for (const [provider, code] of [['battlenet', 'ban1'], ['discord', 'ban1d']]) {
    const c = t.client({ ip: '198.51.100.61' });
    assert.equal(await oauth(c, provider, code), '/banned');
    const s = await c.get('/api/session');
    assert.equal(s.json.stage, 'banned');
    assert.equal(s.json.signedIn, false);
    assert.equal(s.json.ban.reason, 'Spam in the bio');
    assert.equal(s.json.ban.message, 'Please keep it friendly.');
    assert.equal(s.json.ban.permanent, false);
    assert.ok(s.json.ban.until);
    // Nothing of the signed-in site.
    assert.equal((await c.get('/api/account')).status, 401);
    assert.equal((await c.get('/api/dashboard')).status, 401);
    assert.equal((await c.put('/api/account/profile', { bio: 'sneaky' })).status, 401);
    assert.equal((await c.post('/api/account/passkeys/options', {})).status, 401);
  }
  // No account was created by those sign-ins.
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM account_identities WHERE subject IN ('bnet-ban1')")).n, 1);

  // Appeal → Admin → Feedback as type 'appeal', linked to the account and the ban.
  const c = t.client({ ip: '198.51.100.62' });
  await oauth(c, 'battlenet', 'ban1');
  const appeal = await c.post('/api/banned/appeal', { message: 'I removed the spam, please lift it.' });
  assert.equal(appeal.status, 200, JSON.stringify(appeal.json));
  const inbox = await t.client().get('/api/admin/feedback?state=unread&type=appeal', admin);
  const thread = inbox.json.threads.find((x) => x.sender.accountId === a.id);
  assert.equal(thread.type, 'appeal');
  const full = await t.client().get(`/api/admin/feedback/${thread.id}`, admin);
  assert.ok(full.json.thread.banId);
  // The public form can't send an appeal.
  assert.equal((await t.client({ ip: '198.51.100.63' }).post('/api/feedback', { type: 'appeal', message: 'not from the ban page' })).status, 400);
  // The admin's reply shows on the ban page.
  await t.client().post(`/api/admin/feedback/${thread.id}/reply`, { message: 'Thanks, looking at it.' }, admin);
  const page = await c.get('/api/banned');
  assert.deepEqual(page.json.appeal.messages.map((m) => m.author), ['player', 'everstats']);

  // Evasion: linking the banned Discord to another account, and merges either way, are refused.
  const b = await player('clean1', 'cleanone', { ip: '198.51.100.64' });
  assert.equal(await oauth(b.c, 'discord', 'ban1d', 'link'), '/settings?error=banned_identity');
  assert.equal(await oauth(b.c, 'battlenet', 'ban1', 'merge'), '/settings?error=merge_banned');
  // Even if the identity were somehow moved off the banned account, the copy taken at the ban still refuses it.
  await t.db.query("UPDATE account_identities SET account_id = $1 WHERE provider = 'discord' AND subject = $2", [b.id, '200000000000000001']);
  const moved = t.client({ ip: '198.51.100.65' });
  assert.equal(await oauth(moved, 'discord', 'ban1d'), '/banned');
  assert.equal((await moved.get('/api/session')).json.ban.reason, 'Spam in the bio');
  await t.db.query("UPDATE account_identities SET account_id = $1 WHERE provider = 'discord' AND subject = $2", [a.id, '200000000000000001']);

  // Unban: reason required, sessions on the notice end, the next sign-in is normal and shows why once.
  assert.equal((await t.client().post(`/api/admin/moderation/accounts/${a.id}/unban`, {}, admin)).status, 400);
  const un = await t.client().post(`/api/admin/moderation/accounts/${a.id}/unban`, { reason: 'Appeal accepted' }, admin);
  assert.equal(un.status, 200);
  assert.equal(un.json.account.status.id, 'active');
  assert.equal((await c.get('/api/session')).json.stage, null);
  const back = t.client({ ip: '198.51.100.66' });
  assert.equal(await oauth(back, 'battlenet', 'ban1'), '/');
  const s = await back.get('/api/session');
  assert.equal(s.json.signedIn, true);
  assert.equal(s.json.notices, 1);
  const notices = await back.get('/api/account/notices');
  assert.equal(notices.json.notices[0].title, 'Your ban was lifted');
  assert.equal(notices.json.notices[0].reason, 'Appeal accepted');
  assert.equal((await back.post(`/api/account/notices/${notices.json.notices[0].id}/ack`, {})).status, 200);
  assert.equal((await back.get('/api/session')).json.notices, 0);
  // Everything is back: the profile, the bio, the characters were never touched.
  const again = await t.client().get('/api/users/banme');
  assert.equal(again.status, 200);
  assert.equal(again.json.sections.find((x) => x.id === 'about').bio, 'A bio that will vanish while banned');

  // History: who, when, why, what changed.
  const detail = await t.client().get(`/api/admin/moderation/accounts/${a.id}`, admin);
  assert.deepEqual(detail.json.account.history.map((h) => h.type).filter((x) => ['ban', 'unban'].includes(x)), ['unban', 'ban']);
  assert.ok(detail.json.account.history.every((h) => h.by === 'Admin'));
  assert.equal(detail.json.account.bans[0].liftedReason, 'Appeal accepted');
});

test('a passkey sign-in to a banned account shows the notice; a permanent ban never lifts by time', async () => {
  const admin = await adminHeaders();
  const a = await player('pk1', 'passkeyone', { ip: '198.51.100.70' });
  await t.db.query("INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, 'cred-banned-0000000001', '\\x00', 0, '{}', 'Fixture')", [a.id]);
  const r = await t.client().post(`/api/admin/moderation/accounts/${a.id}/ban`, { kind: 'permanent', reason: 'Impersonating staff' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.account.status.id, 'banned');
  const { passkeyBan } = await import('../moderation/bans.js');
  const ban = await passkeyBan(t.db, 'cred-banned-0000000001');
  assert.equal(Number(ban.account_id), a.id);
  assert.equal(ban.kind, 'permanent');
  assert.equal(ban.ends_at, null);
  // A temporary ban past its end stops counting by itself.
  const b = await player('tmp1', 'tempone', { ip: '198.51.100.71' });
  await t.client().post(`/api/admin/moderation/accounts/${b.id}/ban`, { kind: 'temporary', days: 1, reason: 'Cooling off' }, admin);
  await t.db.query("UPDATE account_bans SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE account_id = $1", [b.id]);
  const c = t.client({ ip: '198.51.100.72' });
  assert.equal(await oauth(c, 'battlenet', 'tmp1'), '/');
  assert.equal((await c.get('/api/session')).json.signedIn, true);
});

test('moderators: off for everyone by default; when on, only what a moderator may do', async () => {
  const admin = await adminHeaders();
  const m = await player('mod1', 'modone', { ip: '198.51.100.80' });
  const target = await player('tgt1', 'targetone', { ip: '198.51.100.81' });

  // Off: the grant is refused and the moderation API is a plain 404, even for an account given the role by hand.
  const off = await t.client().put(`/api/admin/moderation/accounts/${m.id}/role`, { role: 'moderator', reason: 'Trusted' }, admin);
  assert.equal(off.status, 409);
  assert.equal(off.json.code, 'moderators_off');
  await t.db.query("UPDATE accounts SET role = 'moderator' WHERE id = $1", [m.id]);
  await t.db.query("INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, 'cred-mod-00000000000001', '\\x00', 0, '{}', 'Fixture')", [m.id]);
  assert.equal((await m.c.get('/api/admin/moderation/reports')).status, 404);
  await t.db.query("UPDATE accounts SET role = 'player' WHERE id = $1", [m.id]);
  await t.db.query("DELETE FROM passkeys WHERE account_id = $1", [m.id]);

  // On: the role needs 2FA or a passkey.
  assert.equal((await t.client().put('/api/admin/settings/moderation.moderators', { value: true }, admin)).status, 200);
  const weak = await t.client().put(`/api/admin/moderation/accounts/${m.id}/role`, { role: 'moderator', reason: 'Trusted' }, admin);
  assert.equal(weak.json.code, 'needs_2fa');
  await t.db.query("INSERT INTO passkeys (account_id, credential_id, public_key, sign_count, transports, name) VALUES ($1, 'cred-mod-00000000000001', '\\x00', 0, '{}', 'Fixture')", [m.id]);
  const granted = await t.client().put(`/api/admin/moderation/accounts/${m.id}/role`, { role: 'moderator', reason: 'Trusted', badge: true }, admin);
  assert.equal(granted.status, 200, JSON.stringify(granted.json));
  assert.equal((await t.db.one("SELECT state FROM badge_awards WHERE account_id = $1 AND badge_id = 'moderator'", [m.id])).state, 'held');

  const me = await m.c.get('/api/admin/moderation/me');
  assert.equal(me.json.actor.kind, 'moderator');
  assert.equal(me.json.can['reports.view'], true);
  assert.equal(me.json.can['ban.permanent'], false);
  // Allowed
  assert.equal((await m.c.get('/api/admin/moderation/reports')).status, 200);
  assert.equal((await m.c.get(`/api/admin/moderation/accounts/${target.id}`)).status, 200);
  assert.equal((await m.c.post(`/api/admin/moderation/accounts/${target.id}/warn`, { reason: 'Be nice' })).status, 200);
  // Not allowed
  assert.equal((await m.c.get('/api/admin/moderation/accounts')).status, 403);
  assert.equal((await m.c.post(`/api/admin/moderation/accounts/${target.id}/ban`, { kind: 'permanent', reason: 'Not allowed' })).status, 403);
  assert.equal((await m.c.post(`/api/admin/moderation/accounts/${target.id}/ban`, { kind: 'temporary', days: 30, reason: 'Not allowed' })).status, 403);
  assert.equal((await m.c.post(`/api/admin/moderation/accounts/${target.id}/reveal`, {})).status, 403);
  assert.equal((await m.c.put(`/api/admin/moderation/accounts/${target.id}/role`, { role: 'moderator', reason: 'x' })).status, 403);
  assert.equal((await m.c.post(`/api/admin/moderation/accounts/${m.id}/warn`, { reason: 'Myself' })).status, 403);
  // Nothing else in admin.
  for (const p of ['/api/admin/state', '/api/admin/players', '/api/admin/feedback', '/api/admin/badges']) assert.equal((await m.c.get(p)).status, 404, p);
  // A temporary ban up to 7 days is allowed, and is logged as the moderator's.
  const ok = await m.c.post(`/api/admin/moderation/accounts/${target.id}/ban`, { kind: 'temporary', days: 7, reason: 'Repeated spam' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.account.history[0].by, '@modone');
  // …but a permanent ban by the admin can't be lifted by a moderator.
  await t.client().post(`/api/admin/moderation/accounts/${target.id}/ban`, { kind: 'permanent', reason: 'Escalated' }, admin);
  const lift = await m.c.post(`/api/admin/moderation/accounts/${target.id}/unban`, { reason: 'Try' });
  assert.equal(lift.status, 403);
  // The setting off again: the moderator is an ordinary player at once.
  await t.client().put('/api/admin/settings/moderation.moderators', { value: false }, admin);
  assert.equal((await m.c.get('/api/admin/moderation/reports')).status, 404);
});

test('reports: anyone can report a profile; grouped by target; the reporter is never stored; honeypot; own profile refused', async () => {
  const admin = await adminHeaders();
  const a = await player('rep1', 'reportme', { ip: '198.51.100.90' });
  await a.c.put('/api/account/profile', { bio: 'Rude words go here', links: { twitch: 'rudestreamer' } });
  const out = t.client({ ip: '198.51.100.91' });
  assert.equal((await out.post('/api/users/reportme/report', { what: 'bio', note: 'See https://example.com/x' })).status, 200);
  const r2 = await player('rep2', 'reporterone', { ip: '198.51.100.92' });
  assert.equal((await r2.c.post('/api/users/reportme/report', { what: 'social', platform: 'twitch' })).status, 200);
  assert.equal((await r2.c.post('/api/users/reportme/report', { what: 'social', platform: 'youtube' })).status, 400);
  assert.equal((await a.c.post('/api/users/reportme/report', { what: 'username' })).status, 400);
  assert.equal((await out.post('/api/users/reportme/report', { what: 'bio', website: 'spam' })).status, 200);
  assert.equal((await t.db.one('SELECT count(*)::int AS n FROM reports WHERE target_account_id = $1', [a.id])).n, 2);
  const cols = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'reports'")).map((x) => x.column_name);
  assert.ok(!cols.some((c) => /reporter_(account|id|ip|network)/.test(c)), cols.join());

  const q = await t.client().get('/api/admin/moderation/reports', admin);
  const g = q.json.groups.find((x) => x.target.kind === 'account' && x.target.id === a.id);
  assert.equal(g.count, 2);
  assert.equal(g.target.label, '@reportme');
  assert.equal(g.items.find((x) => x.what === 'bio').snapshot.bio, 'Rude words go here');
  assert.equal(g.items.find((x) => x.what === 'social').snapshot.handle, 'rudestreamer');
  assert.ok(!JSON.stringify(q.json).includes('reporterone'));

  // Resetting the bio closes the open reports as actioned and tells the player.
  const reset = await t.client().post(`/api/admin/moderation/accounts/${a.id}/reset`, { field: 'bio', reason: 'Insults in the bio' }, admin);
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM reports WHERE target_account_id = $1 AND state = 'actioned'", [a.id])).n, 2);
  const n = await a.c.get('/api/account/notices');
  assert.equal(n.json.notices[0].title, 'Your bio was removed');
  assert.equal(n.json.notices[0].reason, 'Insults in the bio');
  assert.equal((await t.client().get('/api/users/reportme')).json.sections.find((x) => x.id === 'about')?.bio ?? null, null);

  // Dismissing a target's open reports.
  await out.post('/api/users/reportme/report', { what: 'username' });
  const d = await t.client().post('/api/admin/moderation/reports/resolve', { target: { kind: 'account', id: a.id }, state: 'dismissed' }, admin);
  assert.equal(d.status, 200);
  assert.equal(d.json.count, 1);
});

test('force a username change: placeholder, prompt, no rename used, old name held or released', async () => {
  const admin = await adminHeaders();
  const a = await player('ren1', 'badname', { ip: '198.51.100.95' });
  const r = await t.client().post(`/api/admin/moderation/accounts/${a.id}/rename`, { reason: 'Offensive username', hold: false }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = await a.c.get('/api/session');
  assert.equal(s.json.user.claimed, false);
  assert.equal(s.json.user.promptUsername, true);
  assert.equal(s.json.notices, 1);
  const acct = await t.db.one('SELECT rename_allowance FROM accounts WHERE id = $1', [a.id]);
  assert.equal(acct.rename_allowance, 1);
  assert.equal(await t.db.one("SELECT 1 AS x FROM username_holds WHERE name = 'badname'"), null);
});

test('admin accounts list: filters, search by former username, no BattleTag unless revealed (logged)', async () => {
  const admin = await adminHeaders();
  const list = await t.client().get('/api/admin/moderation/accounts?filter=banned', admin);
  assert.equal(list.status, 200);
  assert.ok(list.json.accounts.every((x) => x.status.id.includes('banned')));
  assert.ok(list.json.accounts.length >= 1);
  const ph = await t.client().get('/api/admin/moderation/accounts?filter=placeholder', admin);
  assert.ok(ph.json.accounts.every((x) => !x.claimed));
  const former = await t.client().get('/api/admin/moderation/accounts?q=badname', admin);
  assert.equal(former.json.accounts.length, 1);
  assert.ok(!JSON.stringify(former.json).includes('Secret'));
  const id = former.json.accounts[0].id;
  const detail = await t.client().get(`/api/admin/moderation/accounts/${id}`, admin);
  assert.ok(!JSON.stringify(detail.json).includes('Secret'));
  const rev = await t.client().post(`/api/admin/moderation/accounts/${id}/reveal`, {}, admin);
  assert.equal(rev.json.identities[0].displayName, 'Secretren1#1234');
  assert.equal((await t.db.one("SELECT count(*)::int AS n FROM moderation_actions WHERE account_id = $1 AND type = 'identities_revealed'", [id])).n, 1);
  // Paged: a cursor walks the list.
  const p1 = await t.client().get('/api/admin/moderation/accounts?limit=2', admin);
  assert.equal(p1.json.accounts.length, 2);
  const p2 = await t.client().get(`/api/admin/moderation/accounts?limit=2&cursor=${p1.json.next}`, admin);
  assert.ok(p2.json.accounts[0].id < p1.json.accounts[1].id || p2.json.accounts[0].id === undefined);
  // Without an admin session: the plain 404.
  assert.equal((await t.client().get('/api/admin/moderation/accounts')).status, 404);
});
