import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { pool } from '../config/db.js';
import { uuidSchema } from '../validators/schemas.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// How long a started ceremony stays valid server-side; the browser-side
// timeout passed to the authenticator is a little shorter.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;

const PUBLIC_COLUMNS = 'id, name, device_type, backed_up, transports, created_at, last_used_at';

// The WebAuthn user handle must not contain personal data (WebAuthn s.14.6.1),
// so use the account's random UUID rather than the email address.
function userHandleFor(userId) {
  return isoUint8Array.fromUTF8String(userId);
}

// --- Challenges -------------------------------------------------------------

export async function createChallenge({ userId = null, purpose, challenge }) {
  // Opportunistic cleanup of abandoned ceremonies, so the table can't grow
  // without bound from people who request options and never finish.
  await pool.query('DELETE FROM webauthn_challenges WHERE expires_at < now()');
  const { rows } = await pool.query(
    `INSERT INTO webauthn_challenges (user_id, purpose, challenge, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)
     RETURNING id`,
    [userId, purpose, challenge, CHALLENGE_TTL_MS],
  );
  return rows[0].id;
}

// Deletes and returns the challenge in one statement: a challenge can be used
// for exactly one verification attempt, success or failure, and two concurrent
// requests carrying the same cookie can't both get it.
export async function consumeChallenge(challengeId, purpose) {
  // Malformed cookie -> just "expired", not a Postgres invalid-uuid error (500).
  if (!uuidSchema.safeParse(challengeId).success) return null;
  const { rows } = await pool.query(
    `DELETE FROM webauthn_challenges
     WHERE id = $1 AND purpose = $2 AND expires_at > now()
     RETURNING challenge, user_id`,
    [challengeId, purpose],
  );
  return rows[0] ?? null;
}

// --- Credentials ------------------------------------------------------------

export async function listCredentials(userId) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows;
}

export async function hasCredentials(userId) {
  const { rows } = await pool.query('SELECT 1 FROM webauthn_credentials WHERE user_id = $1 LIMIT 1', [userId]);
  return rows.length > 0;
}

export async function deleteCredential(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  return rowCount === 1;
}

async function findByCredentialId(credentialId) {
  const { rows } = await pool.query('SELECT * FROM webauthn_credentials WHERE credential_id = $1', [credentialId]);
  return rows[0] ?? null;
}

// --- Registration (WebAuthn s.7.1) -----------------------------------------

export async function buildRegistrationOptions(user) {
  const existing = await pool.query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [
    user.id,
  ]);
  return generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userID: userHandleFor(user.id),
    userName: user.email,
    userDisplayName: user.full_name,
    timeout: CEREMONY_TIMEOUT_MS,
    // No attestation: this app doesn't restrict which authenticator models
    // may be used, and asking for it only adds a privacy prompt.
    attestationType: 'none',
    // supportedAlgorithmIDs left at SimpleWebAuthn's default: EdDSA (-8),
    // ES256 (-7) and RS256 (-257) - COSE algorithm ids from RFC 9053/RFC 8812 -
    // plus ML-DSA-44 first when the Node runtime supports it.
    // Stops the same authenticator being registered twice for one account.
    excludeCredentials: existing.rows.map((row) => ({ id: row.credential_id, transports: row.transports })),
    authenticatorSelection: {
      // A discoverable credential is what makes username-less passkey login
      // possible; user verification (biometric/PIN) is what lets a passkey
      // count as multi-factor on its own.
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

// Returns the stored credential's public fields, or null if verification failed.
export async function verifyAndStoreRegistration(user, response, expectedChallenge, name) {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn(`Passkey registration rejected: ${err.message}`);
    return null;
  }
  if (!verification.verified) return null;

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const { rows } = await pool.query(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, sign_count, transports, device_type, backed_up, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (credential_id) DO NOTHING
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      user.id,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ?? [],
      credentialDeviceType,
      credentialBackedUp,
      name,
    ],
  );
  return rows[0] ?? null;
}

// --- Authentication (WebAuthn s.7.2) ---------------------------------------

// Passwordless: no allowCredentials, so the authenticator offers whichever
// discoverable credential it holds for this RP. Second factor: limited to the
// already-identified user's own credentials.
export async function buildAuthenticationOptions({ userId = null, userVerification }) {
  let allowCredentials;
  if (userId) {
    const { rows } = await pool.query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1', [
      userId,
    ]);
    allowCredentials = rows.map((row) => ({ id: row.credential_id, transports: row.transports }));
  }
  return generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    timeout: CEREMONY_TIMEOUT_MS,
    allowCredentials,
    userVerification,
  });
}

// Verifies an assertion. Returns the owning user id on success, or null. When
// expectedUserId is given (second-factor use) the credential must belong to
// that user.
export async function verifyAuthentication(response, expectedChallenge, { expectedUserId = null, requireUserVerification }) {
  const record = typeof response?.id === 'string' ? await findByCredentialId(response.id) : null;
  if (!record) return { userId: null, reason: 'unknown_credential' };
  if (expectedUserId && record.user_id !== expectedUserId) return { userId: null, reason: 'wrong_user' };

  // For a discoverable credential the authenticator also returns the user
  // handle it stored at registration; it must match the credential's owner.
  const userHandle = response.response?.userHandle;
  if (userHandle && isoUint8Array.toUTF8String(isoBase64URL.toBuffer(userHandle)) !== record.user_id) {
    return { userId: null, reason: 'user_handle_mismatch', ownerId: record.user_id };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      credential: {
        id: record.credential_id,
        publicKey: new Uint8Array(record.public_key),
        counter: Number(record.sign_count),
        transports: record.transports,
      },
      requireUserVerification,
    });
  } catch (err) {
    // Includes a signature counter that did not increase (possible cloned
    // authenticator), which SimpleWebAuthn rejects.
    logger.warn(`Passkey assertion rejected: ${err.message}`);
    return { userId: null, reason: 'verification_failed', ownerId: record.user_id };
  }
  if (!verification.verified) return { userId: null, reason: 'verification_failed', ownerId: record.user_id };

  await pool.query(
    `UPDATE webauthn_credentials SET sign_count = $2, backed_up = $3, last_used_at = now() WHERE id = $1`,
    [record.id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp],
  );
  return { userId: record.user_id, credentialName: record.name };
}
