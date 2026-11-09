/**
 * The sign-in provider registry. Each provider declares itself; the auth routes, Settings and the sign-in page work
 * from whatever is listed here, and nothing else in the code names a provider. Adding one is a declaration here plus
 * a credential in credentials/registry.js.
 *
 * Declaration:
 *   id            stable id, stored in account_identities.provider and in the callback path (/auth/<id>/callback)
 *   label         what people see ("Battle.net")
 *   credential    the credentials/registry.js id holding { clientId, clientSecret }
 *   authorizeUrl, tokenUrl
 *   scopes        what is asked for, and why (scopeReason, shown nowhere yet but kept honest here)
 *   pkce          true only where the provider's docs say it supports PKCE
 *   identity(accessToken, { fetch }) → { subject, displayName }: who signed in. subject is the provider's stable id.
 *
 * Verified against the providers' docs on 2026-11-08:
 *   Battle.net (community.developer.battle.net, "Authorization Code Flow"): authorize and token on oauth.battle.net,
 *     client authenticated with HTTP Basic, `state` round-tripped, tokens last ~24 h (expires_in 86399, no refresh
 *     token documented), GET https://oauth.battle.net/userinfo with a Bearer token returns the account id and
 *     BattleTag. PKCE is not documented, so it is not sent.
 *   Discord (docs.discord.com, "OAuth2"): authorize discord.com/oauth2/authorize, token discord.com/api/oauth2/token
 *     (form-encoded; Basic or body credentials), scope `identify` gives /users/@me without email. PKCE is not
 *     documented on that page, so it is not sent.
 */
const json = async (res) => {
  if (!res.ok) throw Object.assign(new Error(`identity request failed (${res.status})`), { code: 'identity_failed' });
  return res.json();
};

export const PROVIDERS = [
  {
    id: 'battlenet',
    label: 'Battle.net',
    credential: 'blizzard',
    authorizeUrl: 'https://oauth.battle.net/authorize',
    tokenUrl: 'https://oauth.battle.net/token',
    // openid: makes /userinfo (the account id and BattleTag) well defined. wow.profile: later, "add all my Forever
    // characters" reads /profile/user/wow with this sign-in's token.
    scopes: ['openid', 'wow.profile'],
    pkce: false,
    async identity(accessToken, { fetch = globalThis.fetch } = {}) {
      const body = await json(await fetch('https://oauth.battle.net/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }));
      const subject = String(body.sub ?? body.id ?? '');
      if (!subject) throw Object.assign(new Error('Battle.net returned no account id'), { code: 'identity_failed' });
      return { subject, displayName: String(body.battletag ?? '').slice(0, 100) };
    },
  },
  {
    id: 'discord',
    label: 'Discord',
    credential: 'discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    // identify: the user's id and name, without their email. We never ask for email.
    scopes: ['identify'],
    pkce: false,
    async identity(accessToken, { fetch = globalThis.fetch } = {}) {
      const body = await json(await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      }));
      const subject = String(body.id ?? '');
      if (!/^\d{5,25}$/.test(subject)) throw Object.assign(new Error('Discord returned no user id'), { code: 'identity_failed' });
      return { subject, displayName: String(body.global_name || body.username || '').slice(0, 100) };
    },
  },
];

const byId = new Map(PROVIDERS.map((p) => [p.id, p]));
export const getProvider = (id) => byId.get(id) ?? null;
