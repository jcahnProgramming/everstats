/**
 * Page titles (0.9.2): every page has its own browser-tab title, "<page> · Everstats". This table is the ONE place the
 * fixed ones live; the client shell (chrome/AppShell.jsx) sets them on every navigation and the server writes the same
 * <title> into the HTML it serves (cards/meta.js), so a tab, a bookmark and a link preview agree.
 *
 * Pages whose title comes from their data (a character, a guild, a profile, a board, a badge) get a generic title here
 * until their data arrives, then set the real one themselves (client/src/pageTitle.js usePageTitle). The server's link
 * previews give those pages their real titles too.
 */
export const SITE_NAME = 'Everstats';

const TITLES = [
  [/^\/$/, null], // the home page / dashboard: just "Everstats"
  [/^\/leaderboards\/?$/, 'Leaderboards'],
  [/^\/leaderboards\/gold\/[^/]+\/[^/]+\/?$/, 'Gold leaderboard'],
  [/^\/leaderboards\/guilds\/[^/]+\/[^/]+\/share\/?$/, 'Share card'],
  [/^\/leaderboards\/guilds\/[^/]+\/[^/]+\/?$/, 'Guild leaderboard'],
  [/^\/leaderboards\/[^/]+\/[^/]+\/share\/?$/, 'Share card'],
  [/^\/leaderboards\/[^/]+\/[^/]+\/?$/, 'Leaderboard'],
  [/^\/tiers\/how\/?$/, 'How tiers work'],
  [/^\/tiers\/?$/, 'Tier boards'],
  [/^\/guilds\/?$/, 'Guilds'],
  [/^\/guild-badges\/?$/, 'Guild badges'],
  [/^\/guild-badges\/[^/]+\/?$/, 'Guild badge'],
  [/^\/badges\/[^/]+\/?$/, 'Badge'],
  [/^\/c\/[^/]+\/(share|tier\/share|collections\/share)\/?$/, 'Share card'],
  [/^\/c\/[^/]+\/collections(\/[^/]+)?\/?$/, 'Collections'],
  [/^\/c\/[^/]+\/?$/, 'Character'],
  [/^\/g\/[^/]+\/share\/?$/, 'Share card'],
  [/^\/g\/[^/]+\/manage\/badges\/?$/, 'Manage guild badges'],
  [/^\/g\/[^/]+\/boards\/[^/]+\/?$/, 'Guild members board'],
  [/^\/g\/[^/]+\/?$/, 'Guild'],
  [/^\/u\/[^/]+\/?$/, 'Profile'],
  [/^\/search\/?$/, 'Search'],
  [/^\/sign-in\/2fa\/?$/, 'Two-step check'],
  [/^\/sign-in\/?$/, 'Sign in'],
  [/^\/settings\/merge\/?$/, 'Merge accounts'],
  [/^\/settings\/feedback\/?$/, 'Your feedback'],
  [/^\/settings\/?$/, 'Settings'],
  [/^\/feedback\/?$/, 'Feedback'],
  [/^\/changelog\/?$/, 'What’s new'],
  [/^\/beta\/?$/, 'The beta'],
  [/^\/privacy\/?$/, 'Privacy'],
  [/^\/banned\/?$/, 'Account suspended'],
  [/^\/admin\/sign-in\/?$/, 'Admin sign-in'],
  [/^\/admin\/enroll\/?$/, 'Admin enrolment'],
  // 0.10.3: every other admin address is the v5 admin shell, which names each page from its own registry
  // (client/src/admin/shell/nav.js PAGES) once it loads, e.g. "Tiers · Admin".
  [/^\/admin(\/.*)?$/, 'Admin'],
];

/** The fixed title of a path: a string, null (the home page: the site's name alone), or undefined (no entry: Not found). */
export function pageTitleFor(pathname) {
  for (const [re, title] of TITLES) if (re.test(pathname)) return title;
  // 0.11.1: a game version's pages live under /{version}/{region}/… with the same names (core/versionRoutes.js); a
  // character or guild there is two segments (realm, name). The same table names them.
  const m = VERSION_PREFIX.exec(String(pathname ?? ''));
  if (!m) return undefined;
  const rest = m[1].replace(TWO_SEGMENTS, '/$1/$2~$3');
  for (const [re, title] of TITLES) if (VERSION_PAGE.test(rest) && re.test(rest)) return title;
  return undefined;
}
const VERSION_PREFIX = /^\/[a-z0-9-]{2,32}\/[a-z]{2}(\/.+)$/;
const VERSION_PAGE = /^\/(?:c|g|leaderboards|guilds|tiers)(?:\/|$)/;
const TWO_SEGMENTS = /^\/(c|g)\/([^/]+)\/([^/]+)/;

/** "<title> · Everstats", or the site's name alone. */
export const fullTitle = (title) => (title ? `${title} · ${SITE_NAME}` : SITE_NAME);
