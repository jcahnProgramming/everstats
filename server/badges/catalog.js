/**
 * Badges (0.7.0): what exists, from design/v2-badges (README.md index and badges/README.md). Definitions live in the
 * database (badge_definitions); these are the SEED rows the migration inserts once, plus the admin's templates for
 * new ones. Nothing here grants a permission: a badge is cosmetic, Dev Team included (the admin stays the separate
 * passkey-only identity).
 *
 * A definition: id, family, name, description, how (the "how it's earned" sentence every locked badge shows), art (a
 * file in client/src/badges/art/, copied verbatim from the export), the template it was made from, a monogram
 * (platform-employee), award 'manual' | 'automatic', the automatic rule, keptWhileHeld (S-Tier only), timeLimited
 * (membership), verified (staff and partner: granted by Everstats, shown as "Verified").
 *
 * Automatic rules (badges/rules.js decides them; every one stays once earned except keptWhileHeld):
 *   { type: 'beta' }                    the account is a beta member (accounts.beta_member, set at creation)
 *   { type: 'early-supporter' }         the account was created inside the admin-set window (badges.earlySupporter)
 *   { type: 'faction', faction }        owns a level 10+ character of that faction (Blizzard's faction name)
 *   { type: 'envoy' }                   owns level 10+ characters of both factions
 *   { type: 'class', class }            owns a level 10+ character of that class (Blizzard's class name)
 *   { type: 'every-class' }             owns a level 10+ character of EVERY class: the classes Blizzard has returned on
 *                                       any stored character (inside the retention window) plus every class badge
 *   { type: 'guild-master' }            owns a character that is rank 0 on a stored guild roster
 *   { type: 's-tier' }                  holds an overall S on any ruleset (kept only while held)
 */
export const FAMILIES = Object.freeze([
  { id: 'staff', label: 'Staff', frame: 'Star seal', plural: 'staff' },
  { id: 'partner', label: 'Partner', frame: 'Plaque', plural: 'partner' },
  { id: 'membership', label: 'Membership', frame: 'Coin', plural: 'membership' },
  { id: 'faction', label: 'Faction', frame: 'Banner', plural: 'faction' },
  { id: 'class', label: 'Class', frame: 'Diamond', plural: 'class' },
  { id: 'achievement', label: 'Achievement', frame: 'Hexagon', plural: 'achievement' },
]);
export const FAMILY_IDS = FAMILIES.map((f) => f.id);
/** Staff and partner badges always come first in a row (design: badge-row.md). */
export const FIRST_FAMILIES = Object.freeze(['staff', 'partner']);

/** The profile row and the "Featured" slots (design token --es-badge-row-max). */
export const FEATURED_MAX = 6;
export const MIN_LEVEL = 10;

/** The /beta perk, now that badges exist (it said "will receive … when badges launch" before 0.7.0). */
export const BETA_PERK_TEXT = 'Every account created while the beta is open receives the Beta Tester badge. It stays on the account for good.';

const CLASSES = [
  ['warrior', 'Warrior'], ['paladin', 'Paladin'], ['hunter', 'Hunter'], ['rogue', 'Rogue'], ['priest', 'Priest'],
  ['shaman', 'Shaman'], ['mage', 'Mage'], ['warlock', 'Warlock'], ['druid', 'Druid'],
];

export const SEED_BADGES = Object.freeze([
  { id: 'dev-team', family: 'staff', name: 'Dev Team', art: 'staff/dev-team', sort: 10,
    description: 'Builds Everstats. Cosmetic only: it grants no admin access.', how: 'Granted to people who build Everstats.' },
  { id: 'moderator', family: 'staff', name: 'Moderator', art: 'staff/moderator', sort: 20,
    description: 'Moderates Everstats content.', how: 'Granted to the content moderation team.' },
  { id: 'community-partner', family: 'partner', name: 'Community Partner', art: 'partner/community-partner', sort: 110,
    description: 'A partner community, Discord server or site.', how: 'Granted to verified partner communities, Discord servers and sites.' },
  { id: 'blizzard-employee', family: 'partner', name: 'Blizzard Employee', art: 'partner/blizzard-employee', template: 'platform-employee', monogram: 'B', sort: 120,
    description: 'Works at Blizzard Entertainment.', how: 'Granted by Everstats staff after checking employment. Work-email verification comes later.' },
  { id: 'discord-employee', family: 'partner', name: 'Discord Employee', art: 'partner/discord-employee', template: 'platform-employee', monogram: 'D', sort: 130,
    description: 'Works at Discord.', how: 'Granted by Everstats staff after checking employment. Work-email verification comes later.' },
  { id: 'beta-tester', family: 'membership', name: 'Beta Tester', art: 'membership/beta-tester', rule: { type: 'beta' }, timeLimited: true, sort: 210,
    description: 'Was here while Everstats was in beta.', how: 'Given to every account created while the beta is open.' },
  { id: 'early-supporter', family: 'membership', name: 'Early Supporter', art: 'membership/early-supporter', rule: { type: 'early-supporter' }, timeLimited: true, sort: 220,
    description: 'Joined Everstats early.', how: 'Given to every account created inside the early-supporter window.' },
  { id: 'alliance', family: 'faction', name: 'Alliance', art: 'faction/alliance', rule: { type: 'faction', faction: 'Alliance' }, sort: 310,
    description: 'Fights for the Alliance.', how: 'Owns a level 10+ Alliance character.' },
  { id: 'horde', family: 'faction', name: 'Horde', art: 'faction/horde', rule: { type: 'faction', faction: 'Horde' }, sort: 320,
    description: 'Fights for the Horde.', how: 'Owns a level 10+ Horde character.' },
  { id: 'envoy', family: 'faction', name: 'Envoy', art: 'faction/envoy', rule: { type: 'envoy' }, sort: 330,
    description: 'Has a foot on both sides.', how: 'Owns level 10+ characters on both factions.' },
  ...CLASSES.map(([id, name], i) => ({
    id: `class-${id}`, family: 'class', name, art: `class/${id}`, rule: { type: 'class', class: name }, sort: 410 + i * 10,
    description: `Plays a ${name}.`, how: `Owns a level 10+ ${name}.`,
  })),
  { id: 'every-calling', family: 'class', name: 'Every Calling', art: 'class/every-calling', rule: { type: 'every-class' }, sort: 590,
    description: 'Has played every class.', how: 'Owns a level 10+ character of every class.' },
  { id: 'guild-master', family: 'achievement', name: 'Guild Master', art: 'achievement/guild-master', rule: { type: 'guild-master' }, sort: 610,
    description: 'Leads a guild.', how: 'Owns the guild-master character (roster rank 0) of a guild Everstats tracks.' },
  { id: 's-tier', family: 'achievement', name: 'S-Tier', art: 'achievement/s-tier', rule: { type: 's-tier' }, keptWhileHeld: true, sort: 620,
    description: 'Among the best on their ruleset.', how: 'Holds an overall S tier on any ruleset. Kept only while held.' },
]);

/**
 * Templates the admin makes NEW definitions from (no code change). What each needs:
 *   partner-pro        a name; a mark upload (PNG/WebP, re-encoded) before it can be granted. Manual.
 *   platform-employee  a name and a one-letter monogram. Manual (work-email verification later: `verification`).
 *   class              Blizzard's class name exactly as characters carry it. Automatic. Uses the class template's art.
 *   achievement        a name. Manual: an automatic achievement needs a rule, and rules are code (badges/rules.js).
 */
export const TEMPLATES = Object.freeze([
  { id: 'partner-pro', family: 'partner', art: 'templates/partner-pro', label: 'Pro Team Partner', award: 'manual', needs: ['mark'] },
  { id: 'platform-employee', family: 'partner', art: 'templates/platform-employee', label: 'Platform Employee', award: 'manual', needs: ['monogram'] },
  { id: 'class', family: 'class', art: 'templates/class-template', label: 'Class', award: 'automatic', needs: ['class'] },
  { id: 'achievement', family: 'achievement', art: 'templates/achievement-template', label: 'Achievement', award: 'manual', needs: [] },
]);
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;
export const familyOf = (id) => FAMILIES.find((f) => f.id === id) ?? null;
