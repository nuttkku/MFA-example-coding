import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';
import { encryptSecret, decryptSecret } from '../src/utils/crypto.js';

// A freshly generated base32 TOTP seed per run - the same kind of value the
// app stores - rather than a literal that scanners read as a hardcoded secret.
const sample = authenticator.generateSecret();

test('TOTP secret round-trips through AES-256-GCM', () => {
  assert.equal(decryptSecret(encryptSecret(sample)), sample);
});

test('every encryption uses a fresh IV', () => {
  assert.notEqual(encryptSecret(sample), encryptSecret(sample));
});

test('tampered ciphertext is rejected by the auth tag', () => {
  const [iv, tag, ct] = encryptSecret(sample).split('.');
  const bytes = Buffer.from(ct, 'base64');
  bytes[0] ^= 0xff;
  assert.throws(() => decryptSecret([iv, tag, bytes.toString('base64')].join('.')));
});

test('a truncated auth tag is refused before decryption (truncated-tag forgery)', () => {
  const [iv, tag, ct] = encryptSecret(sample).split('.');
  const shortTag = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
  assert.throws(() => decryptSecret([iv, shortTag, ct].join('.')), /Invalid auth tag length/);
});
