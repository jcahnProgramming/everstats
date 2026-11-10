/**
 * The credentials registry: every key the app uses declares itself here, and the admin key manager renders whatever
 * is registered. A new integration adds a declaration; nothing about providers is hardcoded in the UI or the routes.
 *
 * Declaration:
 *   id        stable name (bound into the encryption slot: never rename one that shipped)
 *   label     what the admin sees
 *   unlocks   one line: what works once it is set
 *   obtain    { url, steps[] }: where to get one
 *   fields    [{ name, label, env, validate?(value) → problem | null }]. Every field is sealed with the root key and is
 *             never sent to a browser: the admin sees "set on <date>" and a mask, nothing else.
 *   test      optional { does, run(values, { fetch }) → { ok, message } }: a free, read-only check
 *
 * Resolution (credentials/store.js): database → .env (each field's `env`) → "not configured". The app never writes .env.
 */
import { config } from '../core/config.js';

const plausible = (label, min) => (v) => {
  if (/\s/.test(v)) return `${label} can't contain spaces`;
  if (v.length < min) return `${label} looks too short`;
  if (v.length > 200) return `${label} looks too long`;
  return null;
};

/** Asks a token endpoint for a client-credentials token and throws it away: proves the pair works, reads nothing. */
const clientCredentialsTest = ({ url, scope }) => ({
  does: 'Asks the provider for an app token with these keys, then discards it. Reads no data.',
  async run(values, { fetch = globalThis.fetch } = {}) {
    const body = new URLSearchParams({ grant_type: 'client_credentials', ...(scope ? { scope } : {}) });
    const basic = Buffer.from(`${encodeURIComponent(values.clientId)}:${encodeURIComponent(values.clientSecret)}`).toString('base64');
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { ok: false, message: "Couldn't reach the provider. Check the server's internet connection." };
    }
    if (res.ok) return { ok: true, message: 'The provider accepted these keys.' };
    if (res.status === 400 || res.status === 401) return { ok: false, message: 'The provider refused these keys (wrong client ID or secret).' };
    return { ok: false, message: `The provider answered ${res.status}. Try again later.` };
  },
});

export const CREDENTIALS = [
  {
    id: 'blizzard',
    label: 'Blizzard (Battle.net) API client',
    unlocks: 'Battle.net sign-in, character lookups, statistics, leaderboards, collections, guild pages and the crawler',
    obtain: {
      url: 'https://develop.battle.net/access/clients',
      steps: [
        'develop.battle.net → API Access → Create Client, signed in with the Battle.net account that owns Everstats.',
        `Redirect URLs: ${config.publicOrigin}/auth/battlenet/callback (plus http://localhost:3000/auth/battlenet/callback for development).`,
        'Copy the Client ID and Client Secret here.',
      ],
    },
    fields: [
      { name: 'clientId', label: 'Client ID', env: 'BLIZZARD_CLIENT_ID', validate: plausible('The client ID', 16) },
      { name: 'clientSecret', label: 'Client secret', env: 'BLIZZARD_CLIENT_SECRET', validate: plausible('The client secret', 16) },
    ],
    test: clientCredentialsTest({ url: 'https://oauth.battle.net/token' }),
  },
  {
    id: 'discord',
    label: 'Discord OAuth application',
    unlocks: 'Discord sign-in',
    obtain: {
      url: 'https://discord.com/developers/applications',
      steps: [
        'discord.com/developers/applications → New Application → OAuth2.',
        `Redirects: ${config.publicOrigin}/auth/discord/callback (plus http://localhost:3000/auth/discord/callback for development).`,
        'Copy the Client ID, and the Client Secret (Reset Secret shows it once), here.',
      ],
    },
    fields: [
      { name: 'clientId', label: 'Client ID', env: 'DISCORD_CLIENT_ID', validate: (v) => (/^\d{15,25}$/.test(v) ? null : 'A Discord client ID is a long number') },
      { name: 'clientSecret', label: 'Client secret', env: 'DISCORD_CLIENT_SECRET', validate: plausible('The client secret', 20) },
    ],
    test: clientCredentialsTest({ url: 'https://discord.com/api/oauth2/token', scope: 'identify' }),
  },
];

const byId = new Map(CREDENTIALS.map((c) => [c.id, c]));

export function getCredential(id) {
  return byId.get(id) ?? null;
}
