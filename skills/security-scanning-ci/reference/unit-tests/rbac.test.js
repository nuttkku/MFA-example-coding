import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, roleHasPermission } from '../src/config/permissions.js';
import { requirePermission } from '../src/middleware/rbac.middleware.js';
import { ForbiddenError } from '../src/utils/errors.js';

test('permission matrix', () => {
  assert.deepEqual(PERMISSIONS, {
    'users:read': ['admin', 'manager'],
    'users:write': ['admin'],
    'audit:read': ['admin'],
  });
  assert.equal(roleHasPermission('manager', 'users:read'), true);
  assert.equal(roleHasPermission('manager', 'users:write'), false);
  assert.equal(roleHasPermission('user', 'users:read'), false);
});

test('unknown permissions and roles are denied by default', () => {
  assert.equal(roleHasPermission('admin', 'users:delete'), false);
  assert.equal(roleHasPermission('superadmin', 'users:read'), false);
  assert.equal(roleHasPermission(undefined, 'users:read'), false);
});

test('requirePermission lets an allowed role through', () => {
  let called = false;
  requirePermission('users:write')({ user: { role: 'admin' } }, {}, () => (called = true));
  assert.equal(called, true);
});

test('requirePermission rejects a disallowed role and a missing user', () => {
  const mw = requirePermission('users:write');
  assert.throws(() => mw({ user: { role: 'manager' } }, {}, () => {}), ForbiddenError);
  assert.throws(() => mw({}, {}, () => {}), ForbiddenError);
});
