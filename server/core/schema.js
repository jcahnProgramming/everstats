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
];
