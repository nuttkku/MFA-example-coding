import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changePasswordSchema,
  listUsersQuerySchema,
  loginSchema,
  passkeyAssertionSchema,
  userIdParamSchema,
} from '../src/validators/schemas.js';

test('password policy: length 10-128, needs a letter and a number', () => {
  const check = (newPassword) => changePasswordSchema.safeParse({ currentPassword: 'x', newPassword }).success;
  assert.equal(check('abcdefghi1'), true);
  assert.equal(check('short1'), false);
  assert.equal(check('onlyletters'), false);
  assert.equal(check('1234567890'), false);
  assert.equal(check('a1'.repeat(65)), false); // 130 chars - bcrypt would silently truncate past 72 bytes
});

test('login caps input length', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success, false);
});

test('user id must be a UUID', () => {
  assert.equal(userIdParamSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success, true);
  assert.equal(userIdParamSchema.safeParse('1 OR 1=1').success, false);
});

test('search query must be a plain string (no arrays/objects from qs)', () => {
  assert.equal(listUsersQuerySchema.safeParse({ search: 'ann' }).success, true);
  assert.equal(listUsersQuerySchema.safeParse({}).success, true);
  assert.equal(listUsersQuerySchema.safeParse({ search: ['a', 'b'] }).success, false);
  assert.equal(listUsersQuerySchema.safeParse({ search: { $ne: '' } }).success, false);
});

test('passkey credential shape check (zod 4 record) accepts valid JSON and rejects junk', () => {
  const credential = {
    id: 'abc_DEF-123',
    rawId: 'abc_DEF-123',
    type: 'public-key',
    response: { clientDataJSON: 'xyz', authenticatorData: 'xyz', signature: 'xyz' },
  };
  const ok = passkeyAssertionSchema.safeParse({ credential });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data.credential.clientExtensionResults, {});
  assert.equal(passkeyAssertionSchema.safeParse({ credential: { ...credential, id: 'has spaces!' } }).success, false);
  assert.equal(passkeyAssertionSchema.safeParse({ credential: { ...credential, type: 'password' } }).success, false);
});
