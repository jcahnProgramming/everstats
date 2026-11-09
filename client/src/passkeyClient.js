import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api.js';

export const passkeysSupported = () => browserSupportsWebAuthn();

/** Runs a passkey ceremony against an options + verify endpoint pair. Resolves to the verify answer. */
export async function passkeySignIn(optionsPath, verifyPath, extra = {}) {
  const { options } = await api(optionsPath, { method: 'POST', body: extra });
  const response = await startAuthentication({ optionsJSON: options });
  return api(verifyPath, { method: 'POST', body: { response } });
}

export async function passkeyRegister(optionsPath, verifyPath, body = {}) {
  const { options } = await api(optionsPath, { method: 'POST', body: body.optionsBody ?? {} });
  const response = await startRegistration({ optionsJSON: options });
  return api(verifyPath, { method: 'POST', body: { response, ...body.verifyBody } });
}

/** A browser's "user cancelled" or "timed out" is not an error worth alarming anyone about. */
export const wasCancelled = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';
