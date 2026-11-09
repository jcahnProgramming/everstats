# Everstats — guild badges (additive to v1 and v2-badges)

Guilds **unlock** badges by reaching milestones together: tracked members, combined statistics, board standing, and when they joined. A few badges are granted by Everstats staff.

Guild badges show in three places:

- on the guild page (`/g/{slug}`)
- on the /guilds list
- next to the guild's name on guild boards (the pinned badge only)

The Guild Master and the officers they add choose which badges show and pin one. **Nobody can award a guild badge to themselves.** Every badge is either automatic or granted by staff.

Keep this folder next to `v1/` and `v2-badges/`. The mockups and SVGs link to both. Load order:

1. `v1/assets/fonts/fonts.css`
2. `v1/tokens/themes.css`
3. `v1/components/components.css`
4. `v2-badges/tokens/badges.css`
5. `v2-badges/components/badges.css`
6. `v2-guild-badges/tokens/guild-badges.css`
7. `v2-guild-badges/components/guild-badges.css`

The same rules as before apply. No hex, RGB or px values appear outside `tokens/` (automated lint passes). All three themes are covered, plus light panels. Data is fictional only.

---

## Frame language: the Hanging Standard

Every guild badge is a **three-tailed gonfalon hung from a crossbar rod with ball finials**.

- **No player badge uses it.** Player badges use a star seal, plaque, coin, swallowtail banner, diamond or hexagon. None has a rod or three tails.
- **The shield is untouched.** It stays reserved for v1 tiers.
- **The word "Guild" is always on screen.** Every popover, the detail page and every toast says "Guild badge · <Family>".

| Family | Cloth (`--es-gbadge-cloth-*`) | Badges | Type |
|---|---|---|---|
| **Roster** | slate blue | **Muster** (levelled; three figures), **Every Calling** (nine pips) | Automatic |
| **Deeds** (collective statistics) | wine | **Questers** (scroll), **Slayers** (crossed blades), **Campfire** (tent; times camped), **Fallen Together** (two little tombstones; deaths, just for fun), and the **Deeds TEMPLATE** | Automatic, levelled; combined totals of the current tracked members |
| **Standing** | pine | **Board Champion** (laurelled 1), **Top Ten** (podium), **Weekly Champion** (calendar + star; resets Tuesday), **Strong Roster** (three chevrons; needs tiers) | Automatic, **kept while held** |
| **Heritage** | umber | **Founding Guild** (keystone arch; open beta), **Early Guild** (sprout; early window set by admin) | Automatic, permanent, time-limited windows |
| **Recognition** | indigo | **Verified Guild** (check seal; automatic), **Partner Guild** (TEMPLATE, emblem slot, "PG" placeholder), **Featured Guild** (star) | Staff-granted, except Verified |

**Final names (proposed):**

- **Roster** and **Muster** for the member-count badge (your "Gathering / Muster").
- **Deeds** for the collective-statistics family, with badges **Questers**, **Slayers**, **Campfire** and **Fallen Together**.
- **Standing** and **Heritage** for families 3 and 4. The other names are kept as you had them.

**Verified Guild, proposed:** it stays in Recognition, so it's listed with the other badges, but it **displays as a status mark beside the guild name** (a check seal plus "Verified") in the header, the /guilds list and on boards. It never takes one of the 6 badge slots. It's a fact about the guild, not an achievement.

## Level system (I–V)

| Level | Metal | Non-colour cues (all sizes) |
|---|---|---|
| I · Iron | `--es-gbadge-metal-1` | 1 gem on the rod · numeral plate "I" · inline numeral "I" |
| II · Bronze | `--es-gbadge-metal-2` | 2 gems · "II" |
| III · Silver | `--es-gbadge-metal-3` | 3 gems · "III" |
| IV · Gold | `--es-gbadge-metal-4` | 4 gems · "IV" |
| V · **Forever** | `--es-gbadge-metal-5` (Forever's accent-2, in every theme) | 5 gems · "V" · **star finial** · glow · twilight Forever cloth |

At 18px the inline drawing replaces the motif with the numeral, so the level stays readable. Pills always spell the level out ("Muster IV").

**Proposed thresholds** (all editable in Admin, with a preview of how many guilds would hold each level):

| Badge | I | II | III | IV | V |
|---|---|---|---|---|---|
| Muster (tracked members) | 10 | 25 | 50 | 100 | 250 |
| Questers (quests completed) | 10k | 50k | 100k | 500k | 1M |
| Slayers (creatures killed) | 100k | 500k | 1M | 5M | 10M |
| Campfire (times camped) | 100 | 500 | 1k | 5k | 10k |
| Fallen Together (deaths) | 1k | 5k | 10k | 50k | 100k |

**Progress** shows everywhere a level is next: the guild page's **Next unlocks** strip (three cards closest to their next level, by percentage), the popover, the Manage rows, and the detail page's "Your guild" card. Each shows a bar plus "222 / 250 tracked members · 28 to go".

---

## Index

```
v2-guild-badges/
  README.md
  tokens/   guild-badge-tokens.json · guild-badges.css · contrast.md
  badges/   README.md · roster/ deeds/ standing/ heritage/ recognition/ templates/
            levelled: <id>-<1..5>.svg + -inline · others: <id>.svg + -inline
            templates: deeds-template-<1..5> (data-slot="stat-motif"), partner-guild (data-slot="partner-guild-mark")
  components/
    guild-badges.css
    guild-badge.md  guild-pill.md  progress-strip.md  guild-popover.md  manage-picker.md
    guild-toast.md  unlocked-ribbon.md  admin-forms.md
    gallery/components.html + components-<theme>.png
    gallery/all-guild-badges.html + all-guild-badges-<theme>.png
  pages/    guild-big/ (+ popover-*, all-* screenshots)  guild-small/  guild-no-gm/
            manage-badges/  guild-badge-detail/  admin-guild-badges/
  states/   new/  in-progress/  locked/  held/  lost/  no-longer-available/  empty/
```

There are 96 screenshots: every screen in Forever, Alliance and Horde, at 1440px and 390px.

## v1 and v2 pieces reused

**From v1 (`themes.css` and `components.css`):**

- all `--es-*` tokens
- the top bar, bottom bar, `.mapbg`, `.sheet`, `.panel`, `.orn` headings
- the guild header layout and its crest placeholder
- the roster `.tbl`, `.who`, the tier badge
- `.btn`, `.inp`, `.field`, `.toggle`, `.check`, `.tag`, `.note`
- `.toast` and `.toasts`, `.scrim` and `.modal`
- `.split`, `.grid-auto`, `.kv`, `.dropzone` styling patterns
- the focus ring, shimmer and reduced-motion rules

**From v2-badges:**

- the size tokens `--es-size-badge*` (inline 18 / standard 44 / large 112 / xl 128)
- `--es-badge-new` for the new glow
- `--es-badge-light-panel` and `.on-light`
- the `.bdg-pop` popover container
- the locked / retired / new state model
- player inline badges (`.name-badge`) in the header and the roster's "Claimed by" column
- the admin grant, reason and log pattern
- the three-theme mark preview (`.preview3`)

## New tokens

**Per theme (`--es-gbadge-*`):**

- `rim`, `rod`, `rod-knob`, `ink`
- cloth: `cloth-{roster,deeds,standing,heritage,recognition,forever}`
- metals: `metal-1` to `metal-5`, `metal-5-glow`, `metal-fixed`
- standing: `held`, `held-ink`, `lost`
- locked: `locked-{cloth,metal,ink}`
- `progress`, `ribbon`, `ribbon-ink`

**Shared:**

- `--es-size-gbadge-pill` (36px), `-pill-sm` (26px), `-pill-icon` (28px), `-pill-icon-sm` (18px)
- `--es-size-gbadge-unlock-card` (300px)
- `--es-gbadge-row-max` (6), `--es-gbadge-ribbon-days` (7)

Contrast for all of these is in `tokens/contrast.md`; every pair passes.

---

## Added beyond the brief

- **A Copy sign-up link button** in Next unlocks, the "rally" action. The space next to it is where the post-1.0 Discord webhook can go.
- **Featured Guild extras:** an optional event label and "show until" date.
- **Threshold rule:** raising a threshold never removes a level a guild already has.
- **Pin fallback:** if the pinned standing badge is lost, the pin moves to the next shown badge.
- **Defaults for guilds without a GM:** the first 6 badges by family order, highest level first.
- **Unlock toasts batch:** several unlocks since the last visit become one "N guild badges unlocked" toast. Toasts only go to the GM and officers.
- **A Not yet section in Manage,** with the reason a standing badge isn't held (e.g. "average tier is B, needs A").
- **Guild links on the page:** the Discord invite and labelled links appear in the guild header, taken from your guild-page plans.
- **A Deeds template with levels:** a new statistic badge needs only a motif and a threshold row.

## Left out, or only partly delivered

- **No Discord webhook design,** as asked. Room is left next to the rally button.
- **No real partner-guild emblem.** The template shows a neutral "PG" placeholder.
- **Early Guild window dates** are "[Date]". Admin sets them.
- **Strong Roster** is designed but depends on tiers (0.6.0).
- **Drag-and-drop and popover positioning** are static in the mockups. The dragging state, keyboard reordering and flipping are specified in the component docs.
- **Officer management** (adding or removing officers) is linked from the Manage navigation but not designed here; it belongs to the guild-page editing work.
- **Every Calling (guild) has no levels.** A levelled version (e.g. 2+ members of every class) is easy to add with the Deeds template's level treatment if you want it.
- **Nothing else from the brief was dropped.** All five families, levels I–V with progress, the held and lost states, Heritage windows, both templates, all components, 6 page variants and 7 states, in 3 themes at 2 widths, are present.
