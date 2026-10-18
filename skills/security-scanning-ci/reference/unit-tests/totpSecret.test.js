import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOTP_SECRET_BYTES, generateTotpSecret } from '../src/services/twofa.service.js';

test('new TOTP secrets carry 160 bits (RFC 4226 s.4), not otplib 12 default 80', () => {
  assert.equal(TOTP_SECRET_BYTES, 20);
  const secret = generateTotpSecret();
  // base32: 5 bits per character, so 20 bytes -> 32 characters.
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(generateTotpSecret(), secret);
});
