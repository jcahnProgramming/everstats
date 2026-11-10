// Realistic-length FIXTURES for the visual pass (0.10.4), so scripts/check-overflow.js measures pages the way real data
// fills them. 0.10.3's admin tables overflowed their cards on dev while the check passed: it ran on short synthetic
// names and empty tables. This fills a LOCAL database with the longest values the rules allow and every column set:
//   - usernames at the 20-character maximum, long display names, long BattleTag-style labels, long bios;
//   - characters (12-letter names, long surnames) and 24-character guild names on all five game versions;
//   - crawl work on every priority and every version, bans, warnings, reports and feedback with long reasons;
//   - statistics and tier group decisions per version with long labels and long reasoning.
//
//   DATABASE_URL=postgres://postgres@127.0.0.1:5449/postgres node scripts/seed-overflow-fixtures.js
//
// It REFUSES anything but a local database: the host must be 127.0.0.1 / localhost and the database's environment
// marker must say 'local'. Every value is synthetic and labelled "Fixture"; never point it at dev or production (CLAUDE.md
// "Honesty rules": fixtures belong in tests and local runs only). It prints the check-overflow flags at the end: an admin
// session cookie for THIS local database, and the ids of an account, a guild and a feedback thread.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { GAME_VERSIONS, REGIONS } from '../server/core/gameVersions.js';

const url = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5439/postgres';
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing: ${host} is not a local database. Fixtures only ever go into a local one.`);
  process.exit(1);
}
const db = new pg.Client(url);
await db.connect();
const marker = await db.query('SELECT environment FROM environment_marker LIMIT 1').catch(() => ({ rows: [] }));
if (marker.rows[0]?.environment && marker.rows[0].environment !== 'local') {
  console.error(`Refusing: this database belongs to "${marker.rows[0].environment}".`);
  process.exit(1);
}
const q = (sql, params) => db.query(sql, params);
const hours = (n) => new Date(Date.now() - n * 3600_000);
const pick = (arr, i) => arr[i % arr.length];

const versions = GAME_VERSIONS.map((v) => v.id);
const REGION = (REGIONS.find((r) => r.enabled) ?? REGIONS[0]).id;
const SYL = ['thal', 'dris', 'mor', 'vexa', 'quin', 'bryn', 'zel', 'ora', 'kael', 'lun', 'fen', 'gar'];
const word = (i, n) => Array.from({ length: n }, (_, k) => pick(SYL, i * 7 + k * 3)).join('');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const name12 = (i) => cap(word(i, 4)).slice(0, 12);

await q('BEGIN');
// Rulesets / realm categories, one per version with a long name.
const rulesetOf = {};
for (const [i, v] of versions.entries()) {
  const id = 9100 + i;
  await q(`INSERT INTO rulesets (id, name, listed, updated_at, game_version, region) VALUES ($1, $2, true, now(), $3, '${REGION}') ON CONFLICT (id) DO NOTHING`,
    [id, `Fixture Roleplay Player versus Player ${i + 1}`, v]);
  rulesetOf[v] = id;
}
// Guilds: 24-character names (Blizzard's maximum), every version.
const guilds = [];
for (let i = 0; i < 10; i++) {
  const v = pick(versions, i);
  const id = 91000 + i;
  const gname = `Fixture ${cap(word(i, 4))} of Stormlight`.slice(0, 24);
  await q(`INSERT INTO guilds (id, slug, name, faction, ruleset_id, updated_at, roster_members, member_count, profile_state, profile_fetched_at, game_version, region, realm_slug, blizzard_id)
           VALUES ($1, $2, $3, $4, $5, now(), 412, 412, 'ok', now(), $6, '${REGION}', $7, $1) ON CONFLICT (id) DO NOTHING`,
    [id, `fixture-guild-${i}`, gname, i % 2 ? 'HORDE' : 'ALLIANCE', rulesetOf[v], v, v === 'forever' ? null : 'fixture-realm']);
  guilds.push(id);
}
// Accounts: usernames at the 20-character maximum, long display names and bios, every sign-in method.
const accounts = [];
for (let i = 0; i < 40; i++) {
  const username = `fixture_${word(i, 4)}`.slice(0, 17) + String(i).padStart(3, '0'); // 20: the maximum
  const r = await q(
    `INSERT INTO accounts (username, username_claimed, display_name, profile_bio, beta_member, role, created_at)
     VALUES ($1, true, $2, $3, $4, $5, $6) RETURNING id`,
    [username, `Fixture ${cap(word(i, 3))} the Unrelenting Longname`.slice(0, 32), // 32: the maximum
      `Fixture bio ${'lorem ipsum dolor sit amet '.repeat(10)}`.slice(0, 280),
      false, i === 3 ? 'moderator' : 'player', hours(i * 37)],
  );
  if (!r.rows[0]) continue;
  const id = r.rows[0].id;
  accounts.push(id);
  for (const provider of i % 3 === 0 ? ['battlenet', 'discord'] : [pick(['battlenet', 'discord'], i)]) {
    await q('INSERT INTO account_identities (account_id, provider, subject, display_name, last_used_at) VALUES ($1, $2, $3, $4, $5)',
      [id, provider, `fixture-${provider}-${id}`, provider === 'battlenet' ? `Fixture${cap(word(i, 2))}#123456` : `fixture.${word(i, 3)}.long`, hours(i)]);
  }
}
// Characters: 12-letter names, long surnames, every version, owned and not, one hidden.
let cid = 9_100_000;
for (let i = 0; i < 150; i++) {
  const v = pick(versions, i);
  cid += 1;
  const name = name12(i);
  const surname = cap(word(i + 3, 3));
  await q(`INSERT INTO characters (id, slug, name, surname, ruleset_id, faction, race, class, level, guild_id, profile_state, source, data_fetched_at, last_fetched_at, stats_fetched_at,
             owner_account_id, owned_since, hidden, game_version, region, realm_slug, blizzard_id, tracked_since)
           VALUES ($1, $2, $3, $4, $5, $6, 'Highmountain Tauren', 'Demon Hunter', 60, $7, 'ok', 'lookup', now(), now(), now(), $8, now(), $9, $10, '${REGION}', $11, $1, now())
           ON CONFLICT (id) DO NOTHING`,
    [cid, `${name}-${surname}`.toLowerCase() + (i > 11 ? i : ''), name, surname, rulesetOf[v], i % 2 ? 'HORDE' : 'ALLIANCE', pick(guilds, i),
      accounts.length ? pick(accounts, i) : null, i === 7, v, v === 'forever' ? null : 'fixture-realm']);
}
// Crawl work: every priority on every version, waiting and running, with old enqueue times.
for (let i = 0; i < 300; i++) {
  const v = pick(versions, i);
  await q(`INSERT INTO crawl_queue (kind, key, priority, state, enqueued_at, started_at, game_version, region) VALUES ('character', $1, $2, $3, $4, $5, $6, '${REGION}')`,
    [`fixture-${i}`, 1 + (i % 5), i % 11 === 0 ? 'running' : 'queued', hours(i % 50), i % 11 === 0 ? hours(0) : null, v]);
}
// Statistics with long Blizzard-style category labels per version, and group decisions with long reasoning.
// The top category names are the ones discovery/suggest.js CATEGORY_RULES file groups by; the second level is long.
const TOPS = ['Kills', 'Deaths', 'Social', 'Player vs. Player', 'Quests', 'Skills', 'Dungeons & Raids', 'Character', 'Travel'];
const GROUPS = ['Combat', 'Deaths & mishaps', 'Social', 'PvP', 'Adventure', 'Professions', 'Dungeons & Raids', 'Character'];
let sid = 9_200_000;
for (const v of versions) {
  for (const [j, top] of TOPS.entries()) {
    for (let k = 0; k < 4; k++) {
      sid += 1;
      await q(`INSERT INTO statistics (id, name, category_path, last_seen_at, game_version, blizzard_id) VALUES ($1, $2, $3::jsonb, now(), $4, $1) ON CONFLICT (id) DO NOTHING`,
        [sid, `Fixture statistic ${j}-${k}: total number of extraordinarily long-named things done`, JSON.stringify([{ name: top }, { name: `Fixture ${top}: Legacy Encounters and Their Many Bosses` }]), v]);
    }
  }
  // Forever's group choices (others start undecided and show Forever's as a suggestion), long reasoning.
  if (v === versions[0]) {
    for (const [j, g] of GROUPS.entries()) {
      await q(`INSERT INTO discovery_group_decisions (game_version, group_label, choice, reasoning, origin) VALUES ($1, $2, $3, $4, 'admin')`,
        [v, g, pick(['counts', 'category', 'none'], j), `Fixture reasoning: ${'a long explanation of why this group counts the way it does, '.repeat(4)}`]);
    }
  }
}
// Moderation: bans, warnings and reports with long reasons; feedback threads.
const LONG = `Fixture reason: ${'repeated harassment in guild descriptions after two earlier warnings, see reports '.repeat(3)}`;
let feedbackId = null;
for (const [i, a] of accounts.slice(0, 12).entries()) {
  if (i % 4 === 0) await q(`INSERT INTO account_bans (account_id, kind, ends_at, reason, message, actor) VALUES ($1, 'temporary', now() + interval '3 days', $2, $2, 'admin')`, [a, LONG]);
  await q(`INSERT INTO moderation_actions (account_id, type, actor, reason, message, detail, notice) VALUES ($1, 'warning', 'admin', $2, $2, '{}'::jsonb, true)`, [a, LONG]);
  await q(`INSERT INTO reports (target_kind, target_account_id, what, note, snapshot, reporter_signed_in) VALUES ('account', $1, 'bio', $2, $3::jsonb, true)`,
    [a, LONG.slice(0, 500), JSON.stringify({ bio: LONG })]);
  const f = await q(`INSERT INTO feedback_threads (account_id, type, page, discord, state, player_unread) VALUES ($1, 'bug', '/c/fixture-character-with-a-long-address/collections/transmog', 'fixture.discord.name.long', 'unread', true) RETURNING id`, [a]);
  feedbackId ??= f.rows[0].id;
  await q(`INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'player', $2)`, [f.rows[0].id, LONG]);
}
await q(`INSERT INTO admin_events (type, detail) VALUES ('setting.changed', $1::jsonb)`, [JSON.stringify({ key: 'crawler.requestsPerSecond', before: 8, value: 8, reason: LONG })]);
// Statistic values for Forever's characters: varied boards for ranks, and one board where everyone is tied (the
// leaderboards index's tied card). Plus a pinned badge for the first account (the profile's featured character).
await q(`INSERT INTO character_statistics (character_id, statistic_id, ruleset_id, value, fetched_at)
         SELECT c.id, s.id, c.ruleset_id, CASE WHEN s.id % 9 = 1 THEN 5 ELSE ((c.id * 7 + s.id * 13) % 997) + 1 END, now()
           FROM characters c JOIN statistics s ON s.game_version = c.game_version
          WHERE c.game_version = $1 AND c.id BETWEEN 9100001 AND 9100150 ON CONFLICT DO NOTHING`, [versions[0]]);
if (accounts.length) {
  await q(`INSERT INTO badge_awards (account_id, badge_id, state, source, reason, shown, featured, pinned)
           SELECT $1, id, 'held', 'admin', 'Fixture grant', true, true, true FROM badge_definitions WHERE family = 'partner' ORDER BY sort LIMIT 1
           ON CONFLICT DO NOTHING`, [accounts[0]]);
}
// An admin session for THIS local database (2 hours), for check-overflow --admin.
const token = randomBytes(32).toString('base64url');
await q(`INSERT INTO admin_sessions (id_hash, expires_at) VALUES ($1, now() + interval '2 hours')`, [createHash('sha256').update(token).digest('hex')]);
await q('COMMIT');
await db.end();
console.log(`Fixtures in. ${accounts.length} accounts, 150 characters, 10 guilds, 300 crawl items, ${versions.length} versions.`);
console.log(`node scripts/check-overflow.js <base> --admin=${token} --admin-ids=account:${accounts[0]},guild:${guilds[0]},feedback:${feedbackId}`);
