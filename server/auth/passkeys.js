import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from '../core/config.js';

/**
 * WebAuthn (passkeys), shared by accounts (table `passkeys`) and the admin (`admin_passkeys`). The relying party is
 * the hostname of PUBLIC_ORIGIN (everstats.app, or localhost in dev) and the only accepted origin is PUBLIC_ORIGIN
 * itself. Passkeys are discoverable (resident) credentials, so signing in needs no name typed first.
 *
 * Challenges live in the browser's auth flow (auth/flows.js), used once.
 */
export const RP_NAME = 'Everstats';

export async function registrationOptions({ userId, userName, existing }) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: config.rpId,
    userName,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
}

/** Returns { credentialId, publicKey, counter, transports } for a verified registration, or null. */
export async function verifyRegistration(response, expectedChallenge) {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.publicOrigin,
      expectedRPID: config.rpId,
      requireUserVerification: false,
    });
  } catch {
    return null;
  }
  if (!result.verified) return null;
  const { credential } = result.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: response?.response?.transports ?? credential.transports ?? [],
  };
}

export const authenticationOptions = () => generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'preferred' });

/**
 * Verifies a sign-in assertion against a stored passkey row ({ credential_id, public_key, sign_count, transports }).
 * Returns the new signature counter, or null when it doesn't verify.
 */
export async function verifyAuthentication(response, expectedChallenge, row) {
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.publicOrigin,
      expectedRPID: config.rpId,
      requireUserVerification: false,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.sign_count),
        transports: row.transports,
      },
    });
  } catch {
    return null;
  }
  return result.verified ? result.authenticationInfo.newCounter : null;
}

/** The credential id an assertion claims, if it is well formed. */
export const claimedCredentialId = (response) =>
  typeof response?.id === 'string' && /^[A-Za-z0-9_-]{16,1400}$/.test(response.id) ? response.id : null;
