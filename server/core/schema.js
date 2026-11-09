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
];
