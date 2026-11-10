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
  [/^\/admin\/discovery\/?$/, 'Discovery · Admin'],
  [/^\/admin\/tiers\/?$/, 'Tiers · Admin'],
  [/^\/admin\/badges\/?$/, 'Badges · Admin'],
  [/^\/admin\/guild-badges\/?$/, 'Guild badges · Admin'],
  [/^\/admin\/guild-links\/?$/, 'Guild links · Admin'],
  [/^\/admin\/feedback\/?$/, 'Feedback · Admin'],
  [/^\/admin\/accounts\/[^/]+\/?$/, 'Account · Admin'],
  [/^\/admin\/accounts\/?$/, 'Accounts · Admin'],
  [/^\/admin\/reports\/?$/, 'Reports · Admin'],
  [/^\/admin\/?$/, 'Admin'],
];

/** The fixed title of a path: a string, null (the home page: the site's name alone), or undefined (no entry: Not found). */
export function pageTitleFor(pathname) {
  for (const [re, title] of TITLES) if (re.test(pathname)) return title;
  return undefined;
}

/** "<title> · Everstats", or the site's name alone. */
export const fullTitle = (title) => (title ? `${title} · ${SITE_NAME}` : SITE_NAME);
