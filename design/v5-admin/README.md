# Everstats — v5 admin (additive to v1 … v4-collections)

This redesigns Admin from the ground up. It's a tool, not a page: dense, calm and fast to scan.

- **Layout:** one shell with a left sidebar and one top bar.
- **URLs:** every section and tab has its own address.
- **Refresh:** one refresh system, used the same way on every page.

It uses the same tokens, type and components as the public site. Forever is the main theme; Alliance and Horde are proven on the Dashboard.

Keep this folder next to `v1/`, `v2-badges/`, `v2-guild-badges/`, `v3-share-cards/` and `v4-collections/`. The mockups link into them.

---

## Navigation (sidebar)

| Group | Item | URL | Count badge |
|---|---|---|---|
| — | **Dashboard** (landing page after admin sign-in) | `/admin` | — |
| Moderation | **Inbox** (Feedback · Reports tabs) | `/admin/inbox/feedback`, `/admin/inbox/reports` | unread feedback + open reports (accent) |
| Moderation | **Directory** (Accounts · Characters · Guilds) | `/admin/directory/accounts`, `…/accounts/{id}`, `…/accounts/reserved`, `…/characters`, `…/guilds`, `…/guilds/{id}/links`, `…/guilds/links` | — |
| Moderation | **Badges** (Player · Guild tabs) | `/admin/badges/player`, `/admin/badges/guild` | — |
| Game data | **Tiers** | `/admin/tiers?v=forever&r=us` | — |
| Game data | **Discovery** (Approvals · Runs · Endpoint probe) | `/admin/discovery/approvals` … | pending approvals (quiet grey) |
| Game data | **Data** (Crawler · Collections & catalogs · Backups) | `/admin/data/crawler` … | stuck/failed jobs (warning) |
| Game data | **Data retention** | `/admin/retention` | retention outside its window (danger) |
| Site | **Features** | `/admin/features` | — |
| Site | **Settings** | `/admin/settings#crawler` | — |
| Site | **Audit log** | `/admin/audit` | — |
| bottom | **Sign out of admin** — admin is a separate, passkey-only identity | | |

**Count badge styles:**

| Style | Meaning |
|---|---|
| Accent | Something waits for a reply |
| Grey (quiet) | Pending, not urgent |
| Warning | Needs attention |
| Danger | Failing |

**Collapsed sidebar:** icons only, with the badge in the corner.

**Phone:** the sidebar becomes a slide-in menu.

**Query string:** the version and region switcher writes `?v=&r=` to the URL. Global sections ignore it.

## Top bar

- **Version + region switcher.** WoW Forever · US by default.
  - Turned-off versions and regions are listed as "Off · admin only".
  - Global sections (Inbox, Accounts, Badges, Features, Settings, Audit log, Backups) show a dashed "All versions" pill instead.
- **Settings search** (`/` focuses it). It searches settings, feature switches and the audit log.
  - Each result shows its path ("Settings › Crawler") and current value.
  - Enter jumps to the result and highlights the row.
- **One refresh control:**
  - stamp ("Updated 12 s ago")
  - Refresh button (its icon spins while fetching)
  - auto-refresh: off / 30 s / 1 min / 5 min, remembered per admin
  - a thin progress line under the top bar while fetching

## The refresh system (same on every page)

| State | Top bar | Each panel |
|---|---|---|
| Idle | "Updated 12 s ago" | "Updated 12 s ago" in its header |
| Refreshing | spinning icon, "Refreshing…", progress line | progress line along the top, content dimmed to `--es-adm-loading-opacity`, header says "Updating…", **layout never moves** |
| Partly failed | "Updated 4 s ago · 1 panel failed" (warning colour) | the failed panel gets a red edge and an inline error with Retry, keeping its height. Never blank. Other panels stay live. |
| Stale | "Stale · last good 6 min ago" (warning) | warning edge plus a "Stale · 6 min old" chip; the data stays visible |

**Panels with their own refresh:** only panels that genuinely run on their own clock (Worker jobs: "Live · own 5 s clock") refresh themselves. No other panel has a refresh button.

---

## Where everything that exists today now lives

| Today | New home |
|---|---|
| Activity counts, "Mark as checked", searches by kind, characters by arrival, faction split, ruleset populations, 14-day charts | **Dashboard** — period control, Mark as checked, and the cards: Player data, Searches & traffic, Characters & guilds, Faction, Ruleset |
| Accounts list, detail, moderation (warn, force rename, reset fields, temp ban, ban, unban), history, reveal BattleTag/Discord | **Directory › Accounts** and the account detail |
| Reserved usernames | **Directory › Accounts › Reserved usernames** |
| Feedback threads, appeals | **Inbox › Feedback**; appeals are a filter |
| Reports queue (profiles, guild descriptions, guild links; open / actioned / dismissed) | **Inbox › Reports**, grouped by target |
| Player badges, guild badges | **Badges** (two tabs) |
| Guild links and their reports | **Directory › Guilds › {guild} › Links**, plus the "Guild links" view on the Guilds tab |
| Tiers (shares, minimums, sqrt weights + override, preview; group decisions in 0.10.0) | **Tiers** (per version) |
| Discovery runs, endpoint probe, statistic approvals, exports | **Discovery** |
| Crawler status, requests, queue, last error, Worker jobs | **Data › Crawler** |
| Crawler settings (budget, concurrency, cooldown, pin limit, backfill per day, version shares) | **Settings › Crawler limits** and **Version budget shares** |
| Crawler pause, seed from rosters, backfill on/off | **Features** (switches) |
| Collections refresh cost, catalog builds, Legacy Points wording, account-wide detection | **Data › Collections & catalogs** |
| Data retention | **Data retention** (its own page); max-age is edited in Settings |
| Backups | **Data › Backups** |
| Beta (open/closed, perks) | **Features › Beta** (perks are the feature's own settings) |
| Character renders on/off and the off note | **Features › Character renders** |
| Share card renderer status, render times, cache size | **Data › Crawler › Share card renderer** panel; the on/off switch is in **Features** |
| Gold (counts only) | **Dashboard › Player data** and **Features › Gold opt-in**; account detail says "Private · admin sees counts only" |
| API keys | **Settings › API keys** — Set / Not set, source and date; Test, Replace, Remove. Values are never shown. |
| Proxy addresses | **Settings › Proxy addresses**, with the connections seen |
| Grading thresholds (guild members, ranked guilds per board) | **Settings › Grading** |
| Sign out of admin | Bottom of the sidebar |

---

## Screens (`pages/`)

Forever, 1440 and 390. The Dashboard is also shot in Alliance and Horde.

| Folder | Screen |
|---|---|
| `dashboard/` | "Needs you" strip with 5 items, period control, all 11 cards |
| `dashboard-clear/` | "All clear" state of the strip |
| `dashboard-edit/` | Reordering: Faction card lifted, drop slot, hidden-cards tray |
| `inbox-feedback/` | Thread list plus an open appeal thread with linked moderation and the reply composer (phone shows the thread with "← All feedback") |
| `inbox-reports/` | Reports grouped by target (profile, guild description, guild link) |
| `directory-accounts/` | Accounts list and filters |
| `account-detail/` | Moderation bar, identity with Reveal, claimed characters, badges, history |
| `directory-characters/` | Characters tab |
| `directory-guilds/` | Guilds tab |
| `guild-links/` | A guild's Links subpage |
| `reserved-usernames/` | Reserved usernames |
| `badges/` | Player badges tab |
| `badges-guild/` | Guild badges tab |
| `tiers/` | Save bar, letter shares, minimums, group decisions with suggestions and exceptions, category weights, preview |
| `discovery/` | Approvals, runs and the endpoint probe per version |
| `data-crawler/` | Crawler |
| `data-collections/` | Collections and catalogs |
| `data-backups/` | Backups |
| `retention/` | Rule, status, per-kind expiry table with timelines, sweep history (failure highlighted), non-Blizzard data |
| `features/` | All switches, grouped |
| `features-confirm/` | Turning off Share cards: dependents listed, reason required |
| `settings/` | Settings, grouped with defaults |
| `settings-search/` | Search open for "cooldown", target row highlighted |
| `audit-log/` | Audit log |

## States (`states/`)

| Group | Folders |
|---|---|
| Refresh | `refresh-idle/`, `refresh-busy/`, `refresh-partial/`, `refresh-stale/` (on Data › Crawler) |
| Empty | `inbox-empty/`, `directory-empty/` (no matches), `retention-empty/` (a version that's off) |
| Error | `inbox-error/`, `directory-error/`, `retention-error/` (outside the window + panel failed) |
| Dialog | `confirm-ban/` (temp ban with length and a reason shown to the player) |
| Shell | `shell-collapsed/`, `shell-phone-menu/`, `version-switcher/` |

---

## Components (`components/`, reuse these)

`admin.css` contains only `var(--es-*)` values. The gallery is `gallery/components.html`, with a screenshot per theme. There is one `.md` per component:

| Component | File |
|---|---|
| Shell — sidebar, top bar, content | `shell.md` |
| Nav item with count | `nav-item.md` |
| Version + region switcher | `version-switcher.md` |
| Refresh control and panel states | `refresh-control.md` |
| Status chip | `status-chip.md` |
| Tab switcher (v1 `.tabs`, URL per tab) | `tab-switcher.md` |
| Needs-you strip | `needs-you.md` |
| Dashboard card and grid | `dashboard-card.md` |
| Data table | `data-table.md` |
| Setting row | `setting-row.md` |
| Feature card | `feature-card.md` |
| Confirm dialog | `confirm-dialog.md` |

**Reused from v1:**

- tokens, type, `.btn`, `.seg`, `.tabs`, `.search`, `select.inp`, `.toggle`, `.check`, `.panel`, `.sheet` dialogs, `.note`, `.bar`, `.fresh`, `.tier`, `.av`, `.orn`, `.kpi` pattern, icons, emblem mark

**Reused from v2:** the badge SVGs (player and guild) in Badges and Directory.

**New tokens:** `tokens/admin.css`, `admin-tokens.json`:

- `--es-adm-sidebar-w`, `-topbar-h`, `-content-max`, `-card-basis(-wide)`, `-setting-label-w`, `-dialog-w` …
- roles: `--es-adm-nav-active`, `-count-bg`, `-progress`, `-stale-edge`, `-error-edge`, `-drop`, `-player-visible`, `-loading-opacity`

---

## Rules applied

- **Status is never colour alone.** Every chip has an icon and text. Failed table rows also get a left edge.
- **Secrets are never shown.** API keys show Set/Not set, source and date only. Reveal shows a redacted value until the admin gives a reason; the reveal is logged but the value isn't.
- **Never shown or stored:** character position, `bind_position`, `wow_account`. The Characters tab says so.
- **Every destructive or visitor-affecting action asks for confirmation and a reason** — ban, temp ban, rename, reset, remove link, hide description, close beta, feature off, remove key, save-and-regrade. All are audit-logged.
- **Tables:** sticky headers under the top bar. No horizontal scrolling on desktop. On phones each row becomes a card with labels.
- **Data:** only fictional data (`@example_player_14`, Placeholder Realm, Example Guild 03). Documentation IP ranges only.

## Decisions

- **Dashboard grid.** A flex-wrap grid with grow, so every row fills edge to edge. A card that lands alone stretches across its row.
  - Wide cards (Player data, Searches & traffic, Features) take two columns' worth.
  - Layout and hidden cards are saved per admin, using the same live-drag component as the player dashboard.
  - "Reset layout" restores the default order.
- **The period control applies to every card and to the "Since last check" footers.** "Mark as checked" resets them.
- **Moderation actions live on the account.** Reports and appeals link there, so history stays in one place.
- **Appeal threads show the linked ban.** A reply can lift it in the same step.
- **Tier changes save to a sticky "unsaved changes" bar.** "Save and regrade" asks for a reason. Suggestions are never applied automatically.
- **The game-version switches live in Features.** The version switcher only changes what you're looking at.

## Added beyond the brief

- Settings search also covers the audit log.
- Nav count badges come in four strengths.
- A hidden-cards tray on the dashboard.
- Links between reports, appeals and the account's moderation history.
- A "Kept because" column in backup history.
- An "Expires when" bar per kind on Data retention.
- An endpoint probe matrix across game versions.
- Phone thread view with a back link.

## Left out, or only partly delivered

- **Discovery's Runs and Endpoint probe tabs** appear as panels on the Approvals tab, not as separate pages.
- **Static mockups.** Dragging, auto-refresh and the menus are shown in fixed states, not animated.
- **Alliance and Horde** are shown on the Dashboard and the components gallery only; every page uses the same tokens.
