# Everstats — v2 badges (additive to v1)

Badges are emblems a player account earns or is granted. They appear in three places:

- on the public profile (`/u/{username}`)
- as a single inline badge next to the username in a few places
- in Settings → Badges, where the player chooses and orders what to show

This package **adds to `v1/` and replaces nothing.** Keep `v1/` and `v2-badges/` side by side in the repo; every mockup and SVG here links into `../v1/`.

Load order on any page that shows badges:

1. `v1/assets/fonts/fonts.css`
2. `v1/tokens/themes.css`
3. `v1/components/components.css`
4. `v2-badges/tokens/badges.css`
5. `v2-badges/components/badges.css`

The same rules as v1 apply: no hex, RGB or px values outside `tokens/` (checked with an automated lint), three themes, a 719px phone breakpoint, and placeholder data only.

---

## Families and frames

Each family is identified by **frame shape**, so families are told apart without colour. The meaning comes from the **motif** plus the **text label**, which appears in every popover, card, detail page and toast.

v1's **shield** stays reserved for tier badges (S/A/B/C/D). No badge family uses a shield, so a badge never reads as a tier.

| # | Family | Frame | Body / metal | Badges | How you get them |
|---|---|---|---|---|---|
| 1 | **Staff** | Eight-point star seal, the most ornate frame, gold ring | Deep violet / theme gold | **Dev Team** (code brackets); **Moderator** (balance scales — designed now, ships unused) | Granted by admin. Verified. |
| 2 | **Partner** | Chamfered plaque, teal-silver ring | Deep teal / teal-silver | **Pro Team Partner** (TEMPLATE: partner-mark slot; placeholder "PT" shield); **Community Partner** (linked rings); **Platform Employee** (TEMPLATE: verified rosette + monogram slot) → **Blizzard Employee** "B", **Discord Employee** "D" | Granted by admin. Verified. Employees are later verified by work-email domain. |
| 3 | **Membership** | Round coin, copper ring | Bronze / copper | **Beta Tester** (flask); **Early Supporter** (sunrise) | Automatic by account creation date. **Time-limited**: once the window closes the badge shows as "No longer available". |
| 4 | **Faction** | Swallowtail banner | Alliance blue + gold; Horde crimson + iron | **Alliance** (battlement crown + star); **Horde** (tusks + flame); **Envoy** (split banner, two flags, joining seal) | Automatic from level 10+ characters. |
| 5 | **Class** | Diamond, silver ring | One body colour per class | Warrior (sword), Paladin (haloed hammer), Hunter (arrow), Rogue (dagger), Priest (candle), Shaman (lightning), Mage (arcane star + orbit), Warlock (crescent + star), Druid (leaf); **Class TEMPLATE** (class-mark slot); **Every Calling** (nine pips, gold ring) | Automatic: owns a level 10+ character of that class, or every class for Every Calling. |
| 6 | **Achievement** | Hexagon, brass ring | Deep green / brass | **Guild Master** (pointed crown); **S-Tier** (laurelled S); **Achievement TEMPLATE** | Automatic from stats. S-Tier is kept only while held. |

**The class body colours are original.** They are deliberately not WoW's class colours, and none of the motifs are traced from class icons. Faction badges use their theme colours with original symbols, not the faction crests. There are no Blizzard, Discord or team logos anywhere.

### Names I proposed

- **Envoy**: the "both factions" badge. Short enough to sit next to a name, neutral, and it fits the banner art. "Diplomat" works with no art change if you prefer it.
- **Every Calling**: the "Full Roster" badge. It still makes sense when a class is added, unlike "Ninefold". Its nine pips grow to ten with the class template.
- **Platform Employee**: the template behind Blizzard Employee and Discord Employee.

---

## Sizes and states (summary; full spec in `components/badge.md`)

| Size | Value | Use |
|---|---|---|
| Inline | 18px, with a simplified drawing `*-inline.svg` | Next to names |
| Standard | 44px | Profile row, cards, popover, toast |
| Large | 112px | Detail page, admin preview |
| XL | 128px | Detail page hero |

**States:**

- **earned**
- **new**: a glow and a dot until the badge is viewed, plus a "New" chip on its card
- **locked**: greyed silhouette with a lock
- **no longer available**: retired; greyed, with a clock and a note giving the window
- **loading**
- plus hover, focus and active for interactive badges

**Light panels:** every badge has a dark rim, so it holds on light panels (proved on `--es-badge-light-panel` in the gallery), and a metal ring, so it holds on dark ones. Contrast is measured in `tokens/contrast.md`: motif ink is at least 4.5:1 on its body, the metal ring at least 3:1 on every v1 ground, and the rim at least 3:1 on the light panel.

---

## Index

```
v2-badges/
  README.md
  tokens/
    badge-tokens.json        new tokens per theme (DTCG): --es-badge-* colours, badge sizes
    badges.css               the same as custom properties; Forever = :root
    contrast.md              ink/fill, metal/ground, rim/light-panel ratios for all three themes
  badges/
    README.md                files, slots, full index
    staff/ partner/ membership/ faction/ class/ achievement/   <id>.svg + <id>-inline.svg
    templates/               partner-pro, platform-employee, class-template, achievement-template (marked data-slot)
  components/
    badges.css               all badge component CSS (only var(--es-*))
    badge.md  badge-row.md  inline-badge.md  badge-popover.md  badge-picker.md  admin-grant-form.md  badge-toast.md
    gallery/all-badges.html  + all-badges-{forever,alliance,horde}.png   families, every badge × 3 sizes, dark + light panels, states
    gallery/components.html  + components-{theme}.png                    every component in every state
  pages/  (index.html + spec.md + screenshots/{desktop,phone}-{theme}.png)
    profile/  (+ popover-* and all-* variant screenshots)   settings-badges/   badge-detail/   admin-badges/
  states/ (index.html + README.md + {desktop,phone}-{theme}.png)
    new/  locked/  no-longer-available/  empty-profile/  empty-settings/
```

There are 72 screenshots: every screen in Forever, Alliance and Horde, at 1440px and 390px.

---

## v1 pieces reused

- **Tokens:** every `--es-*` value from `v1/tokens/themes.css` — grounds, text, lines, accent, focus, status colours, spacing, radius, motion, shadows, fonts.
- **Shared CSS:** `v1/components/components.css`, including the top bar, bottom bar, `.sheet`, `.panel`, `.raised`, buttons, inputs, toggle, tags, tier badge, stat card, `.tbl`, `.note`, toasts, modals, `.grid-auto`, `.split` and `.mapbg`.
- **Layouts:** the v1 Account settings layout and the v1 Admin layout.
- **Patterns:** the tier badge is reused on the profile's Characters section, the toast and modal patterns for the badge toast and the "All badges" dialog, and v1's focus ring, shimmer and reduced-motion rules apply unchanged.

## New tokens (all in `tokens/`)

- **Per theme:** `--es-badge-rim`, `--es-badge-{staff|partner|member|alliance|horde|achv}-{fill|metal|ink}`, `--es-badge-class-{warrior…druid|template}`, `--es-badge-class-{metal|ink}`, `--es-badge-locked-{fill|metal|ink}`, `--es-badge-new`, `--es-badge-light-panel(-text|-line)`.
- **Shared:** `--es-size-badge-inline` (18px), `--es-size-badge` (44px), `--es-size-badge-lg` (112px), `--es-size-badge-xl` (128px), `--es-size-badge-slot` (64px), `--es-size-badge-popover` (320px), `--es-size-badge-pip` (8px), `--es-badge-row-max` (6).

---

## Added beyond the brief

- **A Public profile page design.** The brief asked for the badge row on it; I designed the whole profile around it: avatar, display name, `@username`, joined date, bio, main ruleset and faction, guild, fixed-platform social handles, pinned stats and claimed characters.
- **An "All badges" dialog** behind "+N more" (`?variant=all`).
- **XL size (128px)** for the detail hero. The brief's large range is 96–128px; 112px is the standard large.
- **Two more toast variants:** "Badge granted" for manual badges, and "S-Tier badge removed" for kept-while-held badges.
- **A loading state** for badges.
- **Admin details:** a "Notify the player" checkbox, a rule that Pro Team Partner can't be granted before a mark is uploaded, and a mark-upload confirmation checkbox.
- **An "Achievement template"** alongside the partner and class templates.
- **Behaviours I proposed — confirm or change:**
  - Class, faction and membership badges **stay once earned**, even if the character is deleted. Only S-Tier is kept-while-held.
  - Featuring a 7th badge shows a "turn one off first" note.
  - Several badges earned at once collapse into one toast.
  - The "earned" toast lasts 8 seconds instead of v1's 5.
  - Inline badges are **not** shown in leaderboard tables, to keep them dense.
  - The popover opens on hover after 300ms and flips above when there's no room below.
  - The "new" highlight clears once the popover or detail page has been opened.

## Left out, or only partly delivered

- **No real partner, Blizzard or Discord marks.** By design: the Pro Team slot shows a neutral "PT" placeholder, and the employee badges use a letter monogram.
- **Moderator** is designed but ships unused, as the brief says.
- **Early Supporter's window** is "[Date] – [Date] (to be decided)".
- **Drag-and-drop is static in the mockups.** The dragging and drop-target states are drawn in the gallery, and keyboard reordering is specified in `badge-picker.md`.
- **Popover flipping and clamping** are specified, not prototyped.
- **No public badge directory** page listing every badge site-wide. It wasn't in the brief; the detail page's "Other <family> badges" row covers browsing within a family.
- **Badge text** (S, PT, B, D, ?) depends on the Cinzel font. It falls back to Georgia in standalone SVGs; convert it to outlines for production if you want the files fully self-contained.
- **Nothing else from the brief was dropped.** All families, all badges, both templates, three sizes, the earned/new/locked/no-longer-available states, all components, four pages, five states, and three themes at two widths are present.
