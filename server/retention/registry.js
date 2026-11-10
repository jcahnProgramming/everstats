/**
 * Every table in the database, classified (CLAUDE.md "Retention"). server/test/retention.test.js FAILS when a table
 * exists that isn't listed here, so a new table can't quietly hold Blizzard data past the window.
 *
 *   BLIZZARD  holds data that came from Blizzard's API. Each entry: what it holds, which column says when it was last
 *             fetched from Blizzard, and sweep(q, cutoff) → rows changed. The sweep deletes (or, for a character,
 *             strips to a stub of Everstats' own data) everything last fetched before the cutoff.
 *   OURS      Everstats' own data: why it isn't Blizzard data. Keeping a Blizzard ID (a character or statistic id) is
 *             allowed; the terms let us check that an ID still exists.
 *
 * Order matters: children before parents (foreign keys), characters last but one, then the catalog names.
 */
const n = (rows) => rows.length;

export const BLIZZARD = [
  {
    table: 'character_snapshots', holds: 'Daily copies of each character’s statistic values', fetched: 'taken_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_snapshots WHERE taken_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'period_baselines', holds: 'Each character’s first snapshot in a week / its oldest in the rolling window', fetched: 'taken_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM period_baselines WHERE taken_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'stat_gains', holds: 'Gains computed from snapshots (weekly / rolling boards)', fetched: 'period_start (week) · rebuilt on each fetch (rolling)',
    // A gain is derived from values; a weekly one whose week began before the cutoff, or any gain whose character
    // has no baseline left, goes.
    sweep: async (q, cutoff) => n(await q.query(
      `DELETE FROM stat_gains g WHERE (g.period = 'week' AND g.period_start < $1)
          OR NOT EXISTS (SELECT 1 FROM period_baselines b WHERE b.period = g.period AND b.period_start = g.period_start AND b.character_id = g.character_id)
        RETURNING 1`,
      [cutoff],
    )),
  },
  {
    table: 'pin_rank_history', holds: 'Daily ranks of pinned statistics (derived from values)', fetched: 'day',
    // Days are UTC days (stats/periods.js utcDay): compare in UTC, never the database session's time zone (0.9.1: right
    // after UTC midnight the two disagreed by a day, and a 30-day-old rank survived the sweep).
    sweep: async (q, cutoff) => n(await q.query("DELETE FROM pin_rank_history WHERE day < ($1::timestamptz AT TIME ZONE 'UTC')::date RETURNING 1", [cutoff])),
  },
  {
    table: 'character_statistics', holds: 'Current statistic values (and name + number texts)', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_statistics WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    // 0.6.0. Derived from values; a full grading rewrites them at least every 6 hours (tiers/store.js), so a row this
    // old belongs to a ruleset nobody grades any more.
    table: 'character_category_tiers', holds: 'Category tier scores and letters (derived from statistic values)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_category_tiers WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'character_tiers', holds: 'Overall tier scores, letters and per-statistic percentiles (derived from statistic values)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_tiers WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'tier_rulesets', holds: 'Each ruleset’s last full grading: population and letter cutoffs (derived from values)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM tier_rulesets WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    // 0.8.0: rendered share-card images show Blizzard values (and renders/icons). data_at is the OLDEST Blizzard fetch
    // behind the image; the cache also never keeps an image longer than cards/store.js CACHE_HOURS.
    table: 'share_card_images', holds: 'Rendered share-card PNGs (Blizzard values, renders and icons drawn in)', fetched: 'data_at',
    sweep: async (q, cutoff) => n(await q.query("DELETE FROM share_card_images WHERE data_at < $1 OR created_at < now() - interval '6 hours' RETURNING 1", [cutoff])),
  },
  {
    // 0.9.0: parsed collection lists per character and kind. data_fetched_at is when the data in the row came from
    // Blizzard (a failed refresh keeps the old data and its old date); a row whose data is older than the window goes,
    // and a "not returned" row with no data goes by when it was checked.
    table: 'character_collections', holds: 'Each character’s collections: mounts, pets, toys, titles, achievements, reputations, professions, encounters, quests, PvP summary, appearance ids', fetched: 'data_fetched_at (checked_at when no data)',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_collections WHERE coalesce(data_fetched_at, checked_at) < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'collection_catalog', holds: 'Blizzard’s static catalogs: names, icons, appearance slots and items, achievement rewards and criteria, faction groups, item qualities', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM collection_catalog WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    // Counts and the static namespace string read from Blizzard's links; a state row with nothing fresh behind it goes
    // (the catalogs job starts that catalog again).
    table: 'collection_catalog_state', holds: 'Each catalog’s size and refresh progress; the static namespace Blizzard’s links name', fetched: 'fetched_at',
    // 0.9.2: no exemption for a build in progress: a state row past the window goes whatever it says (the catalogs
    // job starts that catalog again), so nothing outlives the window plus one sweep interval.
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM collection_catalog_state WHERE coalesce(fetched_at, started_at) < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'collection_sharing', holds: 'Whether an account’s characters have identical collections (derived from collections)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM collection_sharing WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    // 0.9.0: opt-in gold. Only the four money numbers (collections/gold.js); read with the owner's token at sign-in, so
    // an owner who hasn't signed in for the window loses it ("Gold updates when the owner signs in").
    table: 'character_gold', holds: 'Gold on hand, total gold gained and lost, item value gained (protected-character data, the owner’s token)', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM character_gold WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'item_media', holds: 'Item icon URLs (render host)', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM item_media WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'account_character_checks', holds: 'How many characters a Battle.net account listed', fetched: 'checked_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM account_character_checks WHERE checked_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'crawl_queue', holds: 'Work items keyed by character / guild slugs', fetched: 'enqueued_at',
    sweep: async (q, cutoff) => n(await q.query("DELETE FROM crawl_queue WHERE enqueued_at < $1 AND state <> 'running' RETURNING 1", [cutoff])),
  },
  {
    // 0.9.0: a guild fetch's work list (character ids and slugs from the roster Blizzard sent). Deleted when the fetch
    // ends (guilds/fetchAll.js); this sweep only catches one left behind.
    table: 'guild_fetch_members', holds: 'A guild fetch’s work list: roster members’ ids and slugs', fetched: 'listed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM guild_fetch_members WHERE listed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    // 0.9.0: each "Fetch all members": state, times and counts read from Blizzard's roster (members, tracked, under 10).
    // Only the last one per guild matters (its cooldown is hours), so the whole row goes with the window.
    table: 'guild_fetches', holds: 'Guild fetches: when, state, and counts from the roster', fetched: 'requested_at',
    sweep: async (q, cutoff) => n(await q.query("DELETE FROM guild_fetches WHERE requested_at < $1 AND state NOT IN ('queued', 'running') RETURNING 1", [cutoff])),
  },
  {
    // 0.5.0. Derived from members' values; rebuilt at least every 6 hours (stats/guildTotals.js), so a row this old
    // belongs to a guild nobody rebuilds any more.
    table: 'guild_totals', holds: 'Guild totals and averages per statistic (derived from members’ values and gains)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM guild_totals WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'guild_populations', holds: 'How many tracked members each guild has per period (derived)', fetched: 'computed_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM guild_populations WHERE computed_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'guild_roster', holds: 'Guild rosters: member ids, rank numbers, levels', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM guild_roster WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'guild_slugs', holds: 'Every slug a guild was seen with (for redirects after a rename)', fetched: 'seen_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM guild_slugs WHERE seen_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'characters', holds: 'Profiles: name, surname, slug, level, race, class, faction, ruleset, guild, last login, render URLs, equipment and tooltips, core attributes',
    fetched: 'data_fetched_at (profile), media_fetched_at (render), last_fetched_at (equipment, attributes)',
    async sweep(q, cutoff) {
      // Render URLs and equipment / attributes age on their own clocks.
      let changed = n(await q.query(
        `UPDATE characters SET media = NULL, media_state = NULL, media_fetched_at = NULL
          WHERE media IS NOT NULL AND (media_fetched_at IS NULL OR media_fetched_at < $1) RETURNING 1`,
        [cutoff],
      ));
      changed += n(await q.query(
        `UPDATE characters SET equipment = NULL, attributes = NULL
          WHERE (equipment IS NOT NULL OR attributes IS NOT NULL) AND (last_fetched_at IS NULL OR last_fetched_at < $1) RETURNING 1`,
        [cutoff],
      ));
      // A character Blizzard hasn't returned for the whole window: strip every Blizzard field. The row stays as a stub
      // of our own data (id, owner, hidden, tracked since) and comes back when a sign-in or lookup finds it again.
      // 0.10.0: its game version, region, realm slug and Blizzard id stay too: where the stub lives (no name, no values).
      const gone = await q.query(
        `SELECT id FROM characters WHERE profile_state <> 'purged' AND (data_fetched_at IS NULL OR data_fetched_at < $1) LIMIT 50000`,
        [cutoff],
      );
      if (gone.length) {
        const ids = gone.map((r) => r.id);
        // Their guilds' totals lose them: rebuilt by the worker (0.5.0).
        await q.query('UPDATE guilds SET totals_dirty_at = now() WHERE id IN (SELECT guild_id FROM characters WHERE id = ANY($1::bigint[]) AND guild_id IS NOT NULL)', [ids]);
        for (const t of ['character_collections', 'character_gold', 'character_statistics', 'character_snapshots', 'period_baselines', 'stat_gains', 'pin_rank_history', 'character_category_tiers', 'character_tiers']) {
          await q.query(`DELETE FROM ${t} WHERE character_id = ANY($1::bigint[])`, [ids]);
        }
        await q.query(
          `UPDATE characters SET slug = NULL, name = NULL, surname = '', ruleset_id = NULL, faction = NULL, race = NULL, class = NULL,
             gender = NULL, level = NULL, account_level = NULL, guild_id = NULL, last_login_at = NULL, login_at_full = NULL,
             media = NULL, media_state = NULL, media_fetched_at = NULL, equipment = NULL, attributes = NULL,
             stats_fetched_at = NULL, last_fetched_at = NULL, last_checked_at = NULL, data_fetched_at = NULL, missing_since = NULL,
             profile_state = 'purged', purged_at = now()
           WHERE id = ANY($1::bigint[])`,
          [ids],
        );
        changed += ids.length;
      }
      return changed;
    },
  },
  {
    table: 'guilds', holds: 'Guild names, slugs, factions, rulesets, roster sizes; profile member count and created date',
    fetched: 'updated_at (seen on a profile or fetched), profile_fetched_at (member count, created date)',
    async sweep(q, cutoff) {
      // The profile's own fields age on their own clock (a guild can stay alive through its members' profiles).
      let changed = n(await q.query(
        `UPDATE guilds SET member_count = NULL, created_at_blizzard = NULL, profile_fetched_at = NULL, profile_state = NULL
          WHERE profile_fetched_at < $1 RETURNING 1`,
        [cutoff],
      ));
      const old = await q.query('SELECT id FROM guilds WHERE updated_at < $1 LIMIT 50000', [cutoff]);
      if (!old.length) return changed;
      const ids = old.map((r) => r.id);
      await q.query('UPDATE characters SET guild_id = NULL WHERE guild_id = ANY($1::bigint[])', [ids]);
      // guild_roster, guild_slugs, guild_totals and guild_populations go with it (ON DELETE CASCADE).
      changed += n(await q.query('DELETE FROM guilds WHERE id = ANY($1::bigint[]) RETURNING 1', [ids]));
      return changed;
    },
  },
  {
    // 0.10.0: realms of the versions that have them (realm/{slug}): names and types, re-read daily by a crawl that
    // needs them. Before rulesets: a realm names its realm category.
    table: 'realms', holds: 'Realm names and types (versions with realms)', fetched: 'fetched_at',
    sweep: async (q, cutoff) => n(await q.query('DELETE FROM realms WHERE fetched_at < $1 RETURNING 1', [cutoff])),
  },
  {
    table: 'rulesets', holds: 'Ruleset and realm-type names (each version’s realm categories)', fetched: 'updated_at',
    // Re-read from Blizzard every 6 hours; one still referenced by a fresh character can't be this old.
    sweep: async (q, cutoff) => n(await q.query(
      `DELETE FROM rulesets r WHERE r.updated_at < $1
          AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.ruleset_id = r.id) AND NOT EXISTS (SELECT 1 FROM guilds g WHERE g.ruleset_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM realms m WHERE m.category_id = r.id)
        RETURNING 1`,
      [cutoff],
    )),
  },
  {
    table: 'statistics', holds: 'Statistic names and Blizzard’s category names (the ids, and the owner’s decisions on them, are ours)', fetched: 'last_seen_at',
    sweep: async (q, cutoff) => n(await q.query(
      // 0.9.0: a statistic Everstats counts (derived) has OUR name and category, never Blizzard's: it keeps them.
      `UPDATE statistics SET name = NULL, category_path = '[]', named_example = NULL WHERE name IS NOT NULL AND (derived IS NULL OR derived LIKE '%:%') AND last_seen_at < $1 RETURNING 1`,
      [cutoff],
    )),
  },
  {
    table: 'discovery_responses', holds: 'Raw Blizzard response bodies from discovery runs', fetched: 'fetched_at (by run)',
    sweep: async () => 0, // deleted with their run (discovery_runs)
  },
  {
    table: 'discovery_statistics', holds: 'Each run’s statistics catalog (names, values)', fetched: 'its run',
    sweep: async () => 0, // deleted with their run
  },
  {
    table: 'discovery_runs', holds: 'Discovery runs: options (a character name), summaries quoting responses', fetched: 'requested_at',
    async sweep(q, cutoff) {
      const old = await q.query("SELECT id FROM discovery_runs WHERE requested_at < $1 AND status <> 'running' LIMIT 1000", [cutoff]);
      if (!old.length) return 0;
      const ids = old.map((r) => r.id);
      await q.query('UPDATE discovery_decisions SET run_id = NULL WHERE run_id = ANY($1::bigint[])', [ids]);
      let changed = n(await q.query('DELETE FROM discovery_responses WHERE run_id = ANY($1::bigint[]) RETURNING 1', [ids]));
      changed += n(await q.query('DELETE FROM discovery_statistics WHERE run_id = ANY($1::bigint[]) RETURNING 1', [ids]));
      changed += n(await q.query('DELETE FROM discovery_runs WHERE id = ANY($1::bigint[]) RETURNING 1', [ids]));
      q.rebuildCombined = true; // the combined catalog is rebuilt from what's left (sweep.js)
      return changed;
    },
  },
  {
    table: 'discovery_catalog', holds: 'The combined catalog (names, values) built from discovery runs', fetched: 'its runs',
    sweep: async () => 0, // rebuilt from the remaining runs after a run is deleted (sweep.js)
  },
  {
    table: 'discovery_combined', holds: 'The combined catalog’s summary (rulesets, factions)', fetched: 'its runs',
    sweep: async () => 0, // rebuilt with the catalog
  },
  {
    table: 'discovery_decisions', holds: 'The owner’s decisions (ours), whose reasoning text QUOTES Blizzard names', fetched: 'decided_at',
    // The decision (kind, value, approved/rejected) is ours and stays; the quoted Blizzard text is blanked.
    sweep: async (q, cutoff) => n(await q.query("UPDATE discovery_decisions SET reasoning = '' WHERE reasoning <> '' AND decided_at < $1 RETURNING 1", [cutoff])),
  },
];

export const OURS = {
  _migrations: 'Which migrations ran',
  // 0.10.2
  environment_marker: 'Which environment (production or dev) this database belongs to, so the other one refuses it',
  // 0.10.0
  blizzard_ids: 'Everstats’ own id for a Blizzard id on a version other than the native one (numbers only: Blizzard’s terms let us keep an id), so a stub keeps the id it lives under',
  discovery_group_decisions: 'The owner’s tier choices per group and game version (counts / own letter only / doesn’t count)',
  accounts: 'Accounts, usernames, display names, bios, settings, beta membership',
  account_identities: 'Sign-in links (provider ids, BattleTag/Discord label from the provider’s sign-in, not the game API)',
  passkeys: 'Passkeys',
  account_totp: '2FA secrets (sealed)',
  recovery_codes: 'Recovery code hashes',
  sessions: 'Sessions',
  auth_flows: 'Short-lived sign-in state',
  account_events: 'Account history (types and our ids only)',
  account_pins: 'Which statistic ids a player pinned',
  account_social_links: 'Social handles the player typed',
  credentials: 'API keys (sealed)',
  settings: 'Admin settings',
  admin_passkeys: 'Admin passkeys',
  admin_invites: 'Admin invites',
  admin_sessions: 'Admin sessions',
  admin_events: 'Admin history (setting keys, ids, counts)',
  worker_status: 'Worker heartbeat and job summaries (counts)',
  backup_runs: 'Backup attempts (times, sizes)',
  discovery_grants: 'The admin’s Battle.net token for discovery (a credential; deleted when it expires)',
  crawler_hours: 'Request counts per hour',
  crawler_status: 'Crawler status (counts, current work)',
  pipeline_facts: 'When the first snapshot was taken, when one-time back-fills ran, when Activity counting began and the admin’s “last checked” marker',
  beta_windows: 'Beta open/close dates',
  username_holds: 'Usernames held after a rename',
  username_history: 'Username changes',
  reserved_names: 'Reserved usernames',
  retention_sweeps: 'What each retention sweep deleted (counts, times)',
  tier_runs: 'Full tier gradings and requests for one: times, reasons, letter counts (0.6.0)',
  // 0.7.0: badges. Definitions are ours (names and art from our design; a partner mark is the admin's upload). An award
  // keeps at most the Blizzard ID of the character that earned it, never a Blizzard value (name, level, class, faction).
  badge_definitions: 'Badge definitions: our names, descriptions, art keys and admin-uploaded partner marks (0.7.0)',
  badge_awards: 'Which account holds which badge, when and how (rule or admin grant + reason), display choices; character ids only (0.7.0)',
  badge_events: 'Badge log: grants, earns, revokes, removals, mark changes, the back-fill (ids, reasons, counts) (0.7.0)',
  // 0.7.0: guild page management. Written by Guild Masters and officers, keyed on Blizzard guild ids (allowed).
  guild_pages: 'Guild page description and Discord invite written by its Guild Master or officers; who we last recorded as Guild Master (ids) (0.7.0)',
  guild_editors: 'Officers a Guild Master added (account ids, dates) (0.7.0)',
  guild_links: 'Links a Guild Master or officer added (label, https URL, domain) (0.7.0)',
  guild_link_reports: '"Report this link" queue (link ids, optional note) (0.7.0)',
  link_blocklist: 'Domains the admin refuses in guild links (0.7.0)',
  guild_events: 'Guild page log: changes of control, edits, officers (ids) (0.7.0)',
  // 0.7.1. Guild badge progress is never stored: it is read live from guild_totals / the tracked members (Blizzard
  // data above), so it follows the window with them. Awards hold levels, dates and board ids, never a Blizzard value.
  guild_badge_definitions: 'Guild badge definitions: our names, art keys, thresholds and rules (0.7.1)',
  guild_badge_awards: 'Which guild holds which guild badge, at which level, since when; display choices; board ids only (0.7.1)',
  guild_badge_events: 'Guild badge log: unlocks, losses, grants, threshold and display changes, the back-fill (ids, counts, reasons) (0.7.1)',
  guild_badge_toast_seen: 'How far each Guild Master or officer has seen their guild’s badge toasts (0.7.1)',
  guild_partner_marks: 'Partner guild emblems the admin uploaded with written permission (re-encoded PNG) (0.7.1)',
  // 0.8.0: a share-card default is the owner's (or a guild editor's) choice of layout, theme, accent, toggles and
  // statistic ids. Keyed on a Blizzard character or guild id (allowed); no Blizzard value is stored in it.
  share_card_defaults: 'Share-card designs saved as the default by a character’s owner or a guild’s editors: options and ids (0.8.0)',
  creator_verifications: 'A creator verification: the code Everstats made for the account and where the check stands (0.8.1)',
  creator_handles: 'Social handles the admin checked for a Verified Content Creator, as they were when checked (0.8.1)',
  character_render_hidden: 'Characters whose owner chose “Hide my render” (character id, who, when) (0.7.1)',
  feedback_threads: 'Feedback players sent: type, the Everstats page it was about, an optional Discord name (0.7.1)',
  feedback_messages: 'Feedback messages and Everstats’ replies, plain text (0.7.1)',
  feedback_notes: 'The admin’s private notes on feedback (0.7.1)',
  activity_counts: 'Admin Activity: a count of each kind of event per hour, nothing about who (0.7.1)',
  // 0.8.2: moderation. All ours: what the admin or a moderator did and why, and what players reported.
  account_bans: 'Bans: temporary or permanent, the reason, the message to the player, and how each was lifted (0.8.2)',
  ban_identities: 'The sign-in identities and passkey ids a banned account had when its ban started (ban evasion) (0.8.2)',
  moderation_actions: 'Moderation log: warnings, forced renames, field resets, bans, unbans, role changes, reveals, report decisions (0.8.2)',
  collection_backfill_days: 'How many first collections fetches the backfill queued each day (counts) (0.9.2)',
  account_guilds: 'Guilds a player follows on their dashboard, own guilds they hid from it, and the order (Blizzard guild ids only) (0.9.1)',
  character_gold_public: 'The owner’s “Show my gold stats publicly” choice per character (character id, account id, since) (0.9.0)',
  reports: 'Player reports about profiles and guild descriptions: what, an optional note, the reported text as it was; no reporter (0.8.2)',
};

/** Oldest "last fetched from Blizzard" per category still stored (for the admin page). */
export const OLDEST = [
  ['character_snapshots', 'SELECT min(taken_at) AS t FROM character_snapshots'],
  ['period_baselines', 'SELECT min(taken_at) AS t FROM period_baselines'],
  ['character_statistics', 'SELECT min(fetched_at) AS t FROM character_statistics'],
  ['characters (profiles)', "SELECT min(data_fetched_at) AS t FROM characters WHERE profile_state <> 'purged'"],
  ['characters (renders)', 'SELECT min(media_fetched_at) AS t FROM characters WHERE media IS NOT NULL'],
  ['characters (gear, attributes)', 'SELECT min(last_fetched_at) AS t FROM characters WHERE equipment IS NOT NULL OR attributes IS NOT NULL'],
  ['item_media', 'SELECT min(fetched_at) AS t FROM item_media'],
  ['character_collections', 'SELECT min(coalesce(data_fetched_at, checked_at)) AS t FROM character_collections'],
  ['collection_catalog', 'SELECT min(fetched_at) AS t FROM collection_catalog'],
  ['character_gold', 'SELECT min(fetched_at) AS t FROM character_gold'],
  ['share_card_images', 'SELECT min(data_at) AS t FROM share_card_images'],
  ['guilds', 'SELECT min(updated_at) AS t FROM guilds'],
  ['guilds (profiles)', 'SELECT min(profile_fetched_at) AS t FROM guilds'],
  ['guild_roster', 'SELECT min(fetched_at) AS t FROM guild_roster'],
  ['guild_slugs', 'SELECT min(seen_at) AS t FROM guild_slugs'],
  ['guild_totals', 'SELECT min(computed_at) AS t FROM guild_totals'],
  ['guild_populations', 'SELECT min(computed_at) AS t FROM guild_populations'],
  ['character_tiers', 'SELECT min(computed_at) AS t FROM character_tiers'],
  ['character_category_tiers', 'SELECT min(computed_at) AS t FROM character_category_tiers'],
  ['tier_rulesets', 'SELECT min(computed_at) AS t FROM tier_rulesets'],
  ['rulesets', 'SELECT min(updated_at) AS t FROM rulesets'],
  ['realms', 'SELECT min(fetched_at) AS t FROM realms'],
  ['statistics (names)', 'SELECT min(last_seen_at) AS t FROM statistics WHERE name IS NOT NULL AND derived IS NULL'],
  // A calendar (UTC) day, so its age is counted from that day's start: up to a day older-looking than an exact time.
  ['pin_rank_history (by UTC day)', "SELECT (min(day)::timestamp AT TIME ZONE 'UTC') AS t FROM pin_rank_history"],
  ['account_character_checks', 'SELECT min(checked_at) AS t FROM account_character_checks'],
  ['discovery_runs', 'SELECT min(requested_at) AS t FROM discovery_runs'],
  ['crawl_queue', 'SELECT min(enqueued_at) AS t FROM crawl_queue'],
  ['guild_fetches', 'SELECT min(requested_at) AS t FROM guild_fetches'],
  ['guild_fetch_members', 'SELECT min(listed_at) AS t FROM guild_fetch_members'],
];
