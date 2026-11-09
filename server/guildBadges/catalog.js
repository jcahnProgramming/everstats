/**
 * Guild badges (0.7.1): what exists, from design/v2-guild-badges (README.md and badges/README.md). Definitions live in
 * the database (guild_badge_definitions); these are the SEED rows migration 016 inserts once, plus the admin's
 * templates for new ones. A guild badge is cosmetic: it grants nothing, and NOBODY can award one to their own guild.
 * Every guild badge is automatic (badges/rules.js decides it from stored data) or granted by Everstats staff.
 *
 * The frame is the Hanging Standard (a three-tailed gonfalon on a rod), never used by a player badge, and every
 * popover, toast and detail page says "Guild badge · <Family>", so a guild badge can't be mistaken for a player's.
 *
 * A definition: id, family, name, description, how (what it took, in words), art (a file in
 * client/src/guildBadges/art/, copied verbatim from the export; levelled badges add -1…-5), template, levelled +
 * measure + thresholds (I–V, admin-editable), award 'automatic' | 'manual', the automatic rule, keptWhileHeld (Standing
 * and Verified), statusMark (Verified: a mark beside the guild's name, never a badge slot).
 *
 * Automatic rules (guildBadges/rules.js):
 *   { type: 'members' }                         tracked members (the guild totals' basis), levelled
 *   { type: 'stat-total', statistic: 'Name' }   the combined total of one statistic over current tracked members,
 *                                               levelled. Matched BY NAME against the live catalog (never an id)
 *   { type: 'every-class' }                     tracked level 10+ members cover every class Blizzard has returned
 *   { type: 'board-champion' }                  #1 on an overall guild board (total or average), kept while held
 *   { type: 'top-ten' }                         top 10 on an overall guild board with MORE than 10 ranked guilds
 *   { type: 'weekly-champion' }                 #1 on a weekly guild board this week (resets Tuesday)
 *   { type: 'strong-roster' }                   the tracked members' average overall letter is A or better
 *   { type: 'founding' }                        first tracked while the beta window was open (permanent)
 *   { type: 'early-guild' }                     first tracked inside the admin-set early window (permanent)
 *   { type: 'verified' }                        has a Guild Master on Everstats right now (a status mark)
 */
export const FAMILIES = Object.freeze([
  { id: 'roster', label: 'Roster' },
  { id: 'deeds', label: 'Deeds' },
  { id: 'standing', label: 'Standing' },
  { id: 'heritage', label: 'Heritage' },
  { id: 'recognition', label: 'Recognition' },
]);
export const FAMILY_IDS = FAMILIES.map((f) => f.id);
/** Default display order for a guild nobody manages yet (manage-picker.md): highest level first inside a family. */
export const DEFAULT_FAMILY_ORDER = Object.freeze(['recognition', 'standing', 'roster', 'deeds', 'heritage']);

/** The guild page's badge row (design token --es-gbadge-row-max) and the "Unlocked" ribbon (--es-gbadge-ribbon-days). */
export const ROW_MAX = 6;
export const RIBBON_DAYS = 7;
export const LEVELS = Object.freeze([
  { level: 1, numeral: 'I', metal: 'Iron' },
  { level: 2, numeral: 'II', metal: 'Bronze' },
  { level: 3, numeral: 'III', metal: 'Silver' },
  { level: 4, numeral: 'IV', metal: 'Gold' },
  { level: 5, numeral: 'V', metal: 'Forever' },
]);
export const numeral = (level) => LEVELS[level - 1]?.numeral ?? null;
/** Strong Roster: the average overall letter (S 5 … D 1) must reach this, A. */
export const STRONG_ROSTER_MIN = 4;
export const LETTER_POINTS = Object.freeze({ S: 5, A: 4, B: 3, C: 2, D: 1 });
/** Top Ten needs a board where a top-ten place beats somebody: more than this many ranked guilds. */
export const TOP_TEN = 10;

export const SEED_GUILD_BADGES = Object.freeze([
  { id: 'muster', family: 'roster', name: 'Muster', art: 'roster/muster', levelled: true, measure: 'tracked members', thresholds: [10, 25, 50, 100, 250],
    rule: { type: 'members' }, sort: 110,
    description: 'Every guildie who signs in (or is tracked) moves the guild up.', how: 'Tracked members on Everstats.' },
  { id: 'every-calling-g', family: 'roster', name: 'Every Calling', art: 'roster/every-calling-g', rule: { type: 'every-class' }, sort: 120,
    description: 'Every class marches under this banner.', how: 'Tracked level 10+ members cover every class.' },
  { id: 'questers', family: 'deeds', name: 'Questers', art: 'deeds/questers', levelled: true, measure: 'quests completed', thresholds: [10_000, 50_000, 100_000, 500_000, 1_000_000],
    rule: { type: 'stat-total', statistic: 'Quests completed' }, sort: 210,
    description: 'Quests completed, together.', how: 'Quests completed, combined across current tracked members.' },
  { id: 'slayers', family: 'deeds', name: 'Slayers', art: 'deeds/slayers', levelled: true, measure: 'creatures killed', thresholds: [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000],
    rule: { type: 'stat-total', statistic: 'Creatures killed' }, sort: 220,
    description: 'Creatures killed, together.', how: 'Creatures killed, combined across current tracked members.' },
  { id: 'campfire', family: 'deeds', name: 'Campfire', art: 'deeds/campfire', levelled: true, measure: 'times camped', thresholds: [100, 500, 1_000, 5_000, 10_000],
    rule: { type: 'stat-total', statistic: 'Times camped' }, sort: 230,
    description: 'Nights spent round the fire.', how: 'Times camped, combined across current tracked members.' },
  { id: 'fallen-together', family: 'deeds', name: 'Fallen Together', art: 'deeds/fallen-together', levelled: true, measure: 'deaths', thresholds: [1_000, 5_000, 10_000, 50_000, 100_000],
    rule: { type: 'stat-total', statistic: 'Total deaths' }, sort: 240,
    description: 'Just for fun: deaths never count toward tiers.', how: 'Total deaths, combined across current tracked members.' },
  { id: 'board-champion', family: 'standing', name: 'Board Champion', art: 'standing/board-champion', rule: { type: 'board-champion' }, keptWhileHeld: true, sort: 310,
    description: 'First on a guild board.', how: '#1 on a guild board (by total or by per-member average).' },
  { id: 'top-ten', family: 'standing', name: 'Top Ten', art: 'standing/top-ten', rule: { type: 'top-ten' }, keptWhileHeld: true, sort: 320,
    description: 'In the top ten on a guild board.', how: 'Top 10 on a guild board (by total or by per-member average) that ranks more than 10 guilds.' },
  { id: 'weekly-champion', family: 'standing', name: 'Weekly Champion', art: 'standing/weekly-champion', rule: { type: 'weekly-champion' }, keptWhileHeld: true, sort: 330,
    description: 'First on a weekly guild board.', how: '#1 on a weekly guild board this week. Resets at the Tuesday weekly reset.' },
  { id: 'strong-roster', family: 'standing', name: 'Strong Roster', art: 'standing/strong-roster', rule: { type: 'strong-roster' }, keptWhileHeld: true, sort: 340,
    description: 'A roster of high tiers.', how: 'The average overall tier of its tracked members is A or better.' },
  { id: 'founding-guild', family: 'heritage', name: 'Founding Guild', art: 'heritage/founding-guild', rule: { type: 'founding' }, timeLimited: true, sort: 410,
    description: 'Here while Everstats was in its open beta.', how: 'Tracked on Everstats during the open beta.' },
  { id: 'early-guild', family: 'heritage', name: 'Early Guild', art: 'heritage/early-guild', rule: { type: 'early-guild' }, timeLimited: true, sort: 420,
    description: 'Here early, just after launch.', how: 'Tracked in the early window after launch.' },
  { id: 'verified-guild', family: 'recognition', name: 'Verified Guild', art: 'recognition/verified-guild', rule: { type: 'verified' }, keptWhileHeld: true, statusMark: true, sort: 510,
    description: 'Its Guild Master is on Everstats.', how: 'Has an active Guild Master on Everstats (owns the rank-0 character).' },
  { id: 'partner-guild', family: 'recognition', name: 'Partner Guild', art: 'templates/partner-guild', template: 'partner-guild', sort: 520,
    description: 'An official Everstats community partner.', how: 'Granted by Everstats staff to official community partners.' },
  { id: 'featured-guild', family: 'recognition', name: 'Featured Guild', art: 'recognition/featured-guild', sort: 530,
    description: 'Featured by Everstats.', how: 'Granted by Everstats staff, e.g. for an event.' },
]);

/**
 * The admin's template for a NEW collective-statistic badge (no code change): a name, a statistic NAME from the
 * catalog and five thresholds. Drawn with the Deeds template's own art (its neutral motif slot), so it needs no file.
 */
export const DEEDS_TEMPLATE = Object.freeze({ id: 'deeds-template', family: 'deeds', art: 'templates/deeds-template', label: 'Deeds (collective statistic)' });

export const familyOf = (id) => FAMILIES.find((f) => f.id === id) ?? null;
