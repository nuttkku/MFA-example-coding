import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/utils/crypto.js';

test('TOTP secret round-trips through AES-256-GCM', () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  assert.equal(decryptSecret(encryptSecret(secret)), secret);
});

test('every encryption uses a fresh IV', () => {
  assert.notEqual(encryptSecret('same'), encryptSecret('same'));
});

test('tampered ciphertext is rejected by the auth tag', () => {
  const [iv, tag, ct] = encryptSecret('JBSWY3DPEHPK3PXP').split('.');
  const bytes = Buffer.from(ct, 'base64');
  bytes[0] ^= 0xff;
  assert.throws(() => decryptSecret([iv, tag, bytes.toString('base64')].join('.')));
});

test('a truncated auth tag is refused before decryption (truncated-tag forgery)', () => {
  const [iv, tag, ct] = encryptSecret('JBSWY3DPEHPK3PXP').split('.');
  const shortTag = Buffer.from(tag, 'base64').subarray(0, 4).toString('base64');
  assert.throws(() => decryptSecret([iv, shortTag, ct].join('.')), /Invalid auth tag length/);
});
