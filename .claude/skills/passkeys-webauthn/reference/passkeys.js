// Thin wrappers that run one WebAuthn ceremony end to end: fetch options from
// the backend, hand them to the browser's authenticator via
// @simplewebauthn/browser (navigator.credentials.create/get), then send the
// signed result back to be verified server-side.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api, ApiError } from './api.js';

export const passkeysSupported = browserSupportsWebAuthn;

export async function signInWithPasskey() {
  const optionsJSON = await api.passkeys.loginOptions();
  const credential = await startAuthentication({ optionsJSON });
  return api.passkeys.loginVerify(credential);
}

export async function verifyWithPasskey() {
  const optionsJSON = await api.passkeys.twoFactorOptions();
  const credential = await startAuthentication({ optionsJSON });
  return api.passkeys.twoFactorVerify(credential);
}

export async function registerPasskey(totpCode, name) {
  const optionsJSON = await api.passkeys.registerOptions(totpCode);
  const credential = await startRegistration({ optionsJSON });
  return api.passkeys.registerVerify(name, credential);
}

// The user dismissing the browser's passkey dialog surfaces as a
// NotAllowedError - not worth an alarming message.
export function passkeyErrorMessage(err, fallback) {
  if (err instanceof ApiError) return err.message;
  if (err?.name === 'NotAllowedError') return 'Passkey request was cancelled or timed out.';
  if (err?.name === 'InvalidStateError') return 'This authenticator is already registered for your account.';
  return fallback;
}
