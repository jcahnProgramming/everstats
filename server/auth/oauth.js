import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../core/config.js';

/**
 * The authorization code flow, the same for every provider in auth/providers.js:
 *   1. authorizeUrl(): state (random, kept in the browser's auth flow) and, where declared, PKCE
 *   2. the provider redirects to /auth/<id>/callback?code&state
 *   3. exchange(): POST tokenUrl, form-encoded, client authenticated with HTTP Basic (both Battle.net and Discord
 *      accept it), redirect_uri repeated exactly
 *   4. provider.identity(accessToken) → { subject, displayName }
 * The access token is used for that one identity request and then dropped: nothing stores it yet.
 */
export const callbackUrl = (provider) => `${config.publicOrigin}/auth/${provider.id}/callback`;

export function newOAuthState(provider) {
  const state = randomBytes(24).toString('base64url');
  const verifier = provider.pkce ? randomBytes(32).toString('base64url') : null;
  return { state, verifier };
}

export function authorizeUrl(provider, clientId, { state, verifier }) {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl(provider));
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  if (verifier) {
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export function sameState(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Exchanges the code for an access token. Throws { code: 'token_failed' } on anything but success. */
export async function exchange(provider, credentials, code, verifier, deps = {}) {
  return (await exchangeForToken(provider, credentials, code, verifier, deps)).access_token;
}

/** The same exchange, returning the whole token response ({ access_token, expires_in, scope, … }). */
export async function exchangeForToken(provider, { clientId, clientSecret }, code, verifier, { fetch = globalThis.fetch } = {}) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(provider) });
  if (verifier) body.set('code_verifier', verifier);
  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
  let res;
  try {
    res = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw Object.assign(new Error('token request failed'), { code: 'token_failed' });
  }
  const json = res.ok ? await res.json().catch(() => null) : null;
  if (!json?.access_token) throw Object.assign(new Error(`token request refused (${res.status})`), { code: 'token_failed' });
  return json;
}
