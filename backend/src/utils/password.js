import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashSecret(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifySecret(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

// Not a real credential - used only so callers can run a bcrypt comparison of
// the usual cost when there is no real hash to compare against (unknown email,
// SSO-only account with no local password), keeping response timing consistent
// with a genuine wrong-password check and avoiding a user-enumeration oracle.
// Generated at startup from random bytes (same cost factor as real hashes), so
// no hash literal lives in the source and nobody can know a matching password.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), SALT_ROUNDS);
