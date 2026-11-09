# Everstats — v4 collections (additive to v1, v2-badges, v2-guild-badges, v3-share-cards)

Collections show what a character has collected: mounts, pets, toys, heirlooms, titles, achievements, reputations, professions, quests, dungeon and raid progress, PvP, and transmog appearances.

Every collection **count** is a statistic. It can be pinned to the profile, it has a leaderboard, and it can go on a share card.

The **transmog tracker** is the centrepiece. It shows what you have, what you're missing, and where a missing appearance drops.

Keep this folder next to `v1/`, `v2-badges/`, `v2-guild-badges/` and `v3-share-cards/`. Mockups link into all four.

---

## Screens (`pages/`)

| Folder | Screen |
|---|---|
| `collections-tab/` | **Collections tab** on the character page, next to "Statistics & gear". It has a summary row of 11 counts (each pinnable, linked to its board, with the account-wide marker where it applies), then one collapsible section per collection. Sections are collapsed by default; the mockup shows Mounts opened. |
| `transmog/` | **Transmog tracker**, with the catalog module: slot picker, completion per slot and overall, collected and missing tiles, filters, a detail pane with the item(s) and the source line, and the transmog currently worn |
| `transmog-collected-only/` | Transmog tracker **without** the catalog: collected tiles only, counts with no denominators, and a calm note |
| `mounts/` | Grid with search, sort, filter (All / Collected / Missing) and a completion bar |
| `pets/` | Grid with level and quality, a detail pane with pet stats, and a **hunter pets** section (hunters only) |
| `toys-heirlooms/` | Two grids side by side |
| `titles/` | List, with the active title highlighted. "Not earned" rows appear only with the catalog. |
| `achievements/` | Categories, then in progress (criteria bars), then recently earned (Blizzard dates). No points by default. |
| `reputations/` | "Exalted with N", a standing-bar key, and factions grouped by region |
| `professions/` | Primary and secondary, with skill bars |
| `dungeons-raids/` | One card per instance: boss kills with counts and an instance completion bar |
| `quests/` | Counts, in-progress list, and a server-searched, paged completed list (it can hold 1,000+) |
| `pvp/` | The PvP summary fields Blizzard returns |
| `collection-boards/` | Leaderboards index section for collection counts |
| `collection-board/` | A single collection board (Mounts collected), with the account-wide note and "same account" labels |
| `share-card/` | Card maker for the **Collections** share card, showing all 3 formats |
| `housing-legacy/` | The optional **Housing** and **Legacy** panels, styled as further sections |

Every screen is screenshotted in Forever, Alliance and Horde, at 1440 and 390.

## States (`states/`)

| Folder | What it shows |
|---|---|
| `loading/` | Skeleton counts and tiles, plus the status line "Loading collections from Blizzard…" |
| `never-fetched/` | "Collections load on the next refresh", with Refresh now; the counts show "—" |
| `empty/` | "No mounts yet" — honest and zero, with the date of the last check |
| `partial/` | Some collections still refreshing. Their sections show "From [Date] · refreshing". |
| `account-wide/` | What "Shared across this account" means and how it was detected |
| `module-unavailable/` | Catalog unavailable: the Missing filter is disabled and the screen shows collected items only, with a note |
| `not-returned/` | "Blizzard didn't return this" for one collection, with retry, the last good snapshot and the error code |

---

## Optional modules — only if the data exists

An API probe runs before the build. Any module it doesn't find is **removed entirely**: its section, its count card, its board, its filters, and every "of N" or percentage. No "coming soon" placeholders.

In the mockups these modules carry a dashed `.anno` tag ("◇ Optional module · only if the data exists"). The tag is a design annotation and never ships.

| Module | Data it needs | Where it shows | Without it |
|---|---|---|---|
| **Missing catalogs** | full lists of every mount, pet, toy, heirloom, title, achievement and appearance (per slot, with armour type and quality) | Missing tiles, the "Missing" filter, "N / total" and %, completion bars, "Not earned" titles, the transmog % on the share card | Collected only, plain counts, the "Collected only" note (`transmog-collected-only/`, `states/module-unavailable/`) |
| **Sources** | for raid and dungeon loot, boss + instance per item | Source line "Drops from {boss} in {instance} · Raid", plus the Source filter (Raid / Dungeon / Other) | Every item gets the "View item on Wowhead" text link; the Source filter is hidden |
| **Housing** | decor collected, house summary | Housing section and count card | Removed |
| **Legacy** | Forever account progression | Legacy section | Removed |
| **Achievement points** | non-zero points from Forever | A points total next to the count | Counts only (the default — points are 0 so far) |
| **"First seen by Everstats"** | Everstats' own snapshot history | Optional line in the tile detail; "Recently first seen" sort | Not shown; sorts are name and quality |

**Wowhead:** the only third-party element. It's a plain text link, "View item on Wowhead", with the external-link icon. There's no logo and no tooltip script.

## Data used (confirmed Blizzard API, WoW Forever)

| Area | Data and how it's used |
|---|---|
| Mounts, toys, heirlooms | Lists of names and IDs. Icon = Blizzard media image in a v1 quality-bordered slot. |
| Pets | Species, level, quality, stats (health, power, speed). Breed isn't shown. |
| Titles | Earned list plus the active title |
| Achievements | Earned with **dates**, and criteria progress. Dates appear only here. |
| Reputations | Faction, standing (Hated … Exalted), progress within the standing |
| Professions | Primary and secondary, with skill levels |
| Quests | Completed list plus in-progress list. In-progress has no objectives, so no bars. |
| Encounters | Bosses killed per instance, with counts |
| PvP | Summary fields. A field that isn't returned shows "—" and "not returned", never 0. |
| Hunter pets | Hunters only. The section is absent for every other class. |
| Transmog | Unlocked appearances per slot, and each equipped item's current transmog. Blizzard's render shows worn gear, not transmog, which is why the tracker has a "Currently worn transmog" list. |
| Account-wide | Detected from real data: the same list for every linked character. Shown as "Shared across this account" (the glyph is always paired with text, or the short form "Account"). |

---

## Components (`components/`)

`collections.css` contains only `var(--es-*)` values. There is one `.md` per component, and the live gallery is `gallery/components.html` (screenshots: `components-<theme>.png`).

| Component | File |
|---|---|
| Collection tile — collected, missing, selected, hover, pet level, loading | `collection-tile.md` |
| Completion bar | `completion-bar.md` |
| Standing bar | `standing-bar.md` |
| Slot picker | `slot-picker.md` |
| Filter bar | `filter-bar.md` |
| Account-wide marker | `account-marker.md` |
| Source line | `source-line.md` |
| Wowhead text link | `wowhead-link.md` |
| Empty and unavailable states | `empty-unavailable.md` |
| Count card (summary) | `count-card.md` |
| Collection section | `collection-section.md` |
| Detail pane | `detail-pane.md` |

**Collected vs missing never relies on colour alone.** Each one is told apart four ways:

| Cue | Collected | Missing |
|---|---|---|
| Edge | solid, quality colour | dashed, neutral |
| Icon | full | faded and greyscale |
| Corner mark | check disc | hollow ring |
| Text | — | the word "Missing" under the name, plus "missing" in the accessible name |

## Tokens (`tokens/`) — new only

- `collections.css` / `collection-tokens.json`
- **Sizes:** `--es-coll-tile` (64), `-tile-phone` (52), `-tile-lg` (88), `-tile-col`, `-tile-gap`, `-mark`, `-count-min`, `-slotpick-w`, `-detail-w`, `-standing-h`, `-boss-pip`, `-glyph`
- **Roles:** `--es-coll-collected-edge`, `-missing-edge`, `-missing-opacity`, `-mark-collected`, `-selected`, `-acct`, `-optional-edge`
- **Standings:** `--es-standing-hated` … `--es-standing-exalted`. All are built from the theme's own tokens (`--es-danger`, `--es-warning`, `--es-success`, `--es-accent`), so they follow Forever, Alliance and Horde.

## Reused from earlier packages

**v1:**

- top bar, footer, `.sheet`, `.panel`, `.tabs`, `.seg`, `.search`, `select.inp`, `.tag`, `.note`, `.bar`, `.kv`
- `.cathead`, `.rankpill`, `.fresh`, `.skel`, `.empty-box` pattern, the leaderboard table and phone rank list, `.mini` board cards, `.orn`
- quality colours `--es-q-*`, the tier shield, the ruleset switcher

**v2-badges:**

- signed-in header with the inline player badge
- the pin glyph

**v3-share-cards:**

- the card system: `cards.css`, `fill.js`, card tokens, the footer band, the render contract
- the card maker: `.maker`, `.stage`, `.statpick`, `.tchip`, `.swatch`, actions, the link-preview row

## Share card (`cards/`)

`cards/collections/{square,story,wide}.html` is the v3 card system with a new type, `.t-coll`.

**On the card:**

- identity
- transmog completion (% and "412 / 2,140"; just "412 appearances collected" without the catalog)
- up to 6 counts, each with the account glyph and explained once by "Shared across this account"
- a showcase of up to 6 mount and pet icons in quality-bordered slots

**Always present:** the v3 footer — wordmark, link, "Data: Blizzard Entertainment" and "as of {date}".

**Example renders:** `examples/collections/<format>-<theme>.png` (9), plus `examples/collections/no-catalog/` (3).

---

## Decisions

- **Account-wide boards rank characters, not accounts.** Everstats can't link a stranger's characters into one account, so alts can sit side by side. Linked alts are labelled "same account as #N", and owners can hide alts from collection boards in Account settings.
- **Collection counts are not graded.** They don't feed tiers; they're boards and pinnable counts only. This matches v1's "Deaths" category.
- **No dates except achievements.** Mounts and the rest can't sort by "recent" unless the optional "first seen by Everstats" variant is on.
- **The transmog detail lists every item that grants the appearance.** Getting any one of them unlocks it.
- **Phone:**
  - The slot picker becomes a scrolling chip row.
  - The detail pane becomes a bottom sheet (`.cdetail` gets a grab handle and a top radius). The full-page screenshots show it in place at the end of the page.
  - Count cards show "Account" without the glyph's long label.

## Added beyond the brief

- **"Currently worn transmog" list.** Blizzard's render doesn't show transmog, so the list fills the gap.
- **Pet detail pane with stats**, and **instance cards with kill counts per boss**.
- **"Same account as #N" labels** on collection boards, plus the owner's "hide alts" setting.
- **"Completed this week" for quests**, worked out from Everstats' own daily snapshots and labelled as such.
- **A standing-bar key** ("How to read a standing bar") on the reputations screen.
- **Section headers show a mini completion bar** on desktop when the catalog exists.

## Left out, or only partly delivered

- **No real Blizzard icons.** Mockups use original placeholder glyphs inside the quality-bordered slots; production swaps in Blizzard's media images.
- **Static mockups.** Expand and collapse, filters, sort, pin and tile selection are drawn but not wired, and the bottom sheet isn't animated.
- **Not every screen is a separate page.** Only the Head slot of the transmog tracker and the first page of each grid are drawn; other slots and categories use the same components.
- **Housing and Legacy follow an assumed data shape.** Rebuild the content from whatever the probe actually finds.
- **No PvP board for every field.** Only honorable kills is shown as a board; other fields can become boards the same way.
