import { betaState } from '../beta.js';

/**
 * "Why sign in?" (0.8.0): what an account gives a signed-out visitor, on the home page. ALL the wording is here, in
 * one place, so the owner can tweak it; each benefit says when it is live (`live(ctx)`), so a line only shows while
 * the feature behind it really works (the Beta Tester line disappears by itself when the beta window closes). Add a
 * benefit by adding an entry; the page iterates this list.
 *
 * `ctx`: { beta: betaState, badges: number of badge definitions, battlenet: whether Battle.net sign-in is configured }
 */
export const BENEFITS = [
  {
    id: 'characters',
    title: 'Your characters, added automatically',
    text: 'Sign in with Battle.net and every Forever character on your account (level 10 and up) is added, and your guildmates join through your guild’s roster.',
    live: (ctx) => ctx.battlenet,
  },
  {
    id: 'username',
    title: 'Claim your username',
    text: 'Pick your name before someone else does, and get a public profile at everstats.app/u/{you}.',
    live: () => true,
  },
  {
    id: 'dashboard',
    title: 'Your dashboard',
    text: 'Pin the statistics you care about and follow your ranks on them.',
    live: () => true,
  },
  {
    id: 'badges',
    title: 'Badges',
    text: 'Earn class, faction and achievement badges, and choose which ones show.',
    live: (ctx) => ctx.badges > 0,
  },
  {
    id: 'beta',
    title: 'The Beta Tester badge',
    text: 'Only for accounts made while the beta is open. It closes for good when the beta ends.',
    live: (ctx) => ctx.beta.open,
  },
  {
    id: 'themes',
    title: 'Themes',
    text: 'Switch Everstats between Forever, Alliance and Horde.',
    live: () => true,
  },
  {
    id: 'privacy',
    title: 'Control what’s public',
    text: 'Hide any of your characters, or just its render.',
    live: () => true,
  },
  {
    id: 'guilds',
    title: 'Guild Masters run their guild page',
    text: 'Add your Discord, links and badge choices, and name your officers.',
    live: () => true,
  },
  {
    id: 'cards',
    title: 'Your own share card',
    text: 'Design your character’s card and save it as your default and your link preview.',
    live: () => true,
  },
  {
    id: 'feedback',
    title: 'Replies to your feedback',
    text: 'Send feedback and read the replies right here on Everstats.',
    live: () => true,
  },
];

export const NOTE = 'Battle.net is the one that brings your characters in. Signing in with Discord alone doesn’t.';

/** The live benefits and the real counts behind "{N} characters and {M} guilds tracked". */
export async function whySignIn(db, { battlenet }) {
  const ctx = {
    beta: await betaState(db),
    badges: (await db.one('SELECT count(*)::int AS n FROM badge_definitions')).n,
    battlenet,
  };
  const counts = await db.one(
    `SELECT count(*)::int AS characters, count(DISTINCT guild_id)::int AS guilds
       FROM characters WHERE stats_fetched_at IS NOT NULL AND NOT hidden AND missing_since IS NULL AND profile_state = 'ok'`,
  );
  return {
    benefits: BENEFITS.filter((b) => b.live(ctx)).map(({ id, title, text }) => ({ id, title, text })),
    note: NOTE,
    counts: { characters: counts.characters, guilds: counts.guilds },
  };
}
