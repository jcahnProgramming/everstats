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
  population shows **"Tiers open once N characters are tracked on {ruleset} (n so far)"** (N = admin setting
  `grading.minPopulation`, default 50 since 0.6.0). Built in 0.6.0: see "Tiers".
- **Freshness:** a search refreshes the character immediately; every tracked character re-syncs at least daily
  (worker); guild rosters seed new characters. **Daily snapshots are kept 29 days, never longer** (Blizzard's 30-day
  rule, see "Retention"): enough for weekly boards, rank movement and the "Last 29 days" boards.
- **Guild pages** (built 0.5.0, see "Guilds"): roster, totals, top members, and guild-vs-guild boards. Each member's
  tier joins the roster when tiers are built.
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
| Worker jobs | `server/worker/jobs.js` | id, label, everyMs, run() (must return fast; long work runs in the background): `backup`, `discovery`, `refresh`, `rulesets`, `pin-ranks`, `retention`, `guild-totals`, `tiers`, `badges`, `guild-badges` |
| Guild badges | `guild_badge_definitions` (data; seeded from `server/guildBadges/catalog.js` SEED_GUILD_BADGES) | id, family, levelled + measure + thresholds, automatic rule or staff-granted, kept-while-held, status mark; new Deeds badges from the template on /admin/guild-badges |
| Activity kinds | `server/activity/count.js` ACTIVITY_KINDS | the event kinds the admin Activity panel counts (a kind and a number per hour, nothing else) |
| Badges | `badge_definitions` (data; seeded from `server/badges/catalog.js` SEED_BADGES) + catalog.js TEMPLATES | id, family, name, how, art, manual or automatic rule, kept-while-held; new ones from templates on /admin/badges, no deploy |
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
- `discovery_responses` keeps every raw body as evidence, but only inside the retention window: runs older than it are
  deleted with their responses (0.4.2). `discovery_statistics` is a per-run catalog;
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
  `snapshots` tablespace (~1 KB per character per day measured). The first snapshot in a week is that week's baseline,
  and the oldest snapshot still kept is the rolling baseline (`period_baselines`, period 'rolling', period_start epoch);
  `stat_gains` holds gains > 0, rebuilt per character on each fetch.
- **Boards** (`stats/boards.js`): rank = 1 + visible characters strictly above; ties share; **a zero is never ranked**
  (0.4.1: "Not ranked", and "of N" counts only those above zero: "#1 of 3 with any");
  hidden characters are on no board and in no population. Every count repeats the partial index predicate (`value > 0`,
  `NOT hidden`), or the planner can't use the index. Nothing is cached: a rank and its "of N" are counted together.
  Weekly = from Tuesday 15:00 UTC (US weekly reset); "Last N days" (0.4.2, replacing monthly; N = 29 since 0.5.0) = since the oldest kept
  snapshot, N = the retention keep-days from the API, never typed in (`stats/periods.js`). Weekly is "Collecting data"
  until snapshots began before the week did; "Last N days" until N days of snapshots exist. `scripts/measure-boards.js` measures it all
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

## Usernames and profiles (0.4.1: `server/accounts/`, `/u/{username}`)

- Every player account has ONE username: unique, stored lower case, 3–20 of a–z 0–9 `-` `_`, starting with a letter,
  no doubled or trailing separators, not starting `user-`/`user_`. New accounts get a database-default placeholder
  `user-xxxxxx` (`username_claimed` false): shown only to its owner, never publicly as a chosen name, no profile.
  **Never default a name from a BattleTag or Discord name.** The prompt shows on every sign-in until claimed ("Not now"
  lasts for that session: `sessions.username_prompt_dismissed`).
- Rules live in `accounts/names.js` (one place): the admin-editable `reserved_names` list compared after lookalike
  normalization (0→o, 1→i/l, 3→e, 4→a, 5→s, 7→t, @→a, $→s, separators dropped), blocked stems anywhere in a username
  (admin, staff, official, moderator, support, blizzard; display names: all but "support"), and `accounts/profanity.json`.
  Rejections say why in plain words and never name the entry that matched; the reserved list is sent to the admin only.
- Claim is free; a rename uses `accounts.rename_allowance` (a number, default 1). The old name is held 30 days
  (`username_holds`) and `/u/{old}` redirects. A deleted account's name is held 30 days too. Admin reclaim → fresh
  placeholder, display name cleared, prompted again, allowance untouched, name held until released; admin grant
  bypasses reserved/stem/profanity rules (not shape or uniqueness). Everything is in `username_history` + admin_events.
- Availability checks: signed in only, 60 per network AND 30 per account per 15 minutes.
- **Nothing keys on the username**: sessions, identities, passkeys, 2FA, characters, pins and beta membership all key on
  account id, so a rename or reclaim can't break them (`server/test/usernames.test.js`).
- The admin is not a player: no username, no profile; the top bar says "Admin" on /admin pages.
- Profiles are a list of SECTIONS from the API (`featured`, `characters`), drawn by `SECTION_VIEWS` in
  `client/src/pages/ProfilePage.jsx`: badges and pins are new sections, not a new page. Hidden characters never appear.

## Gear and item icons (0.4.1: `crawler/parse.js` tooltipOf, `crawler/items.js`, `components/GearSheet.jsx`)

- Tooltips show only Blizzard's own display strings from the equipment response, in the game's order; a field Blizzard
  didn't send is left out. `characters.equipment_version` (2) makes an older stored equipment re-fetch once.
- Icons: `item_media` per item id, shared by all characters, fetched in a separate 'items' crawl item at the priority of
  whatever fetched the character (the character never waits). **Blizzard's API terms require a 30-day maximum TTL on all
  API data** (Developer API Terms of Use, section 2), so a row older than 30 days is fetched again; the image is shown
  from `render.worldofwarcraft.com`, never stored. A failed icon shows our own "?" art.

## Guilds (0.5.0: `server/guilds/`, `server/stats/guildTotals.js`, `server/stats/guildBoards.js`)

- **Identity:** Blizzard addresses a Forever guild by its slug alone, region-wide (no realm, no ruleset in the path), so
  the page is `/g/{slug}` and the id is the key. Every slug a guild is seen with is kept (`guild_slugs`, Blizzard data,
  swept) so an old address redirects to the guild by id after a rename. A guild Everstats has never fetched is looked up
  once from its page (priority 1, the per-network look-up limit), like a character.
- **The crawl:** a guild item is its profile + its roster, **2 requests, once a day**, queued whenever a member is
  fetched. Rosters are read even with `crawler.rosterExpansion` off (the setting now only decides whether the roster's
  members are queued). `guild_roster` keeps ids, rank numbers and levels, **never names**.
- **Members** are the characters whose own profile names the guild now (`characters.guild_id`), tracked (statistics
  fetched, not hidden, not missing): `TRACKED_MEMBER` in guildTotals.js. Untracked roster members are counted, never
  listed. Hidden characters appear nowhere and count toward nothing; hiding one rebuilds its guild at once.
- **Guild totals** (`guild_totals`, `guild_populations`): per guild, statistic and period, the total and average of its
  members' values (overall) or gains (week, rolling). Built by the worker job `guild-totals` (dirty guilds, the week
  rolling over, or older than 6 hours), never per request, never from an extra Blizzard request.
- **Guild boards:** total (default) or average, same periods, zero never ranked, ties share. A guild page lists a
  board under "On the guild boards" only from `guilds.minBoardGuilds` (default 3) ranked guilds (0.6.0). A guild is ranked only with
  `guilds.minMembers` (admin setting, default 5) counted members; below that it is "Not ranked yet: needs N tracked
  members". `scripts/measure-guilds.js` measures it all at 10,000 characters in 500 guilds.
- **Guild rank names:** Blizzard sends a number only. 0 is "Guild Master", the rest "Rank N". Never invent names.

## Tiers (0.6.0: `server/tiers/`, `server/stats/tiers.js`, `components/TierBreakdown.jsx`, `/tiers`, `/tiers/how`, `/admin/tiers`)

- **What counts comes from the owner's Discovery DECISIONS, read live, never a suggestion** (`tiers/counting.js`): a
  statistic counts only with an approved category AND an approved "counts toward" ('overall' | 'category'); approved
  'none' = bad (or name + number), an approved duplicate is graded through the one it duplicates, and anything else
  (no decision, rejected, a pairing still undecided) is `undecided` and counts as nothing. A counted statistic feeds
  the overall tier only with 'overall' AND a non-farmable category (farmable = `CATEGORY_RULES` `farmable`). Pages say
  "counts toward the overall tier" from `Stat.tierRole` / `countsOverall` (catalog.js), never from `grading`.
- **The maths** (`tiers/engine.js`, pure): mid-rank percentile per counted statistic among the ruleset's tier-eligible
  characters (missing = 0); category score = average percentile; overall score = average over EVERY overall category of
  its overall-counting part, each category equal (an unlettered category still counts its score); letters from the
  score's place among everyone's (rank = 1 + strictly above, ties share), shares `tiers.shares` (default 5/15/30/30/20).
  Minimums: ruleset `grading.minPopulation` (50), category `tiers.categoryHalf` % of its counted stats above 0 (50),
  overall `tiers.overallHalf` % of overall categories with a letter (50). Every Unranked carries its reason in words
  (`tiers/view.js` REASONS). Tier-eligible = level 10+, fetched, not hidden, not missing (`ELIGIBLE`).
- **Full vs one character** (`tiers/store.js`): the worker job `tiers` grades every ruleset at once (writes
  `character_tiers`, `character_category_tiers`, `tier_rulesets` with each scope's cutoffs and the plan/settings
  used) when a decision or tier setting asked for it (`tier_runs` pending row, debounced 30 s: a burst = one grading),
  after the daily refresh drains, when a ruleset crosses the minimum, and every 6 h. A fetch grades that one
  character (`gradeCharacter`): live percentiles, the ruleset's last plan + settings, placed against the stored
  cutoffs; nobody else moves until the next full grading. Measured (`scripts/measure-tiers.js`, PGlite, 10,000
  characters, 100 counted stats): full 2.5 s, one character 0.18 s, preview 0.7 s.
- Tier tables are Blizzard-derived (registry BLIZZARD, swept by `computed_at`; purged/missing/hidden characters lose
  their rows at once); `tier_runs` is ours. Admin: `/admin/tiers` (settings with a preview that must run before
  Save, What counts with links to `/admin/discovery?stat=ID`, gradings). `server/tools/tiers-report.js` prints what
  counts and the letters on the server.

## Badges (0.7.0: `server/badges/`, `client/src/badges/`, `/badges/{id}`, Settings → Badges, `/admin/badges`)

- **Design: `design/v2-badges/`** (additive to v1, its files link into `../v1/`). Tokens are appended VERBATIM to
  `theme/tokens.css` (a second set of theme blocks; the colour test checks every block); the component CSS is
  `theme/badges.css`, VERBATIM (override in app.css); the SVGs are copied VERBATIM to `client/src/badges/art/`.
  The SVGs colour themselves with `style="--bf:…"` attributes, which the CSP forbids, so `badges/art.jsx` parses each
  file once and draws it as React elements (styles via the CSSOM). The export's template files open with a comment
  containing `--` (not well-formed XML): comments are stripped before parsing. Letters in badges use the self-hosted
  Cinzel; an SVG ever served standalone must have its text converted to outlines.
- **Cosmetic only.** No badge grants anything; Dev Team is not the admin.
- Definitions are DATA (`badge_definitions`, seeded once by migration 015); awards are `badge_awards`, one row per
  (account, badge): when, how (automatic, or admin with a reason), and the Blizzard id of the character that earned a
  class/faction badge, never a Blizzard value. **Revoking is a state with a reason, never a delete**; every grant, earn,
  revoke, removal, mark change and the back-fill is in `badge_events` (append-only).
- **Rules** (`badges/rules.js`, from stored data only): beta member; Early Supporter (admin setting
  `badges.earlySupporter`; unset → the badge shows nowhere); faction / Envoy / class / Every Calling from OWNED level 10+
  characters, hidden ones included; Guild Master = owns a rank-0 roster character; S-Tier = an owned visible character
  with an overall S. **Everything stays once earned except S-Tier (kept while held).** Every Calling needs every class a
  class badge names AND every class Blizzard has returned on a stored character (so a new class just needs a badge from
  the class template). Evaluated after a sign-in's character import (and on every OAuth sign-in), after any fetch of an
  owned character, after a roster for its rank-0 owner, after every full tier grading (S-Tier), every 6 h, and once on
  deploy without toasts (the back-fill, counts on /admin/badges).
- **Display** (the player's): `shown` (public; off = private everywhere), `featured` (the profile row, max 6, staff and
  partner always first, even granted into a full row), `pinned` (the ONE inline badge; else first featured, else first
  public, else none). Names always visible: pills (badge + name) on the profile, All badges and Settings; the 18px inline
  badge shows its name on hover, focus and tap. **No inline badges on leaderboards**: header, "Claimed by", guild rosters.
- **Partner marks** (`badges/marks.js`): PNG/WebP only, decided by magic bytes AND the decoder, never SVG; ≤ 2 MB,
  ≤ 4096² decoded, ≥ 256 a side; re-encoded by sharp to a 256² PNG with no metadata. Upload needs the written-permission
  box, Save needs a reason and "I've checked the preview". A Pro Team Partner badge can't be granted before its mark.

## Guild page management (0.7.0: `server/guilds/manage.js`, `server/guilds/links.js`, `pages/GuildManage.jsx`)

- **Guild Master** = the account owning the rank-0 character on the stored roster (ownership as proven by a Battle.net
  sign-in), computed LIVE on every request. No roster (aged out) or no single rank 0 or an unclaimed GM character →
  nobody can edit, officers included. `guild_pages.gm_*` only RECORDS who it was, to log handovers (`guild_events`).
- **Officers** (`guild_editors`): added by the GM by @username, only accounts with a tracked, visible character in the
  guild; access re-checked every request (leaving the guild ends it); they stay across a handover until the new GM
  removes them. Editors change only our fields: description (280, plain), Discord invite CODE, ≤ 5 labelled links.
- **Links are the only free URLs on Everstats**: https, a real domain (no IPs, no single-label/local hosts), no
  user:pass, no port, not a shortener (`shorteners.json`), not on the admin blocklist (`link_blocklist`; subdomains
  match). Shown with label + domain, behind a "You're leaving Everstats for {domain}" notice, `noopener noreferrer
  nofollow`, each with "Report this link" (anyone, 10 per 15 min per network) → `/admin/guild-links`.
- These tables key on Blizzard's guild id WITHOUT a foreign key: a `guilds` row ages out; our data about it must not.

## Guild badges (0.7.1: `server/guildBadges/`, `client/src/guildBadges/`, `/guild-badges`, `/g/{slug}/manage/badges`, `/admin/guild-badges`)

- **Design: `design/v2-guild-badges/`** (additive to v1 and v2-badges; the Hanging Standard frame). Tokens appended VERBATIM to
  `theme/tokens.css`, component CSS VERBATIM in `theme/guild-badges.css`, SVGs VERBATIM in `client/src/guildBadges/art/`
  (drawn by `guildBadges/art.jsx` like the player badges). Owner-accepted: the names, levels I–V, thresholds as defaults,
  Verified as a status mark (never a slot), and the design's "Added beyond the brief". The design's "SVG preferred" for
  emblems, native `<select>`s and the Admin nav link are NOT built (rules win).
- **Nobody awards a guild badge to their own guild.** Automatic ones follow `rules.js` from stored data; Featured and
  Partner are staff grants (reason, logged; Partner needs a saved emblem: PNG/WebP via `badges/marks.js`). GM and officers
  (`guildRole`, 0.7.0) only choose shown / order / pin; no GM → automatic defaults (family order, highest level first).
- Roster/Deeds from CURRENT tracked members (TRACKED_MEMBER); **levels only go up** (raising a threshold removes nothing).
  Deeds statistics are matched BY NAME. Standing is kept while held: Board Champion/Top Ten only on boards with
  `guilds.minBoardGuilds` ranked guilds, Top Ten also needs more than 10; Weekly Champion uses the current week. Founding =
  first tracked inside a beta window; Early = inside `guildBadges.earlyWindow` (unset → listed nowhere).
- **Progress is never stored**: read live from guild_totals / members (Blizzard-derived, follows the window); "not measured
  yet" is null, never 0. Awards hold levels, dates and board ids only. Back-fill once (pipeline_facts), no toasts or ribbons.
- Toasts only for the GM and officers (`guild_badge_toast_seen`); the 7-day "Unlocked" ribbon for everyone. The Copy sign-up
  link is the guild page's own address: **never add a tracking or referral parameter**.

## Feedback, render controls, Activity (0.7.1)

- **Feedback** (`server/feedback/routes.js`, `client/src/feedback/`, `/feedback`, `/settings/feedback`, `/admin/feedback`): plain
  text only, rendered as text (pre-wrap), links never clickable, bidi overrides stripped, 10–4,000 characters, honeypot
  field `website` (answered "sent", stored nowhere), 5/15 min per network AND 10/hour per account, no CAPTCHA, NOT
  profanity-filtered (owner's choice). Replies show as from "Everstats". Signed-out drafts live in localStorage until sent;
  sign-in returns to `/feedback?restore=1`. Logs never contain a message.
- **Render controls**: `character_render_hidden` (ours). A hidden render sends no render/avatar URL to anyone (owner
  included); the frame says "Render hidden by its owner". "Report a wrong render" opens the feedback form pre-filled. Never
  detect wrong renders automatically.
- **Activity** (`server/activity/`, top of /admin): `activity_counts` (hour, kind, n) ONLY. No IP, user agent, visitor id or
  third-party analytics, ever. Not counted from a network the look-up limiter is refusing. Searches count from 0.7.1's
  deploy (`activity_counting_since`); earlier is "unknown", never 0. The "last checked" marker moves only on "Mark as checked".
- There is no account dropdown menu: the account button opens Settings (or Your feedback when a reply is unread).

## The beta (`server/beta.js`, `chrome/BetaBanner.jsx`, `/beta`)

- A window (`beta_windows`), opened by migration 009 and closed/reopened only from the admin page. While open: the header
  badge, the dismissible banner (localStorage, wrapped; keyed by the window's opening date), and /beta's "open"
  version; closed, /beta thanks everyone and still lists the perks (admin setting `beta.perks`).
- **Membership is permanent and decided only by the window**: a database trigger sets `accounts.beta_member` /
  `beta_since` at INSERT from the window open at that moment; another refuses any later change except a merge giving
  the kept account an EARLIER real membership (`account/merge.js`, `everstats.merging`). Never back-fill it, never
  edit it. Accounts from before 0.4.0 are not members.
- **One exception, the owner's decision (0.7.1):** the admin's "Grant beta membership" (`POST /api/admin/badges/accounts/:id/beta`,
  reason required, logged in admin_events + account_events) turns a NON-member into a member, only for an account created
  before the window closed, inside a transaction that sets `everstats.granting_beta` (migration 016's guard). It never
  opens, extends or edits a window. No other code path may write membership.
- Beta Tester for an account made before the window opened says "Only for accounts created while the beta is open (since
  {start}). This account was made before the beta opened." while the beta is open; "No longer available" only once closed.

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
- **Retention: Blizzard data 30 days at most; our own data is kept.** See "Retention" below for Blizzard data. For
  Everstats' own data (accounts, settings, decisions, history of what WE did), any deletion must be named here, with its
  reason. The exceptions:
  - **Expired sessions, auth flows, admin sessions and old admin invites** are deleted hourly (`sweepExpired` in
    `server/app.js`). Reason: they are credentials, not history; keeping dead ones only adds risk.
  - **A merged account's row is deleted** after its data moves (`server/account/merge.js`). Reason: the person asked
    for exactly that; its history lives on as the target's `account.merged_in` event.
  - **Unlinking a provider or removing a passkey deletes that row.** Reason: the person asked to remove a way in.
  - **Turning 2FA off deletes the secret and recovery codes.** Reason: a stale secret is a liability.
  - **Finished crawl-queue items** (`crawl_queue`) are deleted an hour after they finish. Reason: they are work orders;
    what they fetched lives in the character tables, and request counts in `crawler_hours` (kept forever).
  - **A partner mark is replaced** when the admin saves a new one (the old bytes are overwritten; `badge_events` keeps
    that it changed), and an unsaved upload is discarded on Cancel. Reason: only the mark in use is kept, by design.
  - **Removing a domain from the guild-link blocklist** deletes that row. Reason: the admin asked; `admin_events` logs it.
  - **Showing a hidden render again** deletes its `character_render_hidden` row (0.7.1). Reason: the owner asked; the
    account's history logs it.
  - **The owner deleting a feedback thread** (`DELETE /api/admin/feedback/:id`) deletes it with its messages and notes
    (0.7.1). Reason: feedback is kept until the owner deletes it (the privacy page says so); `admin_events` logs it.
  - **Deleting an account** (Settings, `DELETE /api/account`) deletes the account row and everything that cascades from
    it (sign-in links, passkeys, 2FA, recovery codes, sessions, flows, pins, events, character checks; 0.7.0: badge
    awards and guild officer roles; 0.7.1: feedback threads and their replies, guild badge toast marks; `badge_events` and `guild_events` keep the bare account id). Reason: the
    person asked. Its characters stay (public data); ownership is cleared, a hidden one stays hidden.
  - **Username holds expire** (`username_holds.held_until`): the row stays as history; an expired hold simply stops
    counting. Not a deletion, listed here because a held name becomes claimable again by design.
  - **Discovery Battle.net tokens** (`discovery_grants`) are deleted when they expire (hourly sweep), when the admin
    forgets one, or when a new authorization replaces it. Reason: a credential, not history.
  - **Nightly backups: the newest 14 plus the first of each month are kept; older ones are deleted** (0.5.0,
    `server/core/backup.js` planPrune; the hourly sweep and every good backup). Reason: they hold only our own data now,
    and a bounded set is enough to recover from. **A pre-0.5.0 dump (`everstats-YYYY-MM-DD.dump`) holds Blizzard data
    and is deleted 3 days after it was taken** (30-day rule). The `backup_runs` log is kept.
  - **Every Blizzard-sourced row past the retention window** (next section).
- Every time-series table has a composite index on `(parent_id, timestamp)`.
- **Every query takes limit/cursor. No unbounded selects, ever** (`pageLimit()` in `server/core/db.js`).
- Migrations: `server/core/schema.js` (`{ id, up(q) }`, run under an advisory lock by both processes). Never edit or
  reorder one that has shipped. Blizzard-shaped tables (007+) follow what the discovery runs stored, never memory.
- `pg` turns a JS array parameter into a Postgres array: for `jsonb` pass `JSON.stringify(value)`.
- **Backups hold ONLY Everstats' own data** (0.5.0, `server/core/backup.js`, the worker job `backup`; `RESTORE.md`).
  Every table the retention registry calls Blizzard data is dumped schema-only (`--exclude-table-data`); the three
  mixed tables' own parts go in a `backup_stubs` schema written just before the dump and dropped after (character stubs:
  id, owner, hidden, tracked since; statistic ids; Discovery decisions with the reasoning blanked), plus
  `backup_stubs.restore()`, which a restore runs between the data and post-data sections (no primary keys exist yet
  then: never `ON CONFLICT` in it). A dump whose `pg_restore --list` shows any Blizzard table data is refused. Every
  night after 04:00 UTC (at once after a missed night) the worker runs `pg_dump --format=custom` into `BACKUP_DIR`
  (`/backups` in the worker container), reads the whole archive back with `pg_restore` before keeping it as
  `everstats-ours-YYYY-MM-DD.dump`, and records each run in `backup_runs` (admin page and worker `/api/health` read it). The
  dump runs in the background so the heartbeat never stalls; one at a time (PID lock file). A failure logs
  `[backup] FAILED`, keeps every earlier dump and retries after an hour. By hand:
  `docker exec everstats-worker node server/tools/backup.js now | list | verify <file>`. The image carries
  `postgresql-client-17` (from apt.postgresql.org; it must match the server's major). Production workers refuse to
  start without `BACKUP_DIR`. A dump does not contain the root key: a restore needs the same `.env`.

## Retention: Blizzard's 30-day rule (0.4.2: `server/retention/`)

- Blizzard Developer API Terms of Use, section 2: "a maximum 30-day TTL (time-to-live) policy for all Data". Blizzard's
  forum FAQ: stay close to 30 days; anonymising is not an accepted alternative. **Everstats complies.**
- ONE setting, `retention.window` (default 30). Above 30 only with a note recording Blizzard's written permission
  (logged). `policy.js`: keep = window − 1 (slack for a late sweep) = **29 days** in the database (0.5.0: backups hold
  no Blizzard data, so they no longer take 3 days of the window); worst case ≈ 29 days 1 hour anywhere. "Last N days"
  boards and the privacy page follow keep-days. **Never put Blizzard data in a backup**: a new Blizzard table goes in
  registry.js BLIZZARD, and that alone keeps it out of the dump.
- `registry.js` classifies EVERY table: Blizzard data (with its fetched-at column and a sweep) or ours (with a reason).
  `server/test/retention.test.js` fails on a table in neither list: **a new table must be classified there.**
- The sweep (`sweep.js`) runs hourly in the web app AND the worker (advisory lock: one at a time); the worker also
  prunes backups. A character Blizzard hasn't returned for the window is stripped to a stub of our data (id, owner,
  hidden, tracked since: `profile_state 'purged'`) and leaves lists until a sign-in finds it again. A character that
  404s after being fetched is "missing": off every board at once, its page says "Blizzard hasn't returned this character
  since {date}", never its old values. Statistic names age out too (name NULL → "no longer available", never invented).
- Characters are fully refetched at least every 7 days (`FULL_REFRESH_DAYS`) even when unchanged, so live data never
  ages out; icons are refetched past 30 days on the next fetch that needs them.
- Logs hold no Blizzard values (ids and HTTP statuses only). Discovery exports downloaded by the owner are copies of
  Blizzard data: delete them within 30 days (the Discovery page says so).

## Profiles (0.4.2 additions)

- Bio (280, plain text, profanity-checked, never linkified), social HANDLES (`server/accounts/socials.json`: platform
  list, handle patterns, URL templates; links are built by us, opened with rel="noopener noreferrer nofollow"; nothing
  marked verified), "Show my pinned stats" (default on). Icons: text labels only; no brand assets are shipped.
- Sections sent only when non-empty: about, pins, featured, characters, guilds (from non-hidden characters only).

## Hosting and networking

- **Treat this repo as public.** Never commit the server's hostname, addresses, paths, network ranges, tunnel name
  or internal URLs. They live in Gitea Actions variables and the owner's private ops notes.
- One deploy folder (Gitea variable `DEPLOY_DIR`). Three containers: `everstats-db` (no published port),
  `everstats` (web, port **3260**), `everstats-worker` (worker, port **3261**). The ports are written once in
  `server/core/config.js` (`DEFAULT_WEB_PORT`, `DEFAULT_WORKER_PORT`) and must agree with the Dockerfile, compose and
  the deploy (`server/test/compose-guard.test.js`); `WEB_PORT` / `WORKER_PORT` override the host side.
- **The compose network has a fixed /24** (`EVERSTATS_SUBNET_PREFIX`, default `10.213.47`): its gateway `<prefix>.1` is
  where cloudflared's connections arrive from, so `TRUSTED_PROXIES=<prefix>.1`. The web app warns at start-up and on
  the admin page when TRUSTED_PROXIES is set but none of it is inside its own network. Changing the prefix needs a
  `docker compose down` first (the network is recreated).
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
- **Anything rendered outside `.es` doesn't get the site font** (found here, 0.7.0): the toast stack sat outside the
  shell's wrapper and showed in the browser's default font for months. 0.7.0 only gave the stack a font-family, which
  left its buttons, links and numbers on browser defaults; 0.7.1 moved the ToastProvider INSIDE `.es`. Render stacks and
  portals inside `.es`, or give them every base rule, not just the font.
- **An absolutely positioned `.sr-only` inside a scrolling box escapes it** unless the box is positioned (found here,
  0.7.0: a hidden table header widened /admin/guild-links to 831px at phone width). `.tblbox` is `position: relative`.
- **"Open on keyboard focus" must mean a Tab press**, not `:focus-visible` alone: a dialog focusing its first control
  opened a popover over itself (0.7.0, `badges/Badges.jsx`).
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

Newest first; omit sections that don't apply. **`date` is the day the release is committed, never ahead:** `check-changelog.js` refuses a date later than
today (today = the latest calendar date anywhere, UTC+14, so a same-day release never fails in any time zone).

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
  The profile has id, name, slug, faction, ruleset, member_count, created_timestamp (achievement_points was 0 in both
  samples); `/activity` and `/achievements` answer 200 with nothing in them. Roster `rank` is a NUMBER (0–3 seen),
  with no rank names anywhere; class and race on the roster are ids only.
- Still open: whether surnames can hold hyphens (slugs use `-` as the separator; `server/stats/slug.js` refuses them).
