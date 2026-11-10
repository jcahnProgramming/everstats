import { snapshotTablespace } from './tablespace.js';

/**
 * Migrations, applied in order and recorded in _migrations (core/migrations.js). Each is { id: '001_name', up(q) }.
 * Never edit or reorder one that has shipped: add a new one.
 *
 * Rules every table follows (CLAUDE.md, "Data rules"):
 *   - every time-series table has a composite index on (parent_id, timestamp)
 *   - nothing is deleted except where CLAUDE.md names the exception
 *   - Blizzard-shaped tables (007+) are shaped by what the discovery runs stored, never by memory. Snapshot tables go in
 *     the "snapshots" tablespace (core/tablespace.js).
 */
export const migrations = [
  {
    // Accounts and everything that signs into one: provider identities, passkeys, 2FA, recovery codes, sessions, and
    // the short-lived flows (OAuth state, passkey challenges, merge proposals) that sit between two requests.
    id: '001_accounts',
    async up(q) {
      await q.query(`
        CREATE TABLE accounts (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          created_at  timestamptz NOT NULL DEFAULT now(),
          -- Logged-out visitors always see Forever; a signed-in account's choice lives here, never in the browser.
          theme       text NOT NULL DEFAULT 'forever' CHECK (theme IN ('forever', 'alliance', 'horde'))
        );

        -- One row per sign-in identity (a Battle.net account, a Discord user). (provider, subject) is unique: an
        -- identity belongs to exactly one Everstats account. Nothing ever links by email or any other attribute.
        CREATE TABLE account_identities (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          provider      text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
          subject       text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
          -- What the provider calls the person (BattleTag, Discord username), shown in Settings. A label, refreshed
          -- at each sign-in; never used to match anyone.
          display_name  text NOT NULL DEFAULT '' CHECK (length(display_name) <= 100),
          linked_at     timestamptz NOT NULL DEFAULT now(),
          last_used_at  timestamptz,
          UNIQUE (provider, subject)
        );
        CREATE INDEX account_identities_account ON account_identities (account_id, linked_at);

        CREATE TABLE passkeys (
          id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id     bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          credential_id  text NOT NULL UNIQUE,           -- base64url
          public_key     bytea NOT NULL,
          sign_count     bigint NOT NULL DEFAULT 0,
          transports     text[] NOT NULL DEFAULT '{}',
          name           text NOT NULL DEFAULT 'Passkey' CHECK (length(name) BETWEEN 1 AND 60),
          created_at     timestamptz NOT NULL DEFAULT now(),
          last_used_at   timestamptz
        );
        CREATE INDEX passkeys_account ON passkeys (account_id, created_at);

        -- TOTP 2FA. The secret is sealed with the root key (credentials/crypto.js, slot "totp.<account id>").
        -- pending: set up but not yet confirmed with a first code. enabled: asked for after Battle.net / Discord.
        CREATE TABLE account_totp (
          account_id   bigint PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
          state        text NOT NULL CHECK (state IN ('pending', 'enabled')),
          ciphertext   bytea NOT NULL,
          iv           bytea NOT NULL,
          auth_tag     bytea NOT NULL,
          key_fp       text NOT NULL,
          -- The last 30-second step a code was accepted for: the same code (or an older one) is never accepted twice.
          last_step    bigint NOT NULL DEFAULT 0,
          created_at   timestamptz NOT NULL DEFAULT now(),
          enabled_at   timestamptz
        );

        -- One-time recovery codes, shown once when 2FA is turned on. Only an HMAC of each is stored.
        CREATE TABLE recovery_codes (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          code_hash   text NOT NULL,
          created_at  timestamptz NOT NULL DEFAULT now(),
          used_at     timestamptz,
          UNIQUE (account_id, code_hash)
        );
        CREATE INDEX recovery_codes_account ON recovery_codes (account_id, created_at);

        -- Sessions. The cookie holds a random token; only its SHA-256 is stored. stage 'second_factor' is a
        -- half-signed-in session waiting for its 2FA code: it can do nothing else.
        CREATE TABLE sessions (
          id_hash       text PRIMARY KEY,
          account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          stage         text NOT NULL CHECK (stage IN ('second_factor', 'full')),
          method        text NOT NULL,                  -- provider id or 'passkey'
          created_at    timestamptz NOT NULL DEFAULT now(),
          last_seen_at  timestamptz NOT NULL DEFAULT now(),
          expires_at    timestamptz NOT NULL
        );
        CREATE INDEX sessions_account ON sessions (account_id, created_at);
        CREATE INDEX sessions_expiry ON sessions (expires_at);

        -- Short-lived state between two requests: OAuth state + PKCE verifier, passkey challenges, merge proposals.
        -- The browser holds a random token (cookie); only its SHA-256 is stored. Used once, then deleted.
        CREATE TABLE auth_flows (
          id_hash     text PRIMARY KEY,
          purpose     text NOT NULL,
          account_id  bigint REFERENCES accounts (id) ON DELETE CASCADE,
          data        jsonb NOT NULL DEFAULT '{}',
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL
        );
        CREATE INDEX auth_flows_expiry ON auth_flows (expires_at);

        -- What happened to an account (signed in, linked, unlinked, 2FA on/off, merged in). Never secrets.
        CREATE TABLE account_events (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          type        text NOT NULL,
          detail      jsonb NOT NULL DEFAULT '{}',
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX account_events_account_time ON account_events (account_id, created_at);
      `);
    },
  },
  {
    // The admin side: credentials (the API key manager), admin settings, the admin's own passkeys, sessions and
    // one-time enrolment invites, and the worker's heartbeat.
    id: '002_admin',
    async up(q) {
      await q.query(`
        -- Credentials entered in the admin key manager (credentials/registry.js declares what exists). Secret fields
        -- are sealed with the root key; nothing here is ever sent to a browser.
        CREATE TABLE credentials (
          provider    text NOT NULL,
          field       text NOT NULL,
          ciphertext  bytea NOT NULL,
          iv          bytea NOT NULL,
          auth_tag    bytea NOT NULL,
          key_fp      text NOT NULL,
          set_at      timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (provider, field)
        );

        -- Admin settings (admin/settings.js declares each key, its type, bounds and default). A missing row means
        -- the declared default.
        CREATE TABLE settings (
          key         text PRIMARY KEY,
          value       jsonb NOT NULL,
          updated_at  timestamptz NOT NULL DEFAULT now()
        );

        -- The admin is not an account: a separate identity, passkey only, enrolled with a one-time invite printed on
        -- the server (server/tools/admin-invite.js).
        CREATE TABLE admin_passkeys (
          id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          credential_id  text NOT NULL UNIQUE,
          public_key     bytea NOT NULL,
          sign_count     bigint NOT NULL DEFAULT 0,
          transports     text[] NOT NULL DEFAULT '{}',
          name           text NOT NULL DEFAULT 'Admin passkey' CHECK (length(name) BETWEEN 1 AND 60),
          created_at     timestamptz NOT NULL DEFAULT now(),
          last_used_at   timestamptz
        );
        CREATE TABLE admin_invites (
          token_hash  text PRIMARY KEY,
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL,
          used_at     timestamptz
        );
        CREATE TABLE admin_sessions (
          id_hash     text PRIMARY KEY,
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL
        );

        -- Admin changes (a key set or removed, a setting changed): which, never a value.
        CREATE TABLE admin_events (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          type        text NOT NULL,
          detail      jsonb NOT NULL DEFAULT '{}',
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX admin_events_type_time ON admin_events (type, created_at);

        -- One row per worker process: what it is doing, written on every tick of its loop. The admin's crawler
        -- status reads it; the worker's own /api/health reports the same thing live.
        CREATE TABLE worker_status (
          worker_id     text PRIMARY KEY,
          version       text NOT NULL,
          started_at    timestamptz NOT NULL,
          last_tick_at  timestamptz NOT NULL,
          state         text NOT NULL,
          jobs          jsonb NOT NULL DEFAULT '[]'
        );
      `);
    },
  },
  {
    // Nightly database backups (core/backup.js): one row per attempt, so the admin page and the worker's health can
    // say when the last good one finished, how big it was, and why the last failure failed. Kept forever (tiny).
    id: '003_backup_runs',
    async up(q) {
      await q.query(`
        CREATE TABLE backup_runs (
          id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          trigger      text NOT NULL CHECK (trigger IN ('nightly', 'manual')),
          outcome      text NOT NULL CHECK (outcome IN ('running', 'ok', 'failed')),
          started_at   timestamptz NOT NULL DEFAULT now(),
          finished_at  timestamptz,
          file_name    text,
          bytes        bigint,
          -- A short reason on failure (a pg_dump or file-system message: paths, never data), or a note on success.
          detail       text CHECK (length(detail) <= 400)
        );
        CREATE INDEX backup_runs_outcome_time ON backup_runs (outcome, started_at);
      `);
    },
  },
  {
    // The discovery pass (server/discovery/): what Blizzard's undocumented WoW Forever API really returns, recorded as
    // evidence before any Blizzard-shaped table is designed. These tables are discovery-shaped on purpose (a raw
    // response log, a catalog per run, the admin's decisions): they are NOT the production character tables.
    id: '004_discovery',
    async up(q) {
      await q.query(`
        -- One row per discovery run. The admin page queues it; the worker claims and runs it (worker/jobs.js).
        -- options: what was asked (primary character, account / guild seeding, caps). progress: live counters, and
        -- heartbeat_at so a run whose worker died is shown as interrupted, never as running. summary: the analysis.
        CREATE TABLE discovery_runs (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          status        text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'interrupted')),
          requested_at  timestamptz NOT NULL DEFAULT now(),
          started_at    timestamptz,
          finished_at   timestamptz,
          heartbeat_at  timestamptz,
          options       jsonb NOT NULL DEFAULT '{}',
          progress      jsonb NOT NULL DEFAULT '{}',
          summary       jsonb,
          -- A short reason written by this app (never a response body or a token).
          problem       text CHECK (length(problem) <= 400)
        );
        CREATE INDEX discovery_runs_status_time ON discovery_runs (status, requested_at);

        -- Every request a run made, as Blizzard answered it: the raw body exactly as received (evidence, kept
        -- forever), status, latency and response headers (minus set-cookie). Request headers are never stored: they
        -- carry the tokens. 404s and network failures are rows too: a gap is recorded, never filled.
        CREATE TABLE discovery_responses (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          run_id        bigint NOT NULL REFERENCES discovery_runs (id),
          endpoint      text NOT NULL,                       -- discovery/endpoints.js id
          subject_kind  text NOT NULL CHECK (subject_kind IN ('data', 'account', 'character', 'guild', 'probe')),
          subject       text NOT NULL DEFAULT '',            -- the character or guild path, or ''
          path          text NOT NULL,
          namespace     text,
          auth          text NOT NULL CHECK (auth IN ('app', 'user')),
          status        integer,                             -- null: no answer at all (see error)
          latency_ms    integer,
          attempts      smallint NOT NULL DEFAULT 1,
          headers       jsonb NOT NULL DEFAULT '{}',
          content_type  text,
          bytes         integer,
          body          text,
          truncated     boolean NOT NULL DEFAULT false,
          error         text CHECK (length(error) <= 200),
          fetched_at    timestamptz NOT NULL
        );
        CREATE INDEX discovery_responses_run_time ON discovery_responses (run_id, fetched_at);
        CREATE INDEX discovery_responses_run_endpoint ON discovery_responses (run_id, endpoint, id);

        -- The statistics catalog of one run: every distinct statistic seen in the catalog endpoints' responses.
        CREATE TABLE discovery_statistics (
          run_id               bigint NOT NULL REFERENCES discovery_runs (id),
          statistic_id         bigint NOT NULL,              -- Blizzard's id, as returned
          name                 text NOT NULL,
          endpoint             text NOT NULL,
          category_path        jsonb NOT NULL DEFAULT '[]',  -- [{ id, name }], Blizzard's own grouping, outermost first
          value_type           text NOT NULL,
          value_type_basis     text NOT NULL,
          characters_sampled   integer NOT NULL,             -- characters whose catalog endpoint answered 200
          characters_present   integer NOT NULL,             -- … whose response listed this statistic
          characters_nonzero   integer NOT NULL,
          min_value            double precision,
          max_value            double precision,
          median_value         double precision,
          has_text             boolean NOT NULL DEFAULT false,
          suggestions          jsonb NOT NULL DEFAULT '[]',  -- discovery/suggest.js: [{ kind, value, reasoning, evidence }]
          PRIMARY KEY (run_id, statistic_id)
        );

        -- The admin's decisions on suggestions, append-only (the newest row per statistic and kind is the current
        -- one; 'cleared' takes a decision back). A rejected suggestion is not suggested again. Nothing here creates a
        -- leaderboard or a tier category: that is built later, from approved rows only.
        CREATE TABLE discovery_decisions (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          statistic_id  bigint NOT NULL,
          kind          text NOT NULL CHECK (kind IN ('category', 'bad', 'leaderboard')),
          value         jsonb NOT NULL,
          decision      text NOT NULL CHECK (decision IN ('approved', 'rejected', 'cleared')),
          reasoning     text NOT NULL DEFAULT '' CHECK (length(reasoning) <= 600),
          run_id        bigint REFERENCES discovery_runs (id),
          decided_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX discovery_decisions_statistic_time ON discovery_decisions (statistic_id, decided_at);

        -- The admin's Battle.net authorization for reading /profile/user/wow during discovery: the access token,
        -- sealed with the root key (slot "discovery.grant.<id>"). A credential, not history: one at a time, deleted
        -- when it expires (sweepExpired) or when the admin forgets it.
        CREATE TABLE discovery_grants (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          battletag   text NOT NULL DEFAULT '' CHECK (length(battletag) <= 100),
          ciphertext  bytea NOT NULL,
          iv          bytea NOT NULL,
          auth_tag    bytea NOT NULL,
          key_fp      text NOT NULL,
          scope       text NOT NULL DEFAULT '',
          created_at  timestamptz NOT NULL DEFAULT now(),
          expires_at  timestamptz NOT NULL
        );
        CREATE INDEX discovery_grants_expiry ON discovery_grants (expires_at);
      `);
    },
  },
  {
    // 0.3.1: the 'bad' suggestion became 'grading' (overall / category only / none). Earlier 'bad' decisions stay in
    // the append-only history; new decisions use 'grading'.
    id: '005_discovery_grading',
    async up(q) {
      await q.query(`
        ALTER TABLE discovery_decisions DROP CONSTRAINT discovery_decisions_kind_check;
        ALTER TABLE discovery_decisions ADD CONSTRAINT discovery_decisions_kind_check CHECK (kind IN ('category', 'bad', 'grading', 'leaderboard'));
      `);
    },
  },
  {
    // 0.3.2: possible duplicates are suggestions the admin approves ('duplicate'), value types can be corrected
    // ('value_type'), and one catalog combines every finished run. discovery_catalog and discovery_combined are
    // DERIVED (rebuilt from discovery_responses by run.js analyseCombined), like discovery_statistics.
    id: '006_discovery_combined',
    async up(q) {
      await q.query(`
        ALTER TABLE discovery_decisions DROP CONSTRAINT discovery_decisions_kind_check;
        ALTER TABLE discovery_decisions ADD CONSTRAINT discovery_decisions_kind_check
          CHECK (kind IN ('category', 'bad', 'grading', 'leaderboard', 'duplicate', 'value_type'));

        ALTER TABLE discovery_statistics
          ADD COLUMN value_type_guessed boolean NOT NULL DEFAULT true,
          ADD COLUMN named_example text,
          ADD COLUMN duplicate jsonb;

        -- Every statistic seen in any finished run, with the runs it came from. A character sampled in more than one
        -- run counts once, with its newest values.
        CREATE TABLE discovery_catalog (
          statistic_id         bigint PRIMARY KEY,
          name                 text NOT NULL,
          endpoint             text NOT NULL,
          category_path        jsonb NOT NULL DEFAULT '[]',
          value_type           text NOT NULL,
          value_type_basis     text NOT NULL,
          value_type_guessed   boolean NOT NULL DEFAULT true,
          characters_sampled   integer NOT NULL,
          characters_present   integer NOT NULL,
          characters_nonzero   integer NOT NULL,
          min_value            double precision,
          max_value            double precision,
          median_value         double precision,
          has_text             boolean NOT NULL DEFAULT false,
          named_example        text,
          duplicate            jsonb,
          runs                 bigint[] NOT NULL DEFAULT '{}'
        );

        -- One row: what the combined catalog was built from (runs, characters, rulesets, factions) and when.
        CREATE TABLE discovery_combined (
          id           smallint PRIMARY KEY CHECK (id = 1),
          summary      jsonb NOT NULL,
          analysed_at  timestamptz NOT NULL DEFAULT now()
        );
      `);
    },
  },
  {
    // 0.4.0, the playable beta: the production character tables, shaped by what discovery runs 1 and 2 stored
    // (discovery_responses). PARSED values only: no raw Blizzard body is kept in any of these tables.
    id: '007_characters',
    async up(q) {
      await q.query(`
        -- Rulesets, from the API (the ruleset index, and the ruleset each character profile names). Never typed in.
        CREATE TABLE rulesets (
          id             integer PRIMARY KEY,              -- Blizzard's id
          name           text NOT NULL,
          listed         boolean NOT NULL DEFAULT false,   -- in /data/wow/ruleset/index at the last read
          first_seen_at  timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now()
        );

        -- Guilds, as character profiles and rosters name them (guild pages are the next build; rosters seed characters).
        CREATE TABLE guilds (
          id                 bigint PRIMARY KEY,            -- Blizzard's id
          slug               text NOT NULL,
          name               text NOT NULL,
          faction            text,
          ruleset_id         integer REFERENCES rulesets (id),
          first_seen_at      timestamptz NOT NULL DEFAULT now(),
          updated_at         timestamptz NOT NULL DEFAULT now(),
          roster_checked_at  timestamptz,
          roster_members     integer
        );
        CREATE INDEX guilds_slug ON guilds (slug);
        CREATE INDEX guilds_roster_time ON guilds (id, roster_checked_at);

        -- Characters, keyed on Blizzard's character id. Blizzard's own slug, name and surname are stored as returned.
        --   profile_state 'not_found': known (from a Battle.net account list or a roster) but the profile answers 404:
        --                 under level 10, or not logged out since, or Blizzard hasn't caught up yet.
        --   login_at_full: last_login_timestamp at the last full fetch: the daily refresh skips the expensive calls
        --                 while the profile still says the same.
        CREATE TABLE characters (
          id                 bigint PRIMARY KEY,
          slug               text,                          -- NULL when another character has taken it since
          name               text NOT NULL,
          surname            text NOT NULL DEFAULT '',
          ruleset_id         integer REFERENCES rulesets (id),
          faction            text,
          race               text,
          class              text,
          gender             text,
          level              integer,
          guild_id           bigint REFERENCES guilds (id),
          last_login_at      timestamptz,
          login_at_full      timestamptz,
          profile_state      text NOT NULL CHECK (profile_state IN ('ok', 'not_found')),
          media              jsonb,                         -- { "main-raw": url, "avatar": url, … } from character-media
          media_state        text CHECK (media_state IN ('ok', 'not_ready', 'failed')),
          media_fetched_at   timestamptz,
          equipment          jsonb,                         -- [{ slot, slotName, name, quality, level }]
          attributes         jsonb,                         -- [{ key, label, value }] from /statistics
          first_fetched_at   timestamptz,
          last_fetched_at    timestamptz,                   -- last full fetch (statistics, gear, media)
          last_checked_at    timestamptz,                   -- last time the profile was read, changed or not
          stats_fetched_at   timestamptz,
          source             text NOT NULL CHECK (source IN ('lookup', 'account', 'guild')),
          tracked_since      timestamptz NOT NULL DEFAULT now(),
          owner_account_id   bigint REFERENCES accounts (id) ON DELETE SET NULL,
          owned_since        timestamptz,
          account_level      integer,                       -- the level the owner's Battle.net account list gave
          hidden             boolean NOT NULL DEFAULT false
        );
        CREATE UNIQUE INDEX characters_slug ON characters (slug) WHERE slug IS NOT NULL;
        CREATE INDEX characters_owner ON characters (owner_account_id, id) WHERE owner_account_id IS NOT NULL;
        CREATE INDEX characters_checked ON characters (last_checked_at NULLS FIRST, id);
        CREATE INDEX characters_ranked ON characters (ruleset_id, id) WHERE stats_fetched_at IS NOT NULL AND NOT hidden;
        CREATE INDEX characters_guild ON characters (guild_id, id);

        -- The production statistics catalog: every statistic id seen in any production crawl, growing by itself (a new
        -- statistic in a patch is a row, not a deploy). Category, grading and value type come from the discovery
        -- decisions, else the suggestions (stats/catalog.js).
        CREATE TABLE statistics (
          id             bigint PRIMARY KEY,                -- Blizzard's id
          name           text NOT NULL,
          category_path  jsonb NOT NULL DEFAULT '[]',
          has_text       boolean NOT NULL DEFAULT false,
          named_example  text,
          first_seen_at  timestamptz NOT NULL DEFAULT now(),
          last_seen_at   timestamptz NOT NULL DEFAULT now()
        );

        -- Each character's current value of each statistic it has (a statistic Blizzard doesn't list is zero, and has
        -- no row). ruleset_id and hidden are copied from the character so a board is one index range.
        CREATE TABLE character_statistics (
          character_id        bigint NOT NULL REFERENCES characters (id),
          statistic_id        bigint NOT NULL REFERENCES statistics (id),
          ruleset_id          integer NOT NULL,
          hidden              boolean NOT NULL DEFAULT false,
          value               double precision NOT NULL,
          text                text,                         -- name + number statistics: the name beside the number
          blizzard_updated_at timestamptz,
          fetched_at          timestamptz NOT NULL,
          PRIMARY KEY (character_id, statistic_id)
        );
        CREATE INDEX character_statistics_board ON character_statistics (statistic_id, ruleset_id, value DESC, character_id) WHERE NOT hidden AND value > 0;

        -- Weekly / monthly gains: a character's first snapshot in each period (period_baselines) and what it has gained
        -- since, per statistic, only where the gain is above zero (stat_gains). Rebuilt for a character whenever it is
        -- fetched; past periods are kept.
        CREATE TABLE period_baselines (
          period        text NOT NULL CHECK (period IN ('week', 'month')),
          period_start  timestamptz NOT NULL,
          character_id  bigint NOT NULL REFERENCES characters (id),
          ruleset_id    integer NOT NULL,
          hidden        boolean NOT NULL DEFAULT false,
          taken_at      timestamptz NOT NULL,
          stat_ids      integer[] NOT NULL,
          stat_values   double precision[] NOT NULL,
          PRIMARY KEY (period, period_start, character_id)
        );
        CREATE INDEX period_baselines_population ON period_baselines (period, period_start, ruleset_id) WHERE NOT hidden;
        CREATE INDEX period_baselines_character_time ON period_baselines (character_id, period_start);
        CREATE TABLE stat_gains (
          period        text NOT NULL,
          period_start  timestamptz NOT NULL,
          statistic_id  bigint NOT NULL,
          ruleset_id    integer NOT NULL,
          character_id  bigint NOT NULL REFERENCES characters (id),
          hidden        boolean NOT NULL DEFAULT false,
          gain          double precision NOT NULL,
          PRIMARY KEY (period, period_start, statistic_id, character_id)
        );
        CREATE INDEX stat_gains_board ON stat_gains (period, period_start, statistic_id, ruleset_id, gain DESC, character_id) WHERE NOT hidden AND gain > 0;
        CREATE INDEX stat_gains_character_time ON stat_gains (character_id, period_start);

        -- The crawler's work queue. One pending item per (kind, key); a more urgent request raises its priority.
        --   priority 1 a person waiting (lookup, sign-in) · 2 auto-fetch after sign-in · 3 daily refresh · 4 roster
        -- Finished items are deleted after an hour (CLAUDE.md names this exception): they are work orders; what they
        -- fetched lives in the character tables and the request counts in crawler_hours.
        CREATE TABLE crawl_queue (
          id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          kind         text NOT NULL CHECK (kind IN ('character', 'guild')),
          key          text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
          mode         text NOT NULL DEFAULT 'full' CHECK (mode IN ('full', 'check')),
          priority     smallint NOT NULL CHECK (priority BETWEEN 1 AND 4),
          account_id   bigint REFERENCES accounts (id) ON DELETE SET NULL,
          state        text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
          outcome      text CHECK (length(outcome) <= 200),
          attempts     smallint NOT NULL DEFAULT 0,
          enqueued_at  timestamptz NOT NULL DEFAULT now(),
          not_before   timestamptz NOT NULL DEFAULT now(),
          started_at   timestamptz,
          finished_at  timestamptz
        );
        CREATE UNIQUE INDEX crawl_queue_pending ON crawl_queue (kind, key) WHERE state IN ('queued', 'running');
        CREATE INDEX crawl_queue_next ON crawl_queue (priority, not_before, id) WHERE state = 'queued';
        CREATE INDEX crawl_queue_finished ON crawl_queue (finished_at) WHERE state IN ('done', 'failed');

        -- Blizzard requests per hour (kept forever, tiny), and the crawler's live status (one row, the worker's).
        CREATE TABLE crawler_hours (
          hour       timestamptz PRIMARY KEY,
          requests   integer NOT NULL DEFAULT 0,
          errors     integer NOT NULL DEFAULT 0,
          throttled  integer NOT NULL DEFAULT 0
        );
        CREATE TABLE crawler_status (
          id          smallint PRIMARY KEY CHECK (id = 1),
          updated_at  timestamptz NOT NULL DEFAULT now(),
          detail      jsonb NOT NULL DEFAULT '{}'
        );
        -- Moments the pipeline needs to remember, written once: 'first_snapshot_at' decides when the weekly and
        -- monthly boards open (stats/periods.js periodOpen).
        CREATE TABLE pipeline_facts (
          key         text PRIMARY KEY,
          at          timestamptz NOT NULL
        );

        -- Each time a sign-in read a Battle.net account's character list: what it found, or that it couldn't check.
        CREATE TABLE account_character_checks (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          provider    text NOT NULL,
          checked_at  timestamptz NOT NULL DEFAULT now(),
          outcome     text NOT NULL CHECK (outcome IN ('ok', 'none', 'error')),
          characters  integer,
          detail      text CHECK (length(detail) <= 200)
        );
        CREATE INDEX account_character_checks_account_time ON account_character_checks (account_id, checked_at);

        -- The signed-in dashboard: which character is featured, and the statistics pinned to it.
        ALTER TABLE accounts
          ADD COLUMN featured_character_id bigint REFERENCES characters (id) ON DELETE SET NULL,
          ADD COLUMN pins_customised boolean NOT NULL DEFAULT false;
        CREATE TABLE account_pins (
          account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          statistic_id  bigint NOT NULL,
          position      smallint NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, statistic_id)
        );
        -- A pinned statistic's rank for each owned character, once a day: "rank movement since last week". Kept forever.
        CREATE TABLE pin_rank_history (
          character_id  bigint NOT NULL REFERENCES characters (id),
          statistic_id  bigint NOT NULL,
          day           date NOT NULL,
          rank          integer NOT NULL,
          population    integer NOT NULL,
          recorded_at   timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (character_id, statistic_id, day)
        );
        CREATE INDEX pin_rank_history_character_time ON pin_rank_history (character_id, day);
      `);
    },
  },
  {
    // Daily snapshots of each character's parsed statistic values, at most one per character per UTC day, kept
    // forever, in the "snapshots" tablespace on the array disk. Two parallel arrays (ids, values) instead of a row per
    // statistic: about a tenth of the size, and a day's snapshot is read whole anyway.
    id: '008_snapshots',
    async up(q) {
      await q.query(`
        CREATE TABLE character_snapshots (
          character_id  bigint NOT NULL REFERENCES characters (id),
          day           date NOT NULL,
          taken_at      timestamptz NOT NULL,
          level         smallint,
          stat_ids      integer[] NOT NULL,
          stat_values   double precision[] NOT NULL,
          PRIMARY KEY (character_id, day)
        ) ${await snapshotTablespace(q)};
      `);
    },
  },
  {
    // The beta window and beta membership. Membership is decided ONLY by the window: the account row's insert trigger
    // sets it from the window open at that moment, and an update trigger refuses any later change except a merge
    // carrying an earlier membership over (CLAUDE.md "Beta"). Nothing can back-fill, edit or lose it.
    id: '009_beta',
    async up(q) {
      await q.query(`
        CREATE TABLE beta_windows (
          id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          opened_at  timestamptz NOT NULL DEFAULT now(),
          closed_at  timestamptz,
          CHECK (closed_at IS NULL OR closed_at >= opened_at)
        );
        CREATE UNIQUE INDEX beta_windows_one_open ON beta_windows ((true)) WHERE closed_at IS NULL;
        -- Open from this release (0.4.0).
        INSERT INTO beta_windows DEFAULT VALUES;

        -- Accounts that already exist were created before any beta window: they are not beta members (never back-filled).
        ALTER TABLE accounts
          ADD COLUMN beta_member boolean NOT NULL DEFAULT false,
          ADD COLUMN beta_since timestamptz;

        CREATE FUNCTION accounts_beta_on_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF EXISTS (SELECT 1 FROM beta_windows WHERE opened_at <= NEW.created_at AND (closed_at IS NULL OR closed_at > NEW.created_at)) THEN
            NEW.beta_member := true;
            NEW.beta_since := NEW.created_at;
          ELSE
            NEW.beta_member := false;
            NEW.beta_since := NULL;
          END IF;
          RETURN NEW;
        END
        $fn$;
        CREATE TRIGGER accounts_beta_on_insert BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_beta_on_insert();

        CREATE FUNCTION accounts_beta_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.beta_member IS DISTINCT FROM OLD.beta_member OR NEW.beta_since IS DISTINCT FROM OLD.beta_since THEN
            -- The only change ever allowed: a merge (account/merge.js sets everstats.merging for its transaction)
            -- giving the kept account an EARLIER real membership from the merged one.
            IF current_setting('everstats.merging', true) = 'on' AND NEW.beta_member AND NEW.beta_since IS NOT NULL
               AND (NOT OLD.beta_member OR NEW.beta_since < OLD.beta_since) THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'beta membership is permanent' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END
        $fn$;
        CREATE TRIGGER accounts_beta_guard BEFORE UPDATE OF beta_member, beta_since ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_beta_guard();
      `);
    },
  },
  {
    // 0.4.1: usernames, display names, renames and the reserved list (accounts/names.js, accounts/usernames.js).
    id: '010_usernames',
    async up(q) {
      await q.query(`
        -- A placeholder for every account until it claims a name: "user-" + 6 random a–z0–9, never reused.
        CREATE FUNCTION everstats_placeholder_username() RETURNS text LANGUAGE plpgsql VOLATILE AS $fn$
        DECLARE
          alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
          candidate text;
        BEGIN
          LOOP
            candidate := 'user-';
            FOR i IN 1..6 LOOP
              candidate := candidate || substr(alphabet, 1 + floor(random() * 36)::int, 1);
            END LOOP;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE username = candidate);
          END LOOP;
          RETURN candidate;
        END
        $fn$;

        ALTER TABLE accounts
          ADD COLUMN username text,
          ADD COLUMN username_claimed boolean NOT NULL DEFAULT false,
          ADD COLUMN display_name text CHECK (char_length(display_name) BETWEEN 1 AND 32),
          -- Renames left. Claiming the first name is free; a reclaim by the admin doesn't use one either. A number, not
          -- a rule: a later patron system or badge may grant more (the admin can set it).
          ADD COLUMN rename_allowance integer NOT NULL DEFAULT 1 CHECK (rename_allowance >= 0);
        UPDATE accounts SET username = everstats_placeholder_username() WHERE username IS NULL;
        ALTER TABLE accounts
          ALTER COLUMN username SET NOT NULL,
          ALTER COLUMN username SET DEFAULT everstats_placeholder_username(),
          ADD CONSTRAINT accounts_username_shape CHECK (username ~ '^[a-z][a-z0-9_-]{2,19}$');
        CREATE UNIQUE INDEX accounts_username ON accounts (username);

        -- "Dismiss" on the claim-your-username prompt lasts for this sign-in (this session) only.
        ALTER TABLE sessions ADD COLUMN username_prompt_dismissed boolean NOT NULL DEFAULT false;

        -- A name given up by a rename (or a merge) is held for 30 days: nobody else can claim it, and /u/{old}
        -- redirects to the account's current name. A name taken back by the admin is held until the admin releases it
        -- (held_until NULL) and redirects nowhere. Expired holds simply stop counting; rows stay as history.
        CREATE TABLE username_holds (
          name        text PRIMARY KEY,
          account_id  bigint REFERENCES accounts (id) ON DELETE SET NULL,
          reason      text NOT NULL CHECK (reason IN ('renamed', 'merged', 'reclaimed')),
          held_at     timestamptz NOT NULL DEFAULT now(),
          held_until  timestamptz
        );
        CREATE INDEX username_holds_account ON username_holds (account_id, held_at);

        -- Every claim, rename, admin grant and reclaim, kept with the account (the admin reads it).
        CREATE TABLE username_history (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          old_name    text NOT NULL,
          new_name    text NOT NULL,
          kind        text NOT NULL CHECK (kind IN ('claim', 'rename', 'grant', 'reclaim', 'merge')),
          by_admin    boolean NOT NULL DEFAULT false,
          note        text CHECK (length(note) <= 200),
          at          timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX username_history_account_time ON username_history (account_id, at);

        -- Names nobody may claim (admin-editable). Compared after lookalike normalization (accounts/names.js). kind
        -- 'path' entries guard URLs only; display names are checked against the other kinds.
        CREATE TABLE reserved_names (
          name      text PRIMARY KEY CHECK (name ~ '^[a-z0-9_-]{1,40}$'),
          kind      text NOT NULL CHECK (kind IN ('everstats', 'path', 'company', 'community', 'admin')),
          added_at  timestamptz NOT NULL DEFAULT now()
        );
      `);
      const { RESERVED_SEED } = await import('../accounts/names.js');
      const kinds = { everstats: 'everstats', paths: 'path', companies: 'company', community: 'community' };
      for (const [group, names] of Object.entries(RESERVED_SEED)) {
        for (const name of names) await q.query('INSERT INTO reserved_names (name, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [name, kinds[group]]);
      }
    },
  },
  {
    // 0.4.1: item icons from Blizzard's item media endpoint, shared by every character. Blizzard's API terms require
    // a 30-day maximum TTL on all API data, so each row is refreshed when older than 30 days (crawler/items.js); the
    // image itself is shown from Blizzard's render host, never stored. equipment_version: what the stored equipment
    // carries (2 = tooltip fields); an older one is re-fetched once even when the character hasn't logged in.
    id: '011_item_media',
    async up(q) {
      await q.query(`
        CREATE TABLE item_media (
          item_id     bigint PRIMARY KEY,
          state       text NOT NULL CHECK (state IN ('ok', 'missing', 'failed')),
          icon_url    text CHECK (icon_url IS NULL OR icon_url LIKE 'https://render.worldofwarcraft.com/%'),
          fetched_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX item_media_fetched ON item_media (fetched_at);
        ALTER TABLE characters ADD COLUMN equipment_version smallint NOT NULL DEFAULT 1;
        ALTER TABLE crawl_queue DROP CONSTRAINT crawl_queue_kind_check;
        ALTER TABLE crawl_queue ADD CONSTRAINT crawl_queue_kind_check CHECK (kind IN ('character', 'guild', 'items'));
      `);
    },
  },
  {
    // 0.4.2: Blizzard's 30-day rule (Developer API Terms of Use, section 2: "a maximum 30-day TTL ... for all Data").
    // Every Blizzard-sourced row now has a "last fetched from Blizzard" time the retention sweep reads
    // (server/retention/registry.js); "Monthly" boards become a rolling window; public profile fields.
    id: '012_retention_profiles',
    async up(q) {
      await q.query(`
        -- Characters: when Blizzard last returned this character (a 200 profile, or a listing on its owner's account),
        -- when it stopped returning it, and when its Blizzard data was purged (the row stays as a stub holding only
        -- Everstats' own data: id, owner, hidden flag, tracked since).
        ALTER TABLE characters
          ALTER COLUMN name DROP NOT NULL,
          ADD COLUMN data_fetched_at timestamptz,
          ADD COLUMN missing_since timestamptz,
          ADD COLUMN purged_at timestamptz;
        UPDATE characters SET data_fetched_at = coalesce(last_fetched_at, owned_since, tracked_since);
        ALTER TABLE characters DROP CONSTRAINT characters_profile_state_check;
        ALTER TABLE characters ADD CONSTRAINT characters_profile_state_check CHECK (profile_state IN ('ok', 'not_found', 'purged'));
        CREATE INDEX characters_data_fetched ON characters (data_fetched_at) WHERE profile_state <> 'purged';

        -- A statistic's name ages out like any Blizzard data; its id (ours to keep) and the owner's decisions stay.
        ALTER TABLE statistics ALTER COLUMN name DROP NOT NULL;

        -- Indexes the sweep deletes by.
        CREATE INDEX character_statistics_fetched ON character_statistics (fetched_at);
        CREATE INDEX character_snapshots_taken ON character_snapshots (taken_at);
        CREATE INDEX pin_rank_history_day ON pin_rank_history (day);
        CREATE INDEX discovery_runs_requested ON discovery_runs (requested_at);

        -- "Monthly" becomes "rolling": the gain since the character's oldest snapshot still inside the retention window.
        DELETE FROM stat_gains WHERE period = 'month';
        DELETE FROM period_baselines WHERE period = 'month';
        ALTER TABLE period_baselines DROP CONSTRAINT period_baselines_period_check;
        ALTER TABLE period_baselines ADD CONSTRAINT period_baselines_period_check CHECK (period IN ('week', 'rolling'));

        -- Each retention sweep: what it deleted per category and the oldest Blizzard data left. Counts and times only
        -- (no Blizzard values), so kept.
        CREATE TABLE retention_sweeps (
          id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          started_at   timestamptz NOT NULL DEFAULT now(),
          finished_at  timestamptz,
          process      text NOT NULL,
          window_days  integer NOT NULL,
          cutoff       timestamptz NOT NULL,
          deleted      jsonb NOT NULL DEFAULT '{}',
          oldest       jsonb NOT NULL DEFAULT '{}',
          problem      text CHECK (length(problem) <= 300)
        );
        CREATE INDEX retention_sweeps_time ON retention_sweeps (started_at);

        -- Public profile fields the player writes (Everstats' own data, not Blizzard's).
        ALTER TABLE accounts
          ADD COLUMN profile_bio text CHECK (char_length(profile_bio) <= 280),
          ADD COLUMN profile_show_pins boolean NOT NULL DEFAULT true;
        -- Social links: a platform id from server/accounts/socials.json and a HANDLE (never a URL: the link is built).
        CREATE TABLE account_social_links (
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          platform    text NOT NULL CHECK (platform ~ '^[a-z][a-z0-9_]{1,30}$'),
          handle      text NOT NULL CHECK (char_length(handle) BETWEEN 1 AND 253),
          set_at      timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, platform)
        );
      `);
    },
  },
  {
    // 0.5.0: guild pages and guild boards. Shapes from what discovery runs 1–2 stored (2026-11-09):
    //   /data/wow/guild/{slug} (profile namespace): { id, name, slug, faction{type,name}, ruleset{id,name},
    //     member_count, created_timestamp, achievement_points (0 in both samples), name_search, roster/activity/
    //     achievements links }. No realm: the slug alone addresses a guild, region-wide.
    //   …/roster: { guild{…}, members[]: { character{ id, name, surname, slug, level, playable_class{id},
    //     playable_race{id}, faction{type} }, rank } }. rank is a NUMBER (0–3 seen); Forever sends no rank names.
    //   …/activity and …/achievements answered 200 with nothing in them: not fetched.
    // Every table here holds Blizzard data or is derived from it, so each is in retention/registry.js.
    id: '013_guilds',
    async up(q) {
      await q.query(`
        ALTER TABLE guilds
          ADD COLUMN profile_state       text CHECK (profile_state IN ('ok', 'not_found')),
          ADD COLUMN profile_fetched_at  timestamptz,       -- last 200 from the guild profile
          ADD COLUMN member_count        integer,           -- the profile's member_count
          ADD COLUMN created_at_blizzard timestamptz,       -- the profile's created_timestamp
          -- Guild totals (guild_totals) are rebuilt by the worker when a member changed after the last build, when
          -- the week rolls over, and at least every few hours (stats/guildTotals.js).
          ADD COLUMN totals_dirty_at     timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN totals_built_at     timestamptz,
          ADD COLUMN totals_week_start   timestamptz;
        CREATE INDEX guilds_name_lower ON guilds (lower(name) text_pattern_ops);
        CREATE INDEX guilds_totals_due ON guilds (totals_built_at NULLS FIRST, id);
        CREATE INDEX guilds_ruleset ON guilds (ruleset_id, id);

        -- The latest roster, one row per member Blizzard lists. No names: an untracked member is only counted, never
        -- listed (a tracked one's name lives in characters). Replaced whole on each roster fetch.
        CREATE TABLE guild_roster (
          guild_id      bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
          character_id  bigint NOT NULL,                    -- Blizzard's id (no FK: most members aren't tracked)
          rank          smallint,                           -- Blizzard's rank number; 0 is the guild master
          level         smallint,
          fetched_at    timestamptz NOT NULL,
          PRIMARY KEY (guild_id, character_id)
        );
        CREATE INDEX guild_roster_guild_time ON guild_roster (guild_id, fetched_at);
        CREATE INDEX guild_roster_fetched ON guild_roster (fetched_at);
        CREATE INDEX guild_roster_character ON guild_roster (character_id, fetched_at);

        -- Every slug a guild has been seen with, so an old address redirects to the guild by id after a rename.
        CREATE TABLE guild_slugs (
          slug      text NOT NULL,
          guild_id  bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
          seen_at   timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (slug, guild_id)
        );
        CREATE INDEX guild_slugs_guild_time ON guild_slugs (guild_id, seen_at);
        CREATE INDEX guild_slugs_seen ON guild_slugs (seen_at);
        INSERT INTO guild_slugs (slug, guild_id, seen_at) SELECT slug, id, updated_at FROM guilds;

        -- Guild boards: per guild, per statistic, per period, the TOTAL of its current tracked members' values (or
        -- gains) and the average per member. Only totals above zero have a row (zero is never ranked). Derived from
        -- character_statistics / stat_gains, never from an extra Blizzard request.
        CREATE TABLE guild_totals (
          period        text NOT NULL CHECK (period IN ('overall', 'week', 'rolling')),
          period_start  timestamptz NOT NULL,               -- the week's start; epoch for overall and rolling
          statistic_id  bigint NOT NULL,
          ruleset_id    integer NOT NULL,
          guild_id      bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
          members       integer NOT NULL,                   -- the members counted (see guild_populations)
          total         double precision NOT NULL,
          average       double precision NOT NULL,
          computed_at   timestamptz NOT NULL,
          PRIMARY KEY (period, period_start, statistic_id, guild_id)
        );
        CREATE INDEX guild_totals_total ON guild_totals (period, period_start, statistic_id, ruleset_id, total DESC, guild_id) WHERE total > 0;
        CREATE INDEX guild_totals_average ON guild_totals (period, period_start, statistic_id, ruleset_id, average DESC, guild_id) WHERE total > 0;
        CREATE INDEX guild_totals_guild_time ON guild_totals (guild_id, computed_at);
        CREATE INDEX guild_totals_computed ON guild_totals (computed_at);

        -- Each guild's counted members per period: tracked members (overall), or tracked members with a baseline in
        -- the period (week, rolling). A guild is ranked once this reaches the guilds.minMembers setting.
        CREATE TABLE guild_populations (
          period        text NOT NULL CHECK (period IN ('overall', 'week', 'rolling')),
          period_start  timestamptz NOT NULL,
          guild_id      bigint NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
          ruleset_id    integer NOT NULL,
          members       integer NOT NULL,
          computed_at   timestamptz NOT NULL,
          PRIMARY KEY (period, period_start, guild_id)
        );
        CREATE INDEX guild_populations_ruleset ON guild_populations (period, period_start, ruleset_id, members DESC, guild_id);
        CREATE INDEX guild_populations_guild_time ON guild_populations (guild_id, computed_at);
        CREATE INDEX guild_populations_computed ON guild_populations (computed_at);
      `);
    },
  },
  {
    // 0.6.0: letter tiers (server/tiers/). Scores and letters are DERIVED from Blizzard values (character_statistics),
    // so every table here except tier_runs is Blizzard data in retention/registry.js, swept by computed_at.
    //   tier_rulesets            per ruleset, the last FULL grading: population, the settings and the plan it used
    //                            (counted statistic ids per category, from the owner's decisions then), and per scope
    //                            the lowest score that earned each letter (a character graded on its own between full
    //                            gradings is placed against these)
    //   character_tiers          per character: overall score, letter (null = Unranked, with the reason), how many
    //                            overall categories it has a letter in, and its percentile in every counted statistic
    //   character_category_tiers per character and category: score, the overall-counting part, letter, and how many
    //                            counted statistics it has above zero against how many it needs
    //   tier_runs                our log of full gradings and the requests for one (a decision or setting change
    //                            asks for one; a burst of them waits for a quiet moment and makes one). Times, reasons
    //                            and letter counts only.
    id: '014_tiers',
    async up(q) {
      await q.query(`
        CREATE TABLE tier_rulesets (
          ruleset_id   integer PRIMARY KEY,
          population   integer NOT NULL,
          graded       boolean NOT NULL,
          settings     jsonb NOT NULL,
          plan         jsonb NOT NULL,
          scopes       jsonb NOT NULL DEFAULT '{}',
          computed_at  timestamptz NOT NULL
        );
        CREATE INDEX tier_rulesets_computed ON tier_rulesets (computed_at);

        CREATE TABLE character_tiers (
          character_id  bigint PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
          ruleset_id    integer NOT NULL,
          score         double precision,
          letter        text CHECK (letter IN ('S', 'A', 'B', 'C', 'D')),
          reason        text CHECK (reason IN ('few_categories', 'no_categories')),
          lettered      smallint NOT NULL,
          needed        smallint NOT NULL,
          total         smallint NOT NULL,
          stat_ids      bigint[] NOT NULL,
          stat_pcts     real[] NOT NULL,
          graded_by     text NOT NULL CHECK (graded_by IN ('full', 'character')),
          computed_at   timestamptz NOT NULL,
          CHECK ((letter IS NULL) = (reason IS NOT NULL))
        );
        CREATE INDEX character_tiers_board ON character_tiers (ruleset_id, score DESC, character_id) WHERE letter IS NOT NULL;
        CREATE INDEX character_tiers_ruleset ON character_tiers (ruleset_id, character_id);
        CREATE INDEX character_tiers_computed ON character_tiers (computed_at);

        CREATE TABLE character_category_tiers (
          character_id  bigint NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
          category_key  text NOT NULL CHECK (length(category_key) <= 80),
          ruleset_id    integer NOT NULL,
          score         double precision NOT NULL,
          overall_part  double precision,
          letter        text CHECK (letter IN ('S', 'A', 'B', 'C', 'D')),
          nonzero       smallint NOT NULL,
          needed        smallint NOT NULL,
          counted       smallint NOT NULL,
          computed_at   timestamptz NOT NULL,
          PRIMARY KEY (character_id, category_key)
        );
        CREATE INDEX character_category_tiers_board ON character_category_tiers (ruleset_id, category_key, score DESC, character_id) WHERE letter IS NOT NULL;
        CREATE INDEX character_category_tiers_ruleset ON character_category_tiers (ruleset_id, category_key, character_id);
        CREATE INDEX character_category_tiers_computed ON character_category_tiers (computed_at);

        CREATE TABLE tier_runs (
          id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          status        text NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
          reasons       text[] NOT NULL DEFAULT '{}',
          requested_at  timestamptz NOT NULL DEFAULT now(),
          started_at    timestamptz,
          finished_at   timestamptz,
          ms            integer,
          summary       jsonb,
          problem       text CHECK (length(problem) <= 300)
        );
        CREATE UNIQUE INDEX tier_runs_one_pending ON tier_runs (status) WHERE status = 'pending';
        CREATE INDEX tier_runs_time ON tier_runs (requested_at);
        CREATE INDEX tier_runs_finished ON tier_runs (status, finished_at);
      `);
    },
  },
  {
    // 0.7.0: badges (server/badges/) and guild page management (server/guilds/manage.js). Every table here is
    // Everstats' own data (retention/registry.js OURS). No Blizzard value is copied in: an award keeps at most the
    // Blizzard ID of the character that earned it (ids are ours to keep), never its name, level, class or faction.
    //   badge_definitions  what badges exist (seeded from design/v2-badges; admin adds more from templates). A partner's
    //                      mark is the admin's upload, re-encoded server-side (badges/marks.js); never SVG.
    //   badge_awards       an account's badge: when, how (automatic rule or admin grant with a reason), and the
    //                      player's display choices (public, featured + order, pinned). Revoking is a STATE, never a delete.
    //   badge_events       append-only log of every grant, earn, revoke, removal, mark change and definition created.
    //   guild_pages        a guild's Everstats page fields (description, Discord invite) and the Guild Master we last
    //                      recorded (who controls it is computed live from the roster; this records handovers).
    //   guild_editors      officers a Guild Master added (removal is a state, kept as history).
    //   guild_links        up to 5 labelled https links per guild (removal is a state, kept as history).
    //   guild_link_reports "Report this link" queue for the admin.
    //   link_blocklist     hosts the admin refuses in guild links.
    //   guild_events       append-only log of every change of control and every edit.
    // guild ids are Blizzard's ids, deliberately WITHOUT a foreign key: a guilds row ages out with Blizzard's 30-day
    // rule, and our own data about the guild must not be cascaded away with it.
    id: '015_badges_guild_pages',
    async up(q) {
      await q.query(`
        CREATE TABLE badge_definitions (
          id               text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,47}$'),
          family           text NOT NULL CHECK (family IN ('staff', 'partner', 'membership', 'faction', 'class', 'achievement')),
          name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
          description      text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
          how              text NOT NULL CHECK (char_length(how) BETWEEN 1 AND 200),
          art              text NOT NULL CHECK (art ~ '^[a-z]+/[a-z0-9-]+$'),
          template         text CHECK (template IN ('partner-pro', 'platform-employee', 'class', 'achievement')),
          monogram         text CHECK (monogram ~ '^[A-Z]$'),
          award            text NOT NULL CHECK (award IN ('manual', 'automatic')),
          rule             jsonb,
          kept_while_held  boolean NOT NULL DEFAULT false,
          time_limited     boolean NOT NULL DEFAULT false,
          verified         boolean NOT NULL DEFAULT false,
          -- Planned (after 1.0): automatic verification, e.g. { "method": "work_email", "domains": ["…"] }. NULL = granted by hand.
          verification     jsonb,
          sort             integer NOT NULL DEFAULT 1000,
          mark             bytea,
          mark_sha         text,
          mark_set_at      timestamptz,
          mark_pending     bytea,
          mark_pending_sha text,
          mark_pending_at  timestamptz,
          created_at       timestamptz NOT NULL DEFAULT now(),
          created_by       text NOT NULL DEFAULT 'seed' CHECK (created_by IN ('seed', 'admin')),
          CHECK ((award = 'automatic') = (rule IS NOT NULL))
        );

        CREATE TABLE badge_awards (
          account_id      bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          badge_id        text NOT NULL REFERENCES badge_definitions (id),
          state           text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'revoked')),
          earned_at       timestamptz NOT NULL DEFAULT now(),
          source          text NOT NULL CHECK (source IN ('automatic', 'admin')),
          reason          text CHECK (char_length(reason) <= 500),
          character_id    bigint,
          revoked_at      timestamptz,
          revoked_by      text CHECK (revoked_by IN ('admin', 'rule')),
          revoked_reason  text CHECK (char_length(revoked_reason) <= 500),
          shown           boolean NOT NULL DEFAULT true,
          featured        boolean NOT NULL DEFAULT false,
          position        smallint,
          pinned          boolean NOT NULL DEFAULT false,
          seen_at         timestamptz,
          toast           text CHECK (toast IN ('earned', 'granted', 'removed')),
          toast_at        timestamptz,
          PRIMARY KEY (account_id, badge_id),
          CHECK (NOT featured OR shown),
          CHECK (NOT pinned OR shown)
        );
        CREATE UNIQUE INDEX badge_awards_one_pin ON badge_awards (account_id) WHERE pinned;
        CREATE INDEX badge_awards_badge ON badge_awards (badge_id, state, earned_at);
        CREATE INDEX badge_awards_toast ON badge_awards (account_id, toast_at) WHERE toast IS NOT NULL;

        CREATE TABLE badge_events (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          at          timestamptz NOT NULL DEFAULT now(),
          type        text NOT NULL CHECK (type IN ('granted', 'earned', 'revoked', 'removed', 'restored', 'mark_uploaded', 'mark_saved', 'created', 'backfill')),
          badge_id    text,
          account_id  bigint,   -- no FK: the log outlives a deleted account (ids only)
          actor       text NOT NULL CHECK (actor IN ('admin', 'rule', 'backfill')),
          reason      text CHECK (char_length(reason) <= 500),
          detail      jsonb NOT NULL DEFAULT '{}'
        );
        CREATE INDEX badge_events_time ON badge_events (at);
        CREATE INDEX badge_events_account_time ON badge_events (account_id, at);

        CREATE TABLE guild_pages (
          guild_id         bigint PRIMARY KEY,
          gm_account_id    bigint REFERENCES accounts (id) ON DELETE SET NULL,
          gm_character_id  bigint,
          gm_since         timestamptz,
          description      text CHECK (char_length(description) <= 280),
          discord_invite   text CHECK (discord_invite ~ '^[A-Za-z0-9-]{2,32}$'),
          updated_at       timestamptz,
          updated_by       bigint
        );
        CREATE INDEX guild_pages_gm ON guild_pages (gm_account_id) WHERE gm_account_id IS NOT NULL;

        CREATE TABLE guild_editors (
          guild_id        bigint NOT NULL,
          account_id      bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          added_by        bigint,
          added_at        timestamptz NOT NULL DEFAULT now(),
          removed_at      timestamptz,
          removed_by      bigint,
          removed_reason  text CHECK (char_length(removed_reason) <= 200),
          PRIMARY KEY (guild_id, account_id)
        );
        CREATE INDEX guild_editors_account ON guild_editors (account_id, added_at);

        CREATE TABLE guild_links (
          id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          guild_id        bigint NOT NULL,
          position        smallint NOT NULL,
          label           text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
          url             text NOT NULL CHECK (char_length(url) <= 400 AND url LIKE 'https://%'),
          host            text NOT NULL,
          created_at      timestamptz NOT NULL DEFAULT now(),
          created_by      bigint,
          removed_at      timestamptz,
          removed_by      text CHECK (removed_by IN ('editor', 'admin')),
          removed_reason  text CHECK (char_length(removed_reason) <= 300)
        );
        CREATE INDEX guild_links_live ON guild_links (guild_id, position) WHERE removed_at IS NULL;
        CREATE INDEX guild_links_guild_time ON guild_links (guild_id, created_at);

        CREATE TABLE guild_link_reports (
          id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          link_id              bigint NOT NULL REFERENCES guild_links (id),
          guild_id             bigint NOT NULL,
          reported_at          timestamptz NOT NULL DEFAULT now(),
          reporter_account_id  bigint REFERENCES accounts (id) ON DELETE SET NULL,
          note                 text CHECK (char_length(note) <= 300),
          state                text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'dismissed', 'removed')),
          resolved_at          timestamptz
        );
        CREATE INDEX guild_link_reports_open ON guild_link_reports (state, reported_at);
        CREATE INDEX guild_link_reports_link_time ON guild_link_reports (link_id, reported_at);

        CREATE TABLE link_blocklist (
          host      text PRIMARY KEY CHECK (host ~ '^[a-z0-9.-]{3,253}$'),
          note      text CHECK (char_length(note) <= 200),
          added_at  timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE guild_events (
          id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          guild_id          bigint NOT NULL,
          at                timestamptz NOT NULL DEFAULT now(),
          type              text NOT NULL,
          account_id        bigint,
          actor_account_id  bigint,
          actor             text NOT NULL CHECK (actor IN ('player', 'admin', 'roster')),
          detail            jsonb NOT NULL DEFAULT '{}'
        );
        CREATE INDEX guild_events_guild_time ON guild_events (guild_id, at);
      `);
      const { SEED_BADGES } = await import('../badges/catalog.js');
      for (const b of SEED_BADGES) {
        await q.query(
          `INSERT INTO badge_definitions (id, family, name, description, how, art, template, monogram, award, rule, kept_while_held, time_limited, verified, sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14) ON CONFLICT (id) DO NOTHING`,
          [b.id, b.family, b.name, b.description, b.how, b.art, b.template ?? null, b.monogram ?? null, b.rule ? 'automatic' : 'manual',
            b.rule ? JSON.stringify(b.rule) : null, Boolean(b.keptWhileHeld), Boolean(b.timeLimited), ['staff', 'partner'].includes(b.family), b.sort],
        );
      }
      // The /beta page's perk said badges were coming ("will receive … when badges launch"). If the owner never edited
      // it, the stored value is the old default: say what is true now. An edited text is left alone.
      const OLD = 'Every account created while the beta is open will receive the Beta Tester badge when badges launch.';
      const { BETA_PERK_TEXT } = await import('../badges/catalog.js');
      const row = await q.one("SELECT value FROM settings WHERE key = 'beta.perks'");
      if (row && Array.isArray(row.value) && row.value.some((p) => p?.description === OLD)) {
        const next = row.value.map((p) => (p?.description === OLD ? { ...p, description: BETA_PERK_TEXT } : p));
        await q.query("UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'beta.perks'", [JSON.stringify(next)]);
      }
    },
  },
  {
    // 0.7.1: guild badges (server/guildBadges/), feedback with replies (server/feedback/), hiding a render
    // (character_render_hidden), the admin Activity counters (server/activity/), and the owner's one-off "Grant beta
    // membership" (the beta guard trigger gains ONE narrow path; see CLAUDE.md "The beta"). Everything here is
    // Everstats' own data (retention/registry.js OURS). Guild tables key on Blizzard's guild id WITHOUT a foreign key: a
    // guilds row ages out with the 30-day rule, our data about the guild stays.
    id: '016_guild_badges_feedback_activity',
    async up(q) {
      await q.query(`
        CREATE TABLE guild_badge_definitions (
          id               text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{1,47}$'),
          family           text NOT NULL CHECK (family IN ('roster', 'deeds', 'standing', 'heritage', 'recognition')),
          name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
          description      text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300),
          how              text NOT NULL CHECK (char_length(how) BETWEEN 1 AND 200),
          art              text NOT NULL CHECK (art ~ '^[a-z]+/[a-z0-9-]+$'),
          template         text CHECK (template IN ('deeds-template', 'partner-guild')),
          levelled         boolean NOT NULL DEFAULT false,
          measure          text CHECK (char_length(measure) <= 40),
          thresholds       bigint[],
          award            text NOT NULL CHECK (award IN ('manual', 'automatic')),
          rule             jsonb,
          kept_while_held  boolean NOT NULL DEFAULT false,
          time_limited     boolean NOT NULL DEFAULT false,
          status_mark      boolean NOT NULL DEFAULT false,
          sort             integer NOT NULL DEFAULT 1000,
          created_at       timestamptz NOT NULL DEFAULT now(),
          created_by       text NOT NULL DEFAULT 'seed' CHECK (created_by IN ('seed', 'admin')),
          CHECK ((award = 'automatic') = (rule IS NOT NULL)),
          CHECK (NOT levelled OR (cardinality(thresholds) = 5 AND measure IS NOT NULL))
        );

        -- One row per (guild, badge). Levels only ever go UP (raising a threshold never removes one); a Standing
        -- badge is 'lost' when the guild stops holding it and 'held' again when it regains it; 'revoked' is the admin
        -- taking back a staff badge. Never deleted.
        CREATE TABLE guild_badge_awards (
          guild_id         bigint NOT NULL,
          badge_id         text NOT NULL REFERENCES guild_badge_definitions (id),
          state            text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'lost', 'revoked')),
          level            smallint CHECK (level BETWEEN 1 AND 5),
          first_at         timestamptz NOT NULL DEFAULT now(),
          level_at         timestamptz NOT NULL DEFAULT now(),
          held_since       timestamptz NOT NULL DEFAULT now(),
          lost_at          timestamptz,
          source           text NOT NULL CHECK (source IN ('automatic', 'admin')),
          reason           text CHECK (char_length(reason) <= 500),
          detail           jsonb NOT NULL DEFAULT '{}',     -- Standing: the boards (statistic + ruleset ids, mode); Featured: label, until
          ribbon_at        timestamptz,                     -- the 7-day "Unlocked" ribbon; never set by the back-fill
          shown            boolean NOT NULL DEFAULT true,   -- the Guild Master's and officers' choices
          position         smallint,
          pinned           boolean NOT NULL DEFAULT false,
          PRIMARY KEY (guild_id, badge_id)
        );
        CREATE UNIQUE INDEX guild_badge_awards_one_pin ON guild_badge_awards (guild_id) WHERE pinned;
        CREATE INDEX guild_badge_awards_badge ON guild_badge_awards (badge_id, state, level);
        CREATE INDEX guild_badge_awards_guild_time ON guild_badge_awards (guild_id, level_at);

        CREATE TABLE guild_badge_events (
          id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          at                timestamptz NOT NULL DEFAULT now(),
          type              text NOT NULL CHECK (type IN ('unlocked', 'level', 'lost', 'regained', 'granted', 'revoked', 'display',
                                                          'thresholds', 'mark_uploaded', 'mark_saved', 'created', 'backfill')),
          guild_id          bigint,
          badge_id          text,
          level             smallint,
          actor             text NOT NULL CHECK (actor IN ('rule', 'admin', 'backfill', 'editor')),
          actor_account_id  bigint,
          notify            boolean NOT NULL DEFAULT false,   -- a toast for the guild's GM and officers
          reason            text CHECK (char_length(reason) <= 500),
          detail            jsonb NOT NULL DEFAULT '{}'
        );
        CREATE INDEX guild_badge_events_time ON guild_badge_events (at);
        CREATE INDEX guild_badge_events_guild_time ON guild_badge_events (guild_id, at);

        -- How far each GM / officer has seen the guild's toasts.
        CREATE TABLE guild_badge_toast_seen (
          guild_id    bigint NOT NULL,
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          seen_at     timestamptz NOT NULL,
          PRIMARY KEY (guild_id, account_id)
        );
        CREATE INDEX guild_badge_toast_seen_account ON guild_badge_toast_seen (account_id, seen_at);

        -- A partner guild's emblem: the admin's upload (PNG/WebP, re-encoded), with written permission confirmed.
        CREATE TABLE guild_partner_marks (
          guild_id     bigint PRIMARY KEY,
          mark         bytea,
          mark_sha     text,
          mark_set_at  timestamptz,
          pending      bytea,
          pending_sha  text,
          pending_at   timestamptz
        );

        -- "Hide my render": the owner's choice. Ours, so it survives a purge and is backed up.
        CREATE TABLE character_render_hidden (
          character_id  bigint PRIMARY KEY,
          account_id    bigint REFERENCES accounts (id) ON DELETE SET NULL,
          hidden_at     timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX character_render_hidden_account ON character_render_hidden (account_id, hidden_at);

        -- Feedback: one thread per message, replies in it. Plain text only. Kept until the admin deletes it or the
        -- account is deleted (cascade). A signed-out message has no account, only the Discord name they gave, if any.
        CREATE TABLE feedback_threads (
          id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id      bigint REFERENCES accounts (id) ON DELETE CASCADE,
          type            text NOT NULL CHECK (type IN ('bug', 'idea', 'question', 'partnership', 'other')),
          page            text CHECK (char_length(page) <= 300),
          discord         text CHECK (char_length(discord) <= 40),
          state           text NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'read', 'replied', 'archived')),
          player_unread   boolean NOT NULL DEFAULT false,   -- Everstats replied and the player hasn't opened it yet
          created_at      timestamptz NOT NULL DEFAULT now(),
          updated_at      timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX feedback_threads_state_time ON feedback_threads (state, updated_at);
        CREATE INDEX feedback_threads_account_time ON feedback_threads (account_id, updated_at);

        CREATE TABLE feedback_messages (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          thread_id   bigint NOT NULL REFERENCES feedback_threads (id) ON DELETE CASCADE,
          author      text NOT NULL CHECK (author IN ('player', 'everstats')),
          body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX feedback_messages_thread_time ON feedback_messages (thread_id, created_at);

        CREATE TABLE feedback_notes (
          id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          thread_id   bigint NOT NULL REFERENCES feedback_threads (id) ON DELETE CASCADE,
          body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
          created_at  timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX feedback_notes_thread_time ON feedback_notes (thread_id, created_at);

        -- Admin → Activity: COUNTS of events per UTC hour. No address, no user agent, no visitor id: a kind and a number.
        CREATE TABLE activity_counts (
          hour   timestamptz NOT NULL,
          kind   text NOT NULL CHECK (char_length(kind) <= 40),
          n      integer NOT NULL DEFAULT 0,
          PRIMARY KEY (hour, kind)
        );
        INSERT INTO pipeline_facts (key, at) VALUES ('activity_counting_since', now()) ON CONFLICT DO NOTHING;

        -- The owner's one-off "Grant beta membership" (admin only, reason required, logged). The guard keeps refusing
        -- every other change; this path only turns a NON-member into a member, only for an account created before the
        -- window closed (or while it is still open), and only inside a transaction that set everstats.granting_beta.
        -- It never opens, extends or edits a window.
        CREATE OR REPLACE FUNCTION accounts_beta_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.beta_member IS DISTINCT FROM OLD.beta_member OR NEW.beta_since IS DISTINCT FROM OLD.beta_since THEN
            IF current_setting('everstats.merging', true) = 'on' AND NEW.beta_member AND NEW.beta_since IS NOT NULL
               AND (NOT OLD.beta_member OR NEW.beta_since < OLD.beta_since) THEN
              RETURN NEW;
            END IF;
            IF current_setting('everstats.granting_beta', true) = 'on' AND NOT OLD.beta_member AND NEW.beta_member
               AND NEW.beta_since IS NOT NULL
               AND (EXISTS (SELECT 1 FROM beta_windows WHERE closed_at IS NULL)
                    OR OLD.created_at < (SELECT max(closed_at) FROM beta_windows)) THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'beta membership is permanent' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END
        $fn$;
      `);
      const { SEED_GUILD_BADGES } = await import('../guildBadges/catalog.js');
      for (const b of SEED_GUILD_BADGES) {
        await q.query(
          `INSERT INTO guild_badge_definitions (id, family, name, description, how, art, template, levelled, measure, thresholds, award, rule,
                                                kept_while_held, time_limited, status_mark, sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint[], $11, $12::jsonb, $13, $14, $15, $16) ON CONFLICT (id) DO NOTHING`,
          [b.id, b.family, b.name, b.description, b.how, b.art, b.template ?? null, Boolean(b.levelled), b.measure ?? null, b.thresholds ?? null,
            b.rule ? 'automatic' : 'manual', b.rule ? JSON.stringify(b.rule) : null, Boolean(b.keptWhileHeld), Boolean(b.timeLimited), Boolean(b.statusMark), b.sort],
        );
      }
    },
  },
  {
    // 0.8.0: share cards (server/cards/) and weighted tier categories.
    //   share_card_defaults  ours: the card a character's owner or a guild's Guild Master / officer saved as the
    //                        default (and link preview). Keyed on Blizzard's character or guild id without a foreign key
    //                        (a characters/guilds row can age out; the choice is ours). Deleted with the account that
    //                        saved it (CLAUDE.md names the deletion); a merge moves it.
    //   share_card_images    Blizzard data (retention/registry.js): rendered PNGs, keyed by a hash of everything that
    //                        decides the pixels; swept by data_at and kept at most a few hours; never in a backup.
    //   tier weights         nothing to migrate (settings default to the square-root formula); one full grading is
    //                        requested so every ruleset is graded with weights straight after the deploy.
    id: '017_share_cards',
    async up(q) {
      await q.query(`
        CREATE TABLE share_card_defaults (
          kind        text NOT NULL CHECK (kind IN ('character', 'tier', 'guild')),
          subject_id  bigint NOT NULL,
          options     jsonb NOT NULL,
          saved_by    bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          saved_at    timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (kind, subject_id)
        );
        CREATE INDEX share_card_defaults_by ON share_card_defaults (saved_by);
        CREATE TABLE share_card_images (
          key            text PRIMARY KEY,
          subject        text NOT NULL,
          character_ids  bigint[] NOT NULL DEFAULT '{}',
          guild_ids      bigint[] NOT NULL DEFAULT '{}',
          png            bytea NOT NULL,
          bytes          integer NOT NULL,
          render_ms      integer,
          data_at        timestamptz NOT NULL,
          created_at     timestamptz NOT NULL DEFAULT now(),
          last_used_at   timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX share_card_images_data_at ON share_card_images (data_at);
        CREATE INDEX share_card_images_used ON share_card_images (last_used_at);
        CREATE INDEX share_card_images_characters ON share_card_images USING gin (character_ids);
        INSERT INTO tier_runs (status, reasons) VALUES ('pending', ARRAY['category weights (0.8.0)']) ON CONFLICT DO NOTHING;
      `);
    },
  },
  {
    // 0.8.1: staff badge names, and Verified Content Creators (badges/creators.js).
    //   badge_definitions      'dev-team' is now named "Everstats Staff" and 'moderator' "Everstats Moderator" (owner's
    //                          decision: "Dev Team" could be read as Blizzard's developers). Ids stay, so every award,
    //                          pin and /badges/{id} address carries over. art_temporary marks art a design pass will
    //                          replace (shown on /admin/badges). The Verified Content Creator definition is added.
    //   badge_events           new types for the creator flow and the rename; a 'migration' actor for the rename.
    //   creator_verifications  (ours) one per account: the short code the creator puts in their channel bio, and where
    //                          it stands (pending → verified → revoked). handle_alert_at: a verified handle changed and
    //                          the admin hasn't looked yet.
    //   creator_handles        (ours) the handles the admin ticked as verified, AS THEY WERE: a Verified mark shows only
    //                          while the profile still has exactly that handle; changing it deletes the row (logged).
    id: '018_staff_names_creators',
    async up(q) {
      await q.query(`
        -- Found in 0.8.1: the platform id check needed two characters, so an X handle (platform 'x') could never be saved.
        ALTER TABLE account_social_links DROP CONSTRAINT IF EXISTS account_social_links_platform_check;
        ALTER TABLE account_social_links ADD CONSTRAINT account_social_links_platform_check CHECK (platform ~ '^[a-z][a-z0-9_]{0,30}$');
        ALTER TABLE badge_definitions ADD COLUMN art_temporary boolean NOT NULL DEFAULT false;
        ALTER TABLE badge_events DROP CONSTRAINT IF EXISTS badge_events_type_check;
        ALTER TABLE badge_events ADD CONSTRAINT badge_events_type_check CHECK (type IN ('granted', 'earned', 'revoked', 'removed', 'restored',
          'mark_uploaded', 'mark_saved', 'created', 'backfill', 'renamed', 'creator_started', 'creator_verified', 'creator_handle_changed', 'creator_revoked',
          'creator_alert_checked'));
        ALTER TABLE badge_events DROP CONSTRAINT IF EXISTS badge_events_actor_check;
        ALTER TABLE badge_events ADD CONSTRAINT badge_events_actor_check CHECK (actor IN ('admin', 'rule', 'backfill', 'migration', 'player'));

        CREATE TABLE creator_verifications (
          account_id       bigint PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
          code             text NOT NULL CHECK (code ~ '^ES-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
          state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'revoked')),
          started_at       timestamptz NOT NULL DEFAULT now(),
          verified_at      timestamptz,
          revoked_at       timestamptz,
          handle_alert_at  timestamptz,
          handle_alert     jsonb
        );
        CREATE INDEX creator_verifications_alert ON creator_verifications (handle_alert_at) WHERE handle_alert_at IS NOT NULL;
        CREATE TABLE creator_handles (
          account_id   bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          platform     text NOT NULL,
          handle       text NOT NULL,
          verified_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, platform)
        );
      `);
      const { SEED_BADGES } = await import('../badges/catalog.js');
      const OLD = { 'dev-team': 'Dev Team', moderator: 'Moderator' };
      for (const id of Object.keys(OLD)) {
        const b = SEED_BADGES.find((x) => x.id === id);
        const was = await q.one('SELECT name FROM badge_definitions WHERE id = $1', [id]);
        if (!was) continue;
        await q.query('UPDATE badge_definitions SET name = $2, description = $3, how = $4 WHERE id = $1', [id, b.name, b.description, b.how]);
        if (was.name !== b.name) {
          await q.query("INSERT INTO badge_events (type, badge_id, actor, reason, detail) VALUES ('renamed', $1, 'migration', $2, $3::jsonb)",
            [id, '“Dev Team” could be read as Blizzard’s developers', JSON.stringify({ from: was.name, to: b.name })]);
        }
      }
      const c = SEED_BADGES.find((x) => x.id === 'verified-creator');
      await q.query(
        `INSERT INTO badge_definitions (id, family, name, description, how, art, award, verified, sort, art_temporary)
         VALUES ($1, 'partner', $2, $3, $4, $5, 'manual', true, $6, true) ON CONFLICT (id) DO UPDATE SET art_temporary = true`,
        [c.id, c.name, c.description, c.how, c.art, c.sort],
      );
    },
  },
  {
    // 0.8.2: moderation (server/moderation/). All of it is Everstats' own data.
    //   accounts.role         'player' | 'moderator': the PERMISSION (the Everstats Moderator badge stays cosmetic). Inert
    //                         while the admin setting moderation.moderators is off.
    //   account_bans          one row per ban: temporary (ends_at) or permanent (no end). Lifting is a state with a
    //                         reason (lifted_*), never a delete; a temporary ban simply stops counting at ends_at.
    //   ban_identities        the sign-in identities (provider + subject) and passkey credential ids the account had
    //                         when the ban started, so they stay refused even if they were somehow moved later.
    //   moderation_actions    the log: every warning, forced rename, field reset, ban, unban, role change, identity
    //                         reveal and report decision, with who (admin / moderator / system), why and what changed.
    //                         notice = the player is shown it once and acknowledges it (acknowledged_at). Ids only, no
    //                         foreign key: like badge_events, the log keeps the bare account id after a deletion.
    //   reports               "Report" on profiles and guild descriptions. No reporter is stored, only whether they
    //                         were signed in: who reported whom can't leak because it isn't kept. snapshot = the
    //                         reported field as it was (the player's own text, our data), as evidence.
    //   sessions.stage        'banned': a sign-in to a banned account. It can read its ban notice, appeal and sign out.
    //   feedback_threads      type 'appeal' (only from the ban notice), linked to the ban.
    id: '019_moderation',
    async up(q) {
      await q.query(`
        ALTER TABLE accounts ADD COLUMN role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator'));
        ALTER TABLE accounts ADD COLUMN role_since timestamptz;

        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_stage_check;
        ALTER TABLE sessions ADD CONSTRAINT sessions_stage_check CHECK (stage IN ('second_factor', 'full', 'banned'));

        CREATE TABLE account_bans (
          id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          account_id        bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          kind              text NOT NULL CHECK (kind IN ('temporary', 'permanent')),
          starts_at         timestamptz NOT NULL DEFAULT now(),
          ends_at           timestamptz,
          reason            text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
          message           text CHECK (char_length(message) <= 1000),
          actor             text NOT NULL CHECK (actor IN ('admin', 'moderator')),
          actor_account_id  bigint,
          lifted_at         timestamptz,
          lifted_reason     text CHECK (char_length(lifted_reason) <= 500),
          lifted_actor      text CHECK (lifted_actor IN ('admin', 'moderator')),
          lifted_by         bigint,
          CHECK ((kind = 'permanent') = (ends_at IS NULL))
        );
        CREATE INDEX account_bans_account_time ON account_bans (account_id, starts_at);
        CREATE INDEX account_bans_live ON account_bans (account_id) WHERE lifted_at IS NULL;

        CREATE TABLE ban_identities (
          ban_id         bigint NOT NULL REFERENCES account_bans (id) ON DELETE CASCADE,
          kind           text NOT NULL CHECK (kind IN ('provider', 'passkey')),
          provider       text,
          subject        text,
          credential_id  text,
          CHECK ((kind = 'provider' AND provider IS NOT NULL AND subject IS NOT NULL) OR (kind = 'passkey' AND credential_id IS NOT NULL))
        );
        CREATE INDEX ban_identities_ban ON ban_identities (ban_id);
        CREATE INDEX ban_identities_provider ON ban_identities (provider, subject) WHERE kind = 'provider';
        CREATE INDEX ban_identities_passkey ON ban_identities (credential_id) WHERE kind = 'passkey';

        -- Is this account banned right now? (Used by every query that hides a banned account's public presence.)
        CREATE FUNCTION everstats_banned(acct bigint) RETURNS boolean LANGUAGE sql STABLE AS $fn$
          SELECT EXISTS (SELECT 1 FROM account_bans b WHERE b.account_id = acct AND b.lifted_at IS NULL AND (b.ends_at IS NULL OR b.ends_at > now()))
        $fn$;

        CREATE TABLE moderation_actions (
          id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          at                timestamptz NOT NULL DEFAULT now(),
          account_id        bigint,
          guild_id          bigint,
          type              text NOT NULL CHECK (type IN ('warning', 'username_reset', 'field_reset', 'guild_reset', 'ban', 'unban',
                              'role_granted', 'role_removed', 'identities_revealed', 'reports_dismissed', 'reports_actioned')),
          actor             text NOT NULL CHECK (actor IN ('admin', 'moderator', 'system')),
          actor_account_id  bigint,
          reason            text CHECK (char_length(reason) <= 500),
          message           text CHECK (char_length(message) <= 1000),
          detail            jsonb NOT NULL DEFAULT '{}',
          notice            boolean NOT NULL DEFAULT false,
          acknowledged_at   timestamptz
        );
        CREATE INDEX moderation_actions_account_time ON moderation_actions (account_id, at);
        CREATE INDEX moderation_actions_guild_time ON moderation_actions (guild_id, at) WHERE guild_id IS NOT NULL;
        CREATE INDEX moderation_actions_time ON moderation_actions (at);
        CREATE INDEX moderation_actions_unseen ON moderation_actions (account_id) WHERE notice AND acknowledged_at IS NULL;

        CREATE TABLE reports (
          id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          reported_at         timestamptz NOT NULL DEFAULT now(),
          target_kind         text NOT NULL CHECK (target_kind IN ('account', 'guild')),
          target_account_id   bigint,
          target_guild_id     bigint,
          what                text NOT NULL CHECK (what IN ('username', 'display_name', 'bio', 'social', 'badges', 'guild_description', 'other')),
          platform            text CHECK (platform ~ '^[a-z][a-z0-9_]{0,30}$'),
          note                text CHECK (char_length(note) <= 500),
          snapshot            jsonb NOT NULL DEFAULT '{}',
          reporter_signed_in  boolean NOT NULL,
          state               text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'actioned', 'dismissed')),
          resolved_at         timestamptz,
          resolved_actor      text CHECK (resolved_actor IN ('admin', 'moderator')),
          resolved_by         bigint,
          CHECK ((target_kind = 'account') = (target_account_id IS NOT NULL)),
          CHECK ((target_kind = 'guild') = (target_guild_id IS NOT NULL))
        );
        CREATE INDEX reports_state_time ON reports (state, reported_at);
        CREATE INDEX reports_account_time ON reports (target_account_id, reported_at) WHERE target_account_id IS NOT NULL;
        CREATE INDEX reports_guild_time ON reports (target_guild_id, reported_at) WHERE target_guild_id IS NOT NULL;

        ALTER TABLE feedback_threads DROP CONSTRAINT IF EXISTS feedback_threads_type_check;
        ALTER TABLE feedback_threads ADD CONSTRAINT feedback_threads_type_check CHECK (type IN ('bug', 'idea', 'question', 'partnership', 'other', 'appeal'));
        ALTER TABLE feedback_threads ADD COLUMN ban_id bigint REFERENCES account_bans (id) ON DELETE SET NULL;
      `);
    },
  },
  {
    // 0.8.3: the endpoint probe (discovery/probe/), a second kind of discovery run (options.kind = 'probe'). It can be
    // stopped: the admin asks (stop_requested_at), the run notices before its next request, analyses what it has and
    // ends 'stopped'. Same tables, same retention: a probe's responses are discovery_responses like any run's.
    id: '020_endpoint_probe',
    async up(q) {
      await q.query(`
        ALTER TABLE discovery_runs DROP CONSTRAINT IF EXISTS discovery_runs_status_check;
        ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_status_check
          CHECK (status IN ('queued', 'running', 'done', 'failed', 'interrupted', 'stopped'));
        ALTER TABLE discovery_runs ADD COLUMN stop_requested_at timestamptz;
      `);
    },
  },
  {
    // 0.9.0: "Fetch all members" on guild pages (guilds/fetchAll.js). A new crawl priority between a person waiting and
    // auto-fetch: lookup 1 · guild 2 · auto 3 · daily 4 · roster 5. Queued items move along with their names.
    //   guild_fetches        one per press: the roster read (step 1), then queued / running / done, with counts only.
    //   guild_fetch_members  the work list: each untracked level-10+ member's id and slug (from the roster Blizzard just
    //                        sent; guild_roster keeps no names), fed to the crawler a batch at a time and deleted when
    //                        the fetch ends. Both are Blizzard-derived and swept with the window (retention/registry.js).
    id: '021_guild_fetch',
    async up(q) {
      await q.query(`
        ALTER TABLE crawl_queue DROP CONSTRAINT IF EXISTS crawl_queue_priority_check;
        UPDATE crawl_queue SET priority = priority + 1 WHERE priority >= 2;
        ALTER TABLE crawl_queue ADD CONSTRAINT crawl_queue_priority_check CHECK (priority BETWEEN 1 AND 5);

        CREATE TABLE guild_fetches (
          id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          guild_id        bigint,
          slug            text NOT NULL CHECK (length(slug) BETWEEN 1 AND 120),
          state           text NOT NULL CHECK (state IN ('roster', 'ready', 'queued', 'running', 'done', 'failed', 'expired')),
          requested_at    timestamptz NOT NULL DEFAULT now(),
          roster_at       timestamptz,
          queued_at       timestamptz,
          started_at      timestamptz,
          finished_at     timestamptz,
          roster_members  integer,
          tracked_before  integer,
          to_fetch        integer,
          under_ten       integer,
          fetched         integer NOT NULL DEFAULT 0,
          not_found       integer NOT NULL DEFAULT 0,
          failed          integer NOT NULL DEFAULT 0,
          added           integer,
          problem         text CHECK (length(problem) <= 200)
        );
        CREATE UNIQUE INDEX guild_fetches_live ON guild_fetches (slug) WHERE state IN ('roster', 'ready', 'queued', 'running');
        CREATE INDEX guild_fetches_guild_time ON guild_fetches (guild_id, requested_at);
        CREATE INDEX guild_fetches_state ON guild_fetches (state, queued_at) WHERE state IN ('roster', 'ready', 'queued', 'running');
        CREATE INDEX guild_fetches_requested ON guild_fetches (requested_at);

        CREATE TABLE guild_fetch_members (
          fetch_id      bigint NOT NULL REFERENCES guild_fetches (id) ON DELETE CASCADE,
          character_id  bigint NOT NULL,
          slug          text NOT NULL CHECK (length(slug) BETWEEN 1 AND 200),
          state         text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'queued', 'done')),
          crawl_id      bigint,
          outcome       text CHECK (length(outcome) <= 200),
          listed_at     timestamptz NOT NULL DEFAULT now(),
          done_at       timestamptz,
          PRIMARY KEY (fetch_id, character_id)
        );
        CREATE INDEX guild_fetch_members_state ON guild_fetch_members (fetch_id, state);
        CREATE INDEX guild_fetch_members_listed ON guild_fetch_members (listed_at);
      `);
    },
  },
  {
    // 0.9.0: Collections (server/collections/) and opt-in gold (server/collections/gold.js). Shapes follow the 0.8.3
    // endpoint probe (run #4's stored responses). Every table here is classified in retention/registry.js.
    //   statistics.derived     the registry key of a statistic Everstats COUNTS from Blizzard's collections (mounts
    //                          collected …); null = one of Blizzard's own. Their values live in character_statistics
    //                          like any statistic, so they get boards, pins, snapshots and gains with no second system.
    //   character_collections  one row per character and collection kind: the PARSED list (never a raw body), whether
    //                          Blizzard returned it, and when the data in it was fetched (kept on a failed refresh).
    //   collection_catalog     Blizzard's static catalogs (mounts, pets, toys, titles, achievements, appearances …),
    //                          shared by everyone; collection_catalog_state says how far each one's refresh got.
    //   collection_sharing     account-wide detection per account and kind (derived from character_collections).
    //   character_gold         the protected-character money fields ONLY, as fixed columns: there is no column (and
    //                          no jsonb) that could hold a position, a bind position or a WoW account id.
    //   character_gold_public  the owner's opt-in ("Show my gold stats publicly"); ours.
    id: '023_collections',
    async up(q) {
      await q.query(`
        ALTER TABLE statistics ADD COLUMN derived text;
        ALTER TABLE crawl_queue DROP CONSTRAINT crawl_queue_kind_check;
        ALTER TABLE crawl_queue ADD CONSTRAINT crawl_queue_kind_check CHECK (kind IN ('character', 'guild', 'items', 'collections', 'catalog'));
        ALTER TABLE characters ADD COLUMN collections_fetched_at timestamptz, ADD COLUMN collections_first_at timestamptz;
        ALTER TABLE share_card_defaults DROP CONSTRAINT IF EXISTS share_card_defaults_kind_check;
        ALTER TABLE share_card_defaults ADD CONSTRAINT share_card_defaults_kind_check CHECK (kind IN ('character', 'tier', 'guild', 'collections'));

        CREATE TABLE character_collections (
          character_id     bigint NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
          kind             text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{1,30}$'),
          state            text NOT NULL CHECK (state IN ('ok', 'empty', 'not_returned')),
          http_status      smallint,
          data             jsonb,
          checked_at       timestamptz NOT NULL DEFAULT now(),
          data_fetched_at  timestamptz,
          PRIMARY KEY (character_id, kind)
        );
        CREATE INDEX character_collections_fetched ON character_collections (data_fetched_at);
        CREATE INDEX character_collections_checked ON character_collections (character_id, checked_at);

        CREATE TABLE collection_catalog (
          kind        text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{1,30}$'),
          id          bigint NOT NULL,
          name        text,
          data        jsonb NOT NULL DEFAULT '{}',
          fetched_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (kind, id)
        );
        CREATE INDEX collection_catalog_fetched ON collection_catalog (fetched_at);

        CREATE TABLE collection_catalog_state (
          kind         text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9-]{1,30}$'),
          state        text NOT NULL CHECK (state IN ('queued', 'building', 'ok', 'empty', 'failed')),
          total        integer,
          requests     integer NOT NULL DEFAULT 0,
          bytes        bigint NOT NULL DEFAULT 0,
          detail       text CHECK (char_length(detail) <= 300),
          started_at   timestamptz,
          finished_at  timestamptz,
          fetched_at   timestamptz
        );

        CREATE TABLE collection_sharing (
          account_id   bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          kind         text NOT NULL,
          shared       boolean NOT NULL,
          characters   integer NOT NULL,
          computed_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, kind)
        );
        CREATE INDEX collection_sharing_kind ON collection_sharing (kind, shared);
        CREATE INDEX collection_sharing_computed ON collection_sharing (computed_at);

        CREATE TABLE character_gold (
          character_id       bigint PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
          account_id         bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          money              bigint CHECK (money >= 0),
          gold_gained        bigint,
          gold_lost          bigint,
          item_value_gained  bigint,
          fetched_at         timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX character_gold_fetched ON character_gold (fetched_at);
        CREATE INDEX character_gold_account ON character_gold (account_id);

        CREATE TABLE character_gold_public (
          character_id  bigint PRIMARY KEY,
          account_id    bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          since         timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX character_gold_public_account ON character_gold_public (account_id);
      `);
    },
  },
  {
    // 0.9.1: a board for every collection (collections/registry.js FAMILIES): derived statistic ids are allocated per key
    // (an achievement category, a transmog slot, an instance, a PvP field) as they first appear, one id per key.
    id: '024_collection_boards',
    async up(q) {
      await q.query('CREATE UNIQUE INDEX statistics_derived ON statistics (derived) WHERE derived IS NOT NULL');
    },
  },
  {
    // 0.9.1: "Your guilds" on the home page (guilds/follow.js). The player's choices only: which guilds they follow
    // ("Pin to dashboard"), which of their own characters' guilds they hid from the section, and the order. Keyed on
    // Blizzard guild ids WITHOUT a foreign key (a guilds row ages out; the choice is ours and stays).
    id: '025_your_guilds',
    async up(q) {
      await q.query(`
        CREATE TABLE account_guilds (
          account_id  bigint NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
          guild_id    bigint NOT NULL,
          pinned      boolean NOT NULL DEFAULT false,
          hidden      boolean NOT NULL DEFAULT false,
          position    integer NOT NULL DEFAULT 0,
          pinned_at   timestamptz,
          updated_at  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (account_id, guild_id)
        );
        CREATE INDEX account_guilds_guild ON account_guilds (guild_id);
      `);
    },
  },
  {
    // 0.9.2: the gradual first collections fetch (collections/backfill.js) counts what it queued per UTC day, for its
    // daily cap and the admin's progress line. Counts only (ours).
    id: '026_collections_backfill',
    async up(q) {
      await q.query('CREATE TABLE collection_backfill_days (day date PRIMARY KEY, queued integer NOT NULL DEFAULT 0)');
    },
  },
];
