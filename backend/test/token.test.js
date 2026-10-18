import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  COOKIE_NAMES,
  issueAccessCookie,
  issuePreAuthCookie,
  verifyAccessCookie,
  verifyPreAuthCookie,
} from '../src/services/token.service.js';
import { env } from '../src/config/env.js';
import { UnauthorizedError } from '../src/utils/errors.js';

function fakeRes() {
  const cookies = {};
  return { cookies, cookie: (name, value, options) => (cookies[name] = { value, options }) };
}

const reqWith = (cookies) => ({ cookies });

test('access cookie is httpOnly, SameSite=Lax and verifies', () => {
  const res = fakeRes();
  issueAccessCookie(res, { id: 'u1', role: 'admin' });
  const { value, options } = res.cookies[COOKIE_NAMES.access];
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
  assert.ok(options.maxAge > 0);
  const payload = verifyAccessCookie(reqWith({ [COOKIE_NAMES.access]: value }));
  assert.equal(payload.sub, 'u1');
  assert.equal(payload.role, 'admin');
});

test('a pre-auth token cannot be used as an access token (separate secrets)', () => {
  const res = fakeRes();
  issuePreAuthCookie(res, 'u1', 'verify');
  const preAuth = res.cookies[COOKIE_NAMES.preAuth].value;
  assert.throws(() => verifyAccessCookie(reqWith({ [COOKIE_NAMES.access]: preAuth })), UnauthorizedError);
});

test('a token signed with the right secret but the wrong typ is rejected', () => {
  const forged = jwt.sign({ sub: 'u1', role: 'admin', typ: 'refresh' }, env.ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256',
  });
  assert.throws(() => verifyAccessCookie(reqWith({ [COOKIE_NAMES.access]: forged })), UnauthorizedError);
});

test('alg "none" and other algorithms are refused (HS256 pinned)', () => {
  const unsigned = jwt.sign({ sub: 'u1', role: 'admin', typ: 'access' }, null, { algorithm: 'none' });
  assert.throws(() => verifyAccessCookie(reqWith({ [COOKIE_NAMES.access]: unsigned })), UnauthorizedError);
  const hs512 = jwt.sign({ sub: 'u1', role: 'admin', typ: 'access' }, env.ACCESS_TOKEN_SECRET, { algorithm: 'HS512' });
  assert.throws(() => verifyAccessCookie(reqWith({ [COOKIE_NAMES.access]: hs512 })), UnauthorizedError);
});

test('pre-auth token is bound to its 2FA stage', () => {
  const res = fakeRes();
  issuePreAuthCookie(res, 'u1', 'setup');
  const req = reqWith({ [COOKIE_NAMES.preAuth]: res.cookies[COOKIE_NAMES.preAuth].value });
  assert.equal(verifyPreAuthCookie(req, 'setup').sub, 'u1');
  assert.throws(() => verifyPreAuthCookie(req, 'verify'), UnauthorizedError);
});

test('missing cookies are a 401, not a crash', () => {
  assert.throws(() => verifyAccessCookie(reqWith({})), UnauthorizedError);
  assert.throws(() => verifyPreAuthCookie(reqWith({}), 'verify'), UnauthorizedError);
});
