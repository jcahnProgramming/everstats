/**
 * Migrations, applied in order and recorded in _migrations (core/migrations.js). Each is { id: '001_name', up(q) }.
 * Never edit or reorder one that has shipped: add a new one.
 *
 * Rules every table follows (CLAUDE.md, "Data rules"):
 *   - every time-series table has a composite index on (parent_id, timestamp)
 *   - nothing is deleted except where CLAUDE.md names the exception
 *   - no Blizzard-shaped tables (characters, statistics, snapshots, rulesets, guilds) before the discovery pass: their
 *     shape comes from what the API really returns. Snapshot tables go in the "snapshots" tablespace (core/tablespace.js).
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
];
