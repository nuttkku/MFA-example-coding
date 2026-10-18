import { asyncHandler } from '../utils/asyncHandler.js';
import { UnauthorizedError, ForbiddenError, ValidationError, NotFoundError } from '../utils/errors.js';
import { twoFaCodeSchema, passkeyRegisterSchema, passkeyAssertionSchema, uuidSchema } from '../validators/schemas.js';
import { findById, resetFailedTwoFactor } from '../services/user.service.js';
import { recordEvent } from '../services/audit.service.js';
import {
  issueFullSession,
  issueWebauthnChallengeCookie,
  readWebauthnChallengeCookie,
  clearWebauthnChallengeCookie,
} from '../services/token.service.js';
import {
  CHALLENGE_TTL_MS,
  createChallenge,
  consumeChallenge,
  listCredentials,
  hasCredentials,
  deleteCredential,
  buildRegistrationOptions,
  verifyAndStoreRegistration,
  buildAuthenticationOptions,
  verifyAuthentication,
} from '../services/passkey.service.js';
import { loadPreAuthUser, recordTwoFactorFailure, requireTotpStepUp } from './auth.controller.js';

async function startCeremony(res, { userId, purpose, options }) {
  const challengeId = await createChallenge({ userId, purpose, challenge: options.challenge });
  issueWebauthnChallengeCookie(res, challengeId, CHALLENGE_TTL_MS);
  return options;
}

// Every finish step consumes the challenge first, whatever happens next - a
// challenge is good for exactly one attempt.
async function finishCeremony(req, res, purpose) {
  const challenge = await consumeChallenge(readWebauthnChallengeCookie(req), purpose);
  clearWebauthnChallengeCookie(res);
  if (!challenge) throw new UnauthorizedError('Passkey request expired, please try again');
  return challenge;
}

// --- Managing your own passkeys (full session) ------------------------------

export const list = asyncHandler(async (req, res) => {
  res.json({ passkeys: await listCredentials(req.user.id) });
});

// Registering a passkey creates a credential that can sign in with no password
// and no TOTP code, so it gets the same TOTP step-up as regenerating backup
// codes - a stolen session cookie must not be able to plant its own passkey.
export const startRegistration = asyncHandler(async (req, res) => {
  const { code } = twoFaCodeSchema.parse(req.body);
  await requireTotpStepUp(req, code, 'passkey_register_stepup_failed');

  const options = await buildRegistrationOptions(req.user);
  res.json(await startCeremony(res, { userId: req.user.id, purpose: 'register', options }));
});

export const finishRegistration = asyncHandler(async (req, res) => {
  const { name, credential } = passkeyRegisterSchema.parse(req.body);
  const challenge = await finishCeremony(req, res, 'register');
  // The challenge row is the proof the step-up above happened - and for this user.
  if (challenge.user_id !== req.user.id) throw new UnauthorizedError('Passkey request expired, please try again');

  const passkey = await verifyAndStoreRegistration(req.user, credential, challenge.challenge, name);
  if (!passkey) {
    await recordEvent({ userId: req.user.id, eventType: 'passkey_register_failed', ipAddress: req.ip });
    throw new ValidationError('Passkey could not be verified');
  }

  await recordEvent({
    userId: req.user.id,
    eventType: 'passkey_registered',
    ipAddress: req.ip,
    metadata: { passkeyId: passkey.id, name: passkey.name, deviceType: passkey.device_type },
  });
  res.status(201).json({ passkey });
});

export const remove = asyncHandler(async (req, res) => {
  const parsed = uuidSchema.safeParse(req.params.id);
  if (!parsed.success || !(await deleteCredential(req.user.id, parsed.data.toLowerCase()))) {
    throw new NotFoundError('Passkey not found');
  }
  await recordEvent({
    userId: req.user.id,
    eventType: 'passkey_deleted',
    ipAddress: req.ip,
    metadata: { passkeyId: parsed.data.toLowerCase() },
  });
  res.json({ ok: true });
});

// --- Passwordless login (no prior step) -------------------------------------
//
// A passkey asserted with user verification (UV flag set: the authenticator
// checked a biometric or PIN) is itself multi-factor - something you have (the
// device holding the private key) plus something you are/know - which is why
// this path may issue a full session directly. requireUserVerification makes
// that a hard check on the signed authenticator data, not a request the client
// could ignore.

export const startLogin = asyncHandler(async (req, res) => {
  const options = await buildAuthenticationOptions({ userVerification: 'required' });
  res.json(await startCeremony(res, { userId: null, purpose: 'login', options }));
});

export const finishLogin = asyncHandler(async (req, res) => {
  const { credential } = passkeyAssertionSchema.parse(req.body);
  const challenge = await finishCeremony(req, res, 'login');

  const result = await verifyAuthentication(credential, challenge.challenge, { requireUserVerification: true });
  if (!result.userId) {
    await recordEvent({
      userId: result.ownerId ?? null,
      eventType: 'passkey_login_failed',
      ipAddress: req.ip,
      metadata: { reason: result.reason },
    });
    throw new UnauthorizedError('Passkey sign-in failed');
  }

  // Same account checks as every other path. The password lockout is not
  // checked, for the same reason it isn't for SSO: anyone who knows the email
  // can trigger it, and it would let them lock the owner out of passkeys too.
  const user = await findById(result.userId);
  if (!user || user.status === 'disabled') {
    throw new ForbiddenError('This account has been disabled. Contact an administrator.');
  }
  // Can't normally happen (an admin 2FA reset deletes the passkeys too), but a
  // passkey must never become a way to hold a session without TOTP set up as
  // the recovery factor.
  if (!user.totp_enabled) throw new ForbiddenError('2FA must be set up before signing in with a passkey');

  await resetFailedTwoFactor(user.id);
  await recordEvent({
    userId: user.id,
    eventType: 'passkey_login_success',
    ipAddress: req.ip,
    metadata: { name: result.credentialName },
  });
  await issueFullSession(req, res, user);
  res.json({ stage: 'complete', mustChangePassword: user.must_change_password });
});

// --- Passkey as the second factor (after password or SSO) -------------------

export const twoFactorMethods = asyncHandler(async (req, res) => {
  const user = await loadPreAuthUser(req);
  res.json({ totp: user.totp_enabled, passkey: await hasCredentials(user.id) });
});

export const startTwoFactor = asyncHandler(async (req, res) => {
  const user = await loadPreAuthUser(req);
  if (!(await hasCredentials(user.id))) throw new ValidationError('No passkeys registered for this account');

  // The first factor (password/SSO) is already done, so possession of the
  // authenticator is enough here - user verification is asked for but not
  // demanded (all passkeys registered by this app require it anyway).
  const options = await buildAuthenticationOptions({ userId: user.id, userVerification: 'preferred' });
  res.json(await startCeremony(res, { userId: user.id, purpose: '2fa', options }));
});

export const finishTwoFactor = asyncHandler(async (req, res) => {
  const { credential } = passkeyAssertionSchema.parse(req.body);
  const user = await loadPreAuthUser(req);
  const challenge = await finishCeremony(req, res, '2fa');
  if (challenge.user_id !== user.id) throw new UnauthorizedError('Passkey request expired, please try again');

  const result = await verifyAuthentication(credential, challenge.challenge, {
    expectedUserId: user.id,
    requireUserVerification: false,
  });
  if (!result.userId) {
    await recordTwoFactorFailure(req, user, '2fa_passkey_failed');
    throw new ValidationError('Passkey verification failed');
  }

  await resetFailedTwoFactor(user.id);
  await recordEvent({
    userId: user.id,
    eventType: '2fa_passkey_success',
    ipAddress: req.ip,
    metadata: { name: result.credentialName },
  });
  await issueFullSession(req, res, user);
  res.json({ stage: 'complete', mustChangePassword: user.must_change_password });
});
