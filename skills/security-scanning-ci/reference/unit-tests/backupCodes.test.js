import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBackupCodes, normalizeBackupCode } from '../src/utils/backupCodes.js';
import { verifySecret } from '../src/utils/password.js';
import { looksLikeBackupCode } from '../src/services/twofa.service.js';

test('ten unique codes in XXXX-XXXX form without ambiguous characters', async () => {
  const { plainCodes } = await generateBackupCodes();
  assert.equal(plainCodes.length, 10);
  assert.equal(new Set(plainCodes).size, 10);
  for (const code of plainCodes) {
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  }
});

test('only bcrypt hashes are produced for storage, and each verifies its own code', async () => {
  const { plainCodes, hashedCodes } = await generateBackupCodes();
  assert.ok(hashedCodes.every((h) => h.startsWith('$2')));
  assert.ok(hashedCodes.every((h, i) => !h.includes(plainCodes[i])));
  assert.equal(await verifySecret(plainCodes[0], hashedCodes[0]), true);
  assert.equal(await verifySecret(plainCodes[0], hashedCodes[1]), false);
});

test('normalisation tolerates case and whitespace', () => {
  assert.equal(normalizeBackupCode('  abcd-efgh '), 'ABCD-EFGH');
  assert.equal(normalizeBackupCode('ab cd-ef gh'), 'ABCD-EFGH');
});

test('backup codes are told apart from 6-digit TOTP codes', () => {
  assert.equal(looksLikeBackupCode('ABCD-EFGH'), true);
  assert.equal(looksLikeBackupCode('abcdefgh'), true);
  assert.equal(looksLikeBackupCode('123456'), false);
});
