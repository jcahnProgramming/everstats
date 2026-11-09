# Everstats

WoW Forever character statistics, per-statistic leaderboards and letter tiers, at https://everstats.app. Built by
Path. Stack, structure and deploy are copied from the owner's next-up project (which copied home-dashboard); when in
doubt, do it the way next-up does, except where this file says otherwise and why.

**Hard boundary: PUBLIC on the internet** through a Cloudflare tunnel, **with optional accounts**. Treat every
request as hostile: CSRF origin check, rate limits, httpOnly cookies, nothing secret in logs.

---

## What Everstats is (settled spec: build toward this, don't redesign it)

- Look up a WoW Forever character by **name + surname** (realmless; slug `{name}-{surname}`, lower case; US only in
  1.0). Show a hero render, gear and core stats, then the main event: the character's full in-game **statistics**.
- **Every statistic gets its own leaderboard, per ruleset.** US rulesets come from the API
  (`/data/wow/ruleset/index`), **never hardcoded** (Hardcore arrives post-launch and must just appear).
- **One overall letter tier per character**, S/A/B/C/D by percentile **within their own ruleset**: S top 5 %,
  A next 15 %, B next 30 %, C next 30 %, D bottom 20 % (`server/stats/tiers.js`, shared with the client). Statistics
  are grouped into categories; each category has its own letter; the overall tier rolls up from the categories.
  **"Bad" statistics (deaths and similar) get leaderboards but never affect a tier.** Owner decisions after
  discovery run 1 (2026-11-09): **every statistic gets a leaderboard** (ties and name + number ones too, ranked by
  the number); deaths & mishaps, duels lost, Quests abandoned and name + number statistics are leaderboard-only;
  **farmable categories (Social emotes; Camping & Hearth) get their own category tier on the character page but are
  excluded from the overall tier**; a duplicate pair keeps both leaderboards, and one of them stops counting toward
  tiers **only once the owner approves the pairing** (after run 2: equal values in low-level samples aren't proof,
  and World vs Total Honorable Kills turned out to differ). A ruleset below the minimum
  population shows **"Unranked — grading opens at N tracked characters"** (N = admin setting
  `grading.minPopulation`, default 500).
- **Freshness:** a search refreshes the character immediately; every tracked character re-syncs at least daily
  (worker); guild rosters seed new characters. **Daily snapshots per character are kept forever** (progress charts,
  "climbers this week").
- **Guild pages** in 1.0: roster with each member's tier, plus guild rankings on leaderboards.
- **Accounts are optional** (see "Accounts"). Battle.net OAuth, Discord OAuth, passkeys; optional TOTP 2FA.
- **Three themes**: Forever (default), Alliance, Horde. Logged-out visitors always see Forever.
- **Admin**: passkey-only, one person, with an API key manager, settings and crawler status. Visitors never see it.
- **Not in 1.0:** the MCP server (room left: separate container and port, read-only database role), EU/KR/TW
  (`REGION` is config; only `us` is accepted).

**1.0.0 is the public US launch** with character pages, per-statistic leaderboards, tiers, guild pages, both
logins, passkeys, 2FA and the three themes live. Until then, a page whose feature isn't built says "Coming soon"
plainly. Never build a stub that pretends something works.

## Architecture: registries, not lists

Anything there will be more of declares itself in one registry, and the code that uses it iterates the registry.
Never add an `if (provider === 'discord')` or a hardcoded list in a route or a page.

| Registry | File | Declares |
|---|---|---|
| Sign-in providers | `server/auth/providers.js` | id, label, credential, authorize/token URLs, scopes, pkce, `identity()` |
| Credentials | `server/credentials/registry.js` | id, label, unlocks, where to get it, fields (+ `.env` fallback names), test |
| Admin settings | `server/admin/settings.js` | key, label, help, type, bounds, default |
| Statistics / categories / leaderboards | `server/stats/catalog.js` | the `statistics` table (grows from crawls) + discovery decisions, else suggestions |
| Account merge steps | `server/account/merge.js` | how each account-owned table moves on a merge |
| Worker jobs | `server/worker/jobs.js` | id, label, everyMs, run() (must return fast; long work runs in the background): `backup`, `discovery`, `refresh`, `rulesets`, `pin-ranks` |
| Data sources | `server/sources/registry.js` | id, label, credential, userProvider, create() → `get(path, { namespace, auth, userToken })`. One so far: `blizzard`. A provider named as a `userProvider` reads characters at sign-in |
| Discovery endpoints | `server/discovery/endpoints.js` | what a discovery run asks for (data, account, character, guild, slug probes) |
| Suggestion rules | `server/discovery/suggest.js` | per-statistic suggestions (category, bad, leaderboard), each with its reasoning |

- Statistics, categories and rulesets come from Blizzard's API (discovery pass), stored as data, never typed in
  from memory. A new statistic in a game patch must be data, not a deploy.
- Layout: `server/` (Express 5, ESM; `index.js` web, `worker/index.js` worker, one image, two containers),
  `client/` (React 19 + Vite + react-router), `scripts/` (dev launcher, dev database, changelog check, key printer).

## Accounts and auth (`server/auth/`, `server/account/`)

- **First sign-in with Battle.net or Discord creates an account.** `(provider, subject)` is the only key.
  **Never link or match accounts by email, name, BattleTag or anything else.** We don't even ask for email.
- **A second provider or a passkey can only be added from Settings while signed in** (OAuth intent `link`;
  passkey registration requires a full session). Signing in fresh with an unlinked provider creates a new,
  separate account. An identity already linked to another account is refused (`linked_elsewhere`), never moved.
- **Merge** (`/settings/merge`): signed in as the source, the person proves the target (provider sign-in with intent
  `merge`, or its passkey, plus the target's 2FA code if it has 2FA on), sees what will happen, confirms. Merge
  steps run in one transaction; the source account is deleted. A merge into an identity no account uses is refused
  (it never creates an account).
- **Passkeys** (`@simplewebauthn/server`): discoverable credentials, RP id = PUBLIC_ORIGIN's hostname, origin =
  PUBLIC_ORIGIN exactly. Passkeys never create accounts. **A passkey sign-in skips 2FA.** The last way into an
  account (provider or passkey) can't be removed.
- **TOTP 2FA** (`server/auth/totp.js`): SHA-1/6 digits/30 s, ±1 step, **no replay** (`last_step` only moves
  forward). Secret sealed with the root key. After a Battle.net/Discord sign-in on an account with 2FA on, the
  session is `second_factor` (10 minutes, can do nothing but answer the code or sign out). **Ten recovery codes,
  shown exactly once** on enabling (or regenerating); only an HMAC is stored; each works once. Turning 2FA off or
  regenerating codes needs a current code.
- **Sessions:** random token in an httpOnly cookie, SHA-256 in `sessions`; a new token on every sign-in and on
  passing 2FA. 30 days. Cookies (`server/auth/cookies.js`): `__Host-` prefix + Secure in production; session and flow
  cookies SameSite=Lax (the OAuth callback is a cross-site top-level GET), admin SameSite=Strict.
- **Auth flows** (`auth_flows`): OAuth state, passkey challenges, merge proposals. Bound to the browser by the flow
  cookie, used once, 10 minutes. The OAuth callback compares `state` in constant time and always ends in a redirect
  to a page that explains the outcome (`?error=<code>`, words in `client/src/authMessages.js`).
- **Honest "not configured":** until a provider's keys exist, `/api/session` says `configured: false` and the
  sign-in page shows that provider as a disabled "Not configured" button. Never a button that fails. "Isn't set up
  yet" is said about providers only: passkeys are always offered (they're added from Settings once an account exists),
  and a browser with no Everstats passkey gets "No passkey yet — sign in with … then add one in Settings".
- Provider facts (verified 2026-11-08, comment in `providers.js`): Battle.net scopes `openid wow.profile`, HTTP
  Basic at the token endpoint, `/userinfo` for id + BattleTag, ~24 h tokens, no PKCE documented. Discord scope
  `identify`, no PKCE documented. The OAuth callbacks are exactly `/auth/battlenet/callback` and
  `/auth/discord/callback` (registered with both providers, plus `http://localhost:3000` versions for dev).

## Admin (`server/admin/`, `client/src/admin/`)

- The admin is **not an account**: passkeys only (`admin_passkeys`), enrolled with a one-time, 15-minute invite
  printed on the server: `docker exec -it everstats node server/tools/admin-invite.js`. The link carries the token
  in its `#fragment` (never in a server log).
- **Visitors never see it**: no link anywhere; every `/api/admin/*` route except enrolment and sign-in answers a plain
  404 without an admin session. `/admin` without one redirects to `/admin/sign-in` (owner's decision, 0.4.0); the API
  stays a plain 404. Admin sessions: 2 hours.
- The page: the API key manager (registry-driven), the grading minimum, crawler status (`worker_status` and
  `crawler_status`; older than 3 minutes shows "Not responding", never "running"), the beta window and its perks.

## Discovery (`server/discovery/`, `client/src/admin/DiscoveryPage.jsx`)

- Admin-only page `/admin/discovery` (linked only from `/admin`; its API sits behind the admin 404 gate). A run is
  queued there and run by the worker job `discovery`, one at a time; a run whose heartbeat is 5 minutes old is
  marked `interrupted`.
- It reads Blizzard only through the `blizzard` source (`server/sources/blizzard.js`): tokens in the Authorization
  header only, never a URL; hrefs to any host but the API's are refused; pacing from `discovery.requestsPerSecond`;
  429/503 retried. Static namespace = the one the API's own links name, never a hardcoded version.
- `/profile/user/wow` needs a user token. Sign-in drops its token, so the Discovery page has its own Battle.net
  authorization (OAuth intent `discovery`, same `/auth/battlenet/callback`; the flow, not the Strict admin cookie,
  is the proof). Token sealed in `discovery_grants`.
- `discovery_responses` keeps every raw body forever (evidence). `discovery_statistics` is a per-run catalog;
  `discovery_catalog` (+ `discovery_combined`, one summary row) combines every finished run, a character in two runs
  counted once with its newest values. `discovery_decisions` is append-only and belongs to the **statistic**, not a
  run, so a decision shows in every view. **These are discovery tables, not production character tables**, and
  approving a suggestion builds nothing yet.
- Suggestions (`suggest.js`) are `category`, `grading` (`overall` | `category` | `none`), `leaderboard` (always yes)
  and `duplicate` (`{ of }`, only when equal values suggest one: "possible", or "likely" when the names are the same apart from filler like "total"),
  from name, value and Blizzard-category rules, never statistic ids. They are computed **when the catalog is read**
  (`present()`), from the analysed row plus the current decisions, so an approval takes effect at once. The
  `value_type` decision is the owner's correction of a guessed type and overrides the analysis. Value types are
  guesses unless the samples show them (name + number, text, fractions); time/gold/distance need a stated unit.
- The catalog is derived: **Re-analyse** (one run) and **Re-analyse all runs** rebuild `discovery_statistics`, the
  summaries and the combined catalog from stored responses with the current rules (no Blizzard request); a finished
  run rebuilds the combined catalog too. The raw responses are the record and are never rebuilt. Old `bad` decisions
  stay in the append-only history.

## Crawler and the production data (0.4.0: `server/crawler/`, `server/stats/`, `server/characters/`)

- **One Blizzard request budget** (`crawler/budget.js`, admin setting `crawler.requestsPerSecond`, default 8), owned by the
  crawler in the WORKER (`crawler/service.js`, runs continuously beside the job loop). Waiting requests are served by
  priority: 1 a person waiting (lookup, sign-in) · 2 auto-fetch after sign-in · 3 daily refresh · 4 guild rosters.
  Background items hold at most 3 of the 4 slots, so a lookup never waits behind the crawl. Back-off is per endpoint
  (429/5xx/no answer double the wait, Retry-After respected); only 20 successes in a row reset it.
- The web process makes exactly one Blizzard call itself: `/profile/user/wow` with a sign-in's user token
  (`crawler/account.js`), because the token must not be stored or handed on. Everything else is queued (`crawl_queue`)
  and the web waits for it (lookups, up to 20 s).
- **A character fetch** (`crawler/fetch.js`): profile; then achievement-statistics, statistics (attributes), equipment and
  character-media in parallel = 5 requests. A daily 'check' whose `last_login_timestamp` equals the one at the last
  full fetch stops after the profile (1 request; +1 while the render isn't ready). Every fetch or check takes today's
  snapshot from the current values.
- **Parsed values only** in production tables (`crawler/parse.js`); raw bodies exist only in `discovery_responses`.
  Statistics Blizzard doesn't list are zero and have no row. Render URLs are kept only from
  `https://render.worldofwarcraft.com` (the CSP's only other image host). `main-raw` is a 1600×1200 landscape image.
- **Snapshots**: `character_snapshots`, one per character per UTC day (the first), two arrays (ids, values), in the
  `snapshots` tablespace (~1 KB per character per day measured). The first snapshot in a week/month is that period's
  baseline (`period_baselines`); `stat_gains` holds gains > 0, rebuilt per character on each fetch.
- **Boards** (`stats/boards.js`): rank = 1 + visible characters strictly above; ties share; zeros tie after everyone;
  hidden characters are on no board and in no population. Every count repeats the partial index predicate (`value > 0`,
  `NOT hidden`), or the planner can't use the index. Nothing is cached: a rank and its "of N" are counted together.
  Weekly = from Tuesday 15:00 UTC (US weekly reset); monthly = calendar month UTC (`stats/periods.js`). A period board
  is "Collecting data" until snapshots began at or before the period's start. `scripts/measure-boards.js` measures it all
  on synthetic data in a throwaway in-memory database.
- **The catalog grows by itself**: a statistic id first seen in a crawl is added to `statistics` and appears on the
  Discovery page's combined catalog; its category / grading / value type are the owner's decisions, else suggestions
  (`stats/catalog.js`, cached 60 s per process; a decision clears the web's cache at once).
- **Auto-fetch at sign-in**: a Battle.net sign-in, link or "Refresh my characters" (OAuth intent `characters`, only for an
  identity already linked to the signed-in account) reads the character list once, upserts every character owned by
  that account, queues level 10+ at priority 2, records the outcome (`account_character_checks`: ok / none / error).
  A failure there never fails the sign-in.
- Lookups: a character fully fetched in the last 10 minutes is served without asking Blizzard; only a lookup that asks
  Blizzard counts against the per-network limit.

## The beta (`server/beta.js`, `chrome/BetaBanner.jsx`, `/beta`)

- A window (`beta_windows`), opened by migration 009 and closed/reopened only from the admin page. While open: the header
  badge, the dismissible banner (localStorage, wrapped; keyed by the window's opening date), and /beta's "open"
  version; closed, /beta thanks everyone and still lists the perks (admin setting `beta.perks`).
- **Membership is permanent and decided only by the window**: a database trigger sets `accounts.beta_member` /
  `beta_since` at INSERT from the window open at that moment; another refuses any later change except a merge giving
  the kept account an EARLIER real membership (`account/merge.js`, `everstats.merging`). Never back-fill it, never
  edit it, never add a code path that writes it. Accounts from before 0.4.0 are not members.

## Themes and design

- **The design system is Claude Design v1, "Cartographer's Ledger"** (`design/v1/`: README, tokens, component
  specs, page mockups and screenshots, states). It is reference only: nothing there is served. Build new UI from it:
  `design/v1/components/*.md` for a component, `design/v1/pages/<page>/` for a layout, `design/v1/states/` for a state.
  Its placeholder names and numbers (`Placeholdername`, `99,999`, `[Date]`) never ship.
- **Exactly three themes:** `forever` (twilight blue, gold, white, faint old-map grid), `alliance` (royal blue,
  polished gold trim, parchment highlight), `horde` (crimson and charcoal, bronze/iron, ember orange). Tokens in
  `client/src/theme/tokens.css`, all `--es-*` (the design's `themes.css` copied verbatim under a header;
  `[data-theme="…"]` blocks, so a swatch can wear a theme too).
- **Stylesheets:** `theme/fonts.css` → `theme/tokens.css` → `theme/components.css` (the design's `components.css`,
  VERBATIM, so the next handoff diffs cleanly; don't edit it, override in `app.css`) → `theme/app.css` (app additions)
  → `pages/pages.css` (page layouts). The CSP forbids `style=""` attributes, so the mockups' inline styles become
  classes; a React `style={{}}` (CSSOM) is allowed for computed values like a bar's width.
- **Fonts are self-hosted** (`theme/fonts/`, SIL OFL 1.1, licence texts also served at `/licenses/`): Cinzel
  (display, never body or values), Inter (body and every number, tabular lining figures), JetBrains Mono (codes).
- **No colour outside `tokens.css`, ever.** `server/test/client-colours.test.js` fails on any hex/rgb/hsl elsewhere
  and on a theme missing a token (hex or rgba). Tier badges S/A/B/C/D are shields with item-quality fills, tuned
  per theme to 7:1; Unranked is the colourless "–" shield.
- **Logged-out visitors always see Forever.** Switching themes is a signed-in perk; the choice is stored on the
  account (`accounts.theme`), never in the browser. `/api/theme-boot.js` (a blocking script in `index.html`, served by
  the app per session) applies it before first paint; a `second_factor` session still gets Forever.
- Not Apple glass, not Material: its own WoW-flavoured look.
- A sticky top bar (the design's navigation option A, "Ledger Bar": brand mark + wordmark, Leaderboards, Guilds, a
  one-box character search with `/` to focus, Sign in / Finish sign-in / Account; on phones two icon buttons opening a
  sheet) and a footer strip at the end of every page: the disclaimer and the "v0.x.y · What's new" chip. **That chip
  is the only route to `/changelog`.** No admin link, even though the design draws one "for the owner".
- **The four empty states** (`components/EmptyState.jsx`): Coming soon = solid gold-edged panel + clock (the design
  has none; built from its parts); No data yet = dashed box; No coverage here = hatched panel + crossed circle;
  Unranked = the "–" shield + a progress line only when the tracked count is known. Other states from
  `design/v1/states` live in `components/States.jsx` (loading, not found, service unavailable) and `<RenderFrame
  pending>`.
- Destructive account actions (unlink, remove passkey, turn 2FA off) confirm in a `<Modal>` first; async results
  use toasts (`components/Toasts.jsx`); errors that belong to a form stay in the form.
- **No native `<select>`** (its popup ignores the theme); the theme picker is a radio group of buttons.
- New pages open at the top with the heading focused; Back restores the position (`client/src/chrome/scrollMemory.js`,
  positions keyed by history entry AND path; see "Bugs that cost us").
- Phones (390 px): no horizontal scroll; top-bar labels collapse to icons; forms stack.

## Data rules

- **Postgres 17** (one database, `everstats-db` container). Bulk time-series (daily snapshots) go in the
  **`snapshots` tablespace** on the array disk (`server/core/tablespace.js`): a snapshot table's migration ends its
  `CREATE TABLE` with `await snapshotTablespace(q)`. Production refuses to start without `SNAPSHOT_TABLESPACE_DIR`.
- **Retention is forever.** Snapshots, statistics history and account history are never deleted. Any exception must
  be named here, with its reason. The exceptions:
  - **Expired sessions, auth flows, admin sessions and old admin invites** are deleted hourly (`sweepExpired` in
    `server/app.js`). Reason: they are credentials, not history; keeping dead ones only adds risk.
  - **A merged account's row is deleted** after its data moves (`server/account/merge.js`). Reason: the person asked
    for exactly that; its history lives on as the target's `account.merged_in` event.
  - **Unlinking a provider or removing a passkey deletes that row.** Reason: the person asked to remove a way in.
  - **Turning 2FA off deletes the secret and recovery codes.** Reason: a stale secret is a liability.
  - **Finished crawl-queue items** (`crawl_queue`) are deleted an hour after they finish. Reason: they are work orders;
    what they fetched lives in the character tables, and request counts in `crawler_hours` (kept forever).
  - **Deleting an account** (Settings, `DELETE /api/account`) deletes the account row and everything that cascades from
    it (sign-in links, passkeys, 2FA, recovery codes, sessions, flows, pins, events, character checks). Reason: the
    person asked. Its characters stay (public data); ownership is cleared, a hidden one stays hidden.
  - **Discovery Battle.net tokens** (`discovery_grants`) are deleted when they expire (hourly sweep), when the admin
    forgets one, or when a new authorization replaces it. Reason: a credential, not history.
  - **Old nightly backup files are pruned**: the 14 newest dumps and the first dump of every month are kept, the rest
    deleted after a good backup (`server/core/backup.js`). Reason: they are copies of the database, not history; the
    monthly ones keep a long-range restore point forever. The `backup_runs` log itself is kept forever.
- Every time-series table has a composite index on `(parent_id, timestamp)`.
- **Every query takes limit/cursor. No unbounded selects, ever** (`pageLimit()` in `server/core/db.js`).
- Migrations: `server/core/schema.js` (`{ id, up(q) }`, run under an advisory lock by both processes). Never edit or
  reorder one that has shipped. Blizzard-shaped tables (007+) follow what the discovery runs stored, never memory.
- `pg` turns a JS array parameter into a Postgres array: for `jsonb` pass `JSON.stringify(value)`.
- **Backups** (`server/core/backup.js`, registered as the worker job `backup`; `RESTORE.md`): every night after
  04:00 UTC (at once after a missed night) the worker runs `pg_dump --format=custom` into `BACKUP_DIR` (`/backups` in
  the worker container), reads the whole archive back with `pg_restore` before keeping it as
  `everstats-YYYY-MM-DD.dump`, and records each run in `backup_runs` (admin page and worker `/api/health` read it). The
  dump runs in the background so the heartbeat never stalls; one at a time (PID lock file). A failure logs
  `[backup] FAILED`, keeps every earlier dump and retries after an hour. By hand:
  `docker exec everstats-worker node server/tools/backup.js now | list | verify <file>`. The image carries
  `postgresql-client-17` (from apt.postgresql.org; it must match the server's major). Production workers refuse to
  start without `BACKUP_DIR`. A dump does not contain the root key: a restore needs the same `.env`.

## Hosting and networking

- **Treat this repo as public.** Never commit the server's hostname, addresses, paths, network ranges, tunnel name
  or internal URLs. They live in Gitea Actions variables and the owner's private ops notes.
- One deploy folder (Gitea variable `DEPLOY_DIR`). Three containers: `everstats-db` (no published port),
  `everstats` (web, port **3260**), `everstats-worker` (worker, port **3261**). The ports are written once in
  `server/core/config.js` (`DEFAULT_WEB_PORT`, `DEFAULT_WORKER_PORT`) and must agree with the Dockerfile, compose and
  the deploy (`server/test/compose-guard.test.js`); `WEB_PORT` / `WORKER_PORT` override the host side.
- **Host ports bind to `BIND_IP` only, never `0.0.0.0`.** `BIND_IP`, `PG_DATA_DIR`, `PG_SNAPSHOT_DIR`, `BACKUP_DIR`
  and `POSTGRES_PASSWORD` are required with no default. **Database folders are direct disk paths, never `/mnt/user`**
  (Unraid's shfs FUSE layer and database locking don't mix); the deploy refuses `/mnt/user` paths.
- **Only the web app is in the tunnel**: `everstats.app` → port 3260 on `BIND_IP`. The worker port is for the deploy
  and healthchecks only; never add it to the tunnel.
- `/api/health` on both returns `{ status, service, version, database }` (worker adds `loop`), 503 when the
  database is unreachable or the worker loop has stalled. Nothing else: it is public.
- **Security headers** (`server/core/headers.js`): CSP `'self'` only (no inline script or style; the theme boot is a
  served file; images also from `https://render.worldofwarcraft.com`, Blizzard's character renders), `nosniff`, `Referrer-Policy: same-origin`, HSTS over HTTPS, and a Permissions-Policy that denies
  every device feature **except `publickey-credentials-get/create` for this origin** (next-up denies them, which
  would switch passkeys off).
- **CSRF**: every non-GET `/api` request must carry `Origin: <PUBLIC_ORIGIN>` exactly (`server/core/sameOrigin.js`);
  no Origin is refused too.
- **TRUSTED_PROXIES discovery:** the network resolver runs once on EVERY request (`server/app.js`), logs each new
  connection address `CF-Connecting-IP` arrives from (`docker logs everstats 2>&1 | grep CF-Connecting-IP`) and lists
  them on the admin page (Proxy addresses). Never the visitor's own address. Put cloudflared's address there into
  `TRUSTED_PROXIES` in `.env`.
- **Rate limits** per network, in memory (`server/core/rateLimit.js`, network from `CF-Connecting-IP` via
  `server/core/network.js`, copied from next-up; set `TRUSTED_PROXIES`): lookups that ask Blizzard 30/15 min, auth starts 30/15 min,
  wrong 2FA codes 10/15 min per network AND 5/15 min per account (a right code refunds), admin 10/15 min, account
  and admin writes 120/15 min.

## Deploy

Push to `main` → `.gitea/workflows/deploy.yml` (from next-up): preflight (variables, Docker, `.env` has the root key
and database password, both database folders exist and aren't under `/mnt/user`, the backup folder exists and uid
1000 can write to it; the backup folder MAY be under `/mnt/user`, a flat file write), fingerprint `.env`, **fast-forward**
the host checkout from Gitea's internal URL (refuses a checkout with local edits, never `reset --hard`),
`docker compose up -d --build`, then probe web `/api/health`, web `/`, worker `/api/health` and the database's health
until all are healthy (~2 min), fail on any restart in the next 15 s (crash loop), fail unless both app containers
report the version in the pulled `CHANGELOG.json`, and fail if `.env` changed. Gitea variables: `DEPLOY_DIR`,
`INTERNAL_GIT_URL`, `BIND_IP`, `PG_DATA_DIR`, `PG_SNAPSHOT_DIR`, `BACKUP_DIR` (optional `WEB_PORT`, `WORKER_PORT`).

## Credentials

- **The app never writes `.env`** (the deploy fingerprints it). Everything in it is added by hand.
- `.env` holds `EVERSTATS_ROOT_KEY` (32 bytes base64; `npm run gen-key root`) and `POSTGRES_PASSWORD`
  (`npm run gen-key postgres`). Both processes refuse to start without a valid root key. **Changing or losing the root
  key makes every stored API key and 2FA secret unreadable** (shown as "Can't decrypt"; keys re-entered, 2FA
  re-enrolled). Keep a copy outside the server.
- API keys resolve **database (AES-256-GCM under the root key, slot bound in) → `.env` fallback → "not configured"**
  (`server/credentials/store.js`). **No key is ever sent to a browser**: the admin sees state, source and "set on"
  date, nothing else, not even a last four.
- Logs never contain a request body, a query string (OAuth codes live there), a cookie, a token, a key, a 2FA code or
  secret. Unexpected errors log name, code and stack locations only (`server/core/errors.js`).

## Honesty rules

- **Never invent or mock data**, including during development: no sample characters, fake leaderboards or
  placeholder stats. An honest empty state beats a plausible fake number.
- **Four empty states that never look alike** (`client/src/components/EmptyState.jsx`): *Coming soon* (not built),
  *No data yet* (built, nothing here yet), *No coverage here* (outside what Everstats tracks), *Unranked* (ruleset
  below the grading population). Each has its own label, icon and border style.
- **Provenance:** every stat will show where it came from and how fresh it is; the layouts keep a provenance line
  (`<Provenance>`) under every section. Character-media lags the profile by hours: it gets its own freshness.
- If we can't measure something, say so (`null`, "not measured"), never estimate. A stopped worker is "Not
  responding", never "running".

## Bugs that cost us (in next-up and home-dashboard): don't reintroduce

- **Interactive elements inside a card must sit above the card's full-size click target**; test with real input.
- **Write `-webkit-backdrop-filter` before `backdrop-filter`** if blur ever comes back (the minifier kept only one).
- **Effect cleanup:** arrow-function effects use block bodies, never concise bodies (React calls the return value).
- **A drag must not move the node that holds the pointer**; end-of-drag listeners live on window/document.
- **A container's own hostname wins over Docker DNS.** Never give a container a hostname something else proxies to.
- **Back off per service, not per host.** Only sustained success resets. (The crawler will need this.)
- **A page reached from the bottom bar opened scrolled to the bottom.** New pages open at the top. And (found here,
  0.1.0) next-up's scroll memory keyed positions by history entry alone: every fresh page load is entry `default`, so
  a freshly opened page restored the previous page's position. Keys are now entry + path.
- **A token on a light panel inherits the panel's text colour** (found here, 0.1.0: recovery codes on Alliance's
  parchment went dark-on-dark). Anything with its own background sets its own text colour. Visual pass in all three
  themes, every time.
- **A diagnostic that only runs on some routes says nothing on the others** (found here, 0.1.0): the
  `CF-Connecting-IP` source was only checked inside the rate limiters, so a real page load through the tunnel logged
  nothing. Anything meant to observe every request is middleware on every request.
- **The design draws things the rules forbid** (found here, design v1): an admin link for the owner, a last-four of
  each API key, a hardcoded "Hardcore · soon" ruleset, and a merge that runs the wrong way round. This file wins; say
  so in the component's header comment.

## Testing

- `npm test` (node:test, `server/test/`). Each file gets a fresh in-memory Postgres (PGlite behind a socket,
  `server/test/helpers.js`) and its own root key; never point a test at `data/` or a real server. `startApp({ fetch })`
  takes a fake outbound fetch (OAuth, key tests): tests never reach Blizzard or Discord.
- `npm run build` runs `scripts/check-changelog.js` first.
- `npm run dev`: an embedded dev database (`scripts/dev-db.js`, PGlite on 127.0.0.1:5439, data in `data/dev-pglite`),
  web, worker and Vite on **http://localhost:3000** (the registered OAuth dev origin). Needs `EVERSTATS_ROOT_KEY` in
  `.env` or the shell.
- Verify a fix's test catches the bug by running it against unfixed code.
- Visual pass in **all three themes**, plus phone width (390 px), with no horizontal scroll.

## Changelog and versioning

`CHANGELOG.json` at the repo root is the single source of version truth: the server (`server/core/version.js`),
`/api/health`, the bottom bar and `/changelog` (`client/src/release.js`) all read it. `scripts/check-changelog.js`
runs before the build, so a malformed entry fails the build and the deploy.

```json
{ "version": "0.x.y", "date": "YYYY-MM-DD", "title": "…",
  "sections": { "New": […], "Improved": […], "Fixed": […], "Removed": […] } }
```

Newest first; omit sections that don't apply.

- **PATCH** (0.x.1) for fixes, small additions, refinements. The default.
- **MINOR** (0.x.0) for a genuinely new feature or major capability.
- **1.0.0 is reserved for the public US launch** on everstats.app with character pages, per-statistic leaderboards,
  tiers, guild pages, both logins, passkeys, 2FA and the three themes live. Don't approach it.

Write entries for someone reading them in six months: what changed from a user's point of view, not which files moved.

## What the discovery runs settled (runs 1–2, 2026-11-09; the stored responses are the evidence)

- Namespaces `profile-forever-us` / `dynamic-forever-us` / versioned `static-…-forever-us`; character
  `/profile/wow/character/{name}-{surname}` lower case (capitals 404; accents percent-encoded; `%2D` works too).
- Statistics: `…/achievements/statistics` (not `/statistics`, which is attributes). Missing = zero.
- `/profile/user/wow` lists `wow_accounts[].characters[]` with id (= the profile's id), name, surname, level, class,
  race, faction and a character href, but **no slug field and no ruleset**. Characters < 10 are listed; their profile 404s.
- Guilds live at `/data/wow/guild/{slug}` in the PROFILE namespace; rosters list members with id, slug, surname, level.
- Still open: whether surnames can hold hyphens (slugs use `-` as the separator; `server/stats/slug.js` refuses them).
