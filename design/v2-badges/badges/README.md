# Badge artwork

Every badge is original art: geometric frames and simple motifs. Nothing is traced from game UI, and there are no Blizzard, Discord or team logos.

## Files
Each badge has two drawings:
- `<id>.svg`: the detailed drawing, for standard (44), large (112) and xl (128) sizes.
- `<id>-inline.svg`: the simplified drawing for 16–20px (18px in the UI). It has thicker strokes, no inset ring, and the motif reduced to its silhouette.

## Colours
All colour is CSS custom properties, set on the root `<svg>`:
- `--bf` body, `--bm` metal ring, `--bi` motif ink, `--bf2` second body (Envoy)
- `--es-badge-rim` for the rim

Opened on their own, the files load `../../../v1/tokens/themes.css` and `../../tokens/badges.css` through `<?xml-stylesheet?>`, so they render in Forever. Inlined in a page, they follow the page theme. Keep `v1/` and `v2-badges/` as siblings.

Text in badges (S, PT, B, D, ?) uses `var(--es-font-display)` (Cinzel). It falls back to Georgia when a file is opened without the page's fonts. For production you can convert the text to outlines if you prefer.

## Frames (family = shape)
| Family | Frame |
|---|---|
| Staff | Eight-point star (seal) |
| Partner | Chamfered plaque |
| Membership | Round coin |
| Faction | Swallowtail banner |
| Class | Diamond |
| Achievement | Hexagon |

## Templates (`templates/`)
Each template marks its replaceable part with `data-slot="…"` and a comment at the top of the file.
- **partner-pro**, `data-slot="partner-mark"`: put the partner's official mark (only with written permission) in a 30×30 box centred at 32,32 (inline: 32×32). The placeholder is a plain shield with "PT".
- **platform-employee**, `data-slot="platform-monogram"`: one capital letter. Blizzard Employee = "B", Discord Employee = "D". Any future sign-in platform gets a badge by adding a letter; the verified rosette stays the same.
- **class-template**, `data-slot="class-mark"`: an original single-colour glyph for a class Blizzard adds later. Also add a token `--es-badge-class-<name>` (body colour), and add a pip to Every Calling.
- **achievement-template**, `data-slot="achievement-mark"`: an original glyph for future stat-based achievements.

## Index
| Badge | Family | Files | How earned | Type |
|---|---|---|---|---|
| **Dev Team** | Staff | `staff/dev-team.svg` · `-inline.svg` | Granted to people who build Everstats. | Granted · Verified |
| **Moderator** | Staff | `staff/moderator.svg` · `-inline.svg` | Granted to the content moderation team. | Granted · Verified |
| **Pro Team Partner** | Partner | `templates/partner-pro.svg` · `-inline.svg` | Granted to verified professional WoW teams after a partnership agreement. | Granted · Verified · TEMPLATE |
| **Community Partner** | Partner | `partner/community-partner.svg` · `-inline.svg` | Granted to verified partner communities, Discord servers and sites. | Granted · Verified |
| **Platform Employee (template)** | Partner | `templates/platform-employee.svg` · `-inline.svg` | Verified by work-email domain of the platform. | Granted · Verified · TEMPLATE |
| **Blizzard Employee** | Partner | `partner/blizzard-employee.svg` · `-inline.svg` | Verified by a Blizzard work-email address. | Granted · Verified |
| **Discord Employee** | Partner | `partner/discord-employee.svg` · `-inline.svg` | Verified by a Discord work-email address. | Granted · Verified |
| **Beta Tester** | Membership | `membership/beta-tester.svg` · `-inline.svg` | Joined during the open beta. | Automatic · Time-limited |
| **Early Supporter** | Membership | `membership/early-supporter.svg` · `-inline.svg` | Joined in the early window after launch. | Automatic · Time-limited |
| **Alliance** | Faction | `faction/alliance.svg` · `-inline.svg` | Owns a level 10+ Alliance character. | Automatic |
| **Horde** | Faction | `faction/horde.svg` · `-inline.svg` | Owns a level 10+ Horde character. | Automatic |
| **Envoy** | Faction | `faction/envoy.svg` · `-inline.svg` | Owns level 10+ characters on both factions. | Automatic |
| **Warrior** | Class | `class/warrior.svg` · `-inline.svg` | Owns a level 10+ Warrior. | Automatic |
| **Paladin** | Class | `class/paladin.svg` · `-inline.svg` | Owns a level 10+ Paladin. | Automatic |
| **Hunter** | Class | `class/hunter.svg` · `-inline.svg` | Owns a level 10+ Hunter. | Automatic |
| **Rogue** | Class | `class/rogue.svg` · `-inline.svg` | Owns a level 10+ Rogue. | Automatic |
| **Priest** | Class | `class/priest.svg` · `-inline.svg` | Owns a level 10+ Priest. | Automatic |
| **Shaman** | Class | `class/shaman.svg` · `-inline.svg` | Owns a level 10+ Shaman. | Automatic |
| **Mage** | Class | `class/mage.svg` · `-inline.svg` | Owns a level 10+ Mage. | Automatic |
| **Warlock** | Class | `class/warlock.svg` · `-inline.svg` | Owns a level 10+ Warlock. | Automatic |
| **Druid** | Class | `class/druid.svg` · `-inline.svg` | Owns a level 10+ Druid. | Automatic |
| **Class (template)** | Class | `templates/class-template.svg` · `-inline.svg` | Owns a level 10+ character of the new class. | Automatic · TEMPLATE |
| **Every Calling** | Class | `class/every-calling.svg` · `-inline.svg` | Owns a level 10+ character of every class. | Automatic |
| **Guild Master** | Achievement | `achievement/guild-master.svg` · `-inline.svg` | Owns the guild-master character (roster rank 0) of a tracked guild. | Automatic |
| **S-Tier** | Achievement | `achievement/s-tier.svg` · `-inline.svg` | Holds an overall S tier on any ruleset. Kept only while held. | Automatic |
| **Achievement (template)** | Achievement | `templates/achievement-template.svg` · `-inline.svg` | Defined per achievement. | Automatic · TEMPLATE |
