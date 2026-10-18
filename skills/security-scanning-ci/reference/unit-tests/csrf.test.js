import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfProtection, csrfTokenHandler } from '../src/middleware/csrf.middleware.js';
import { ForbiddenError } from '../src/utils/errors.js';

const [originGuard, doubleCsrfProtection] = csrfProtection;
const FRONTEND = 'http://localhost:5173';

function req({ method = 'POST', origin, cookies = {}, headers = {} } = {}) {
  const all = { ...headers, ...(origin ? { origin } : {}) };
  return { method, cookies, headers: all, get: (name) => all[name.toLowerCase()] };
}

function run(mw, request) {
  let error;
  mw(request, {}, (err) => (error = err ?? null));
  return error;
}

test('origin guard rejects a foreign Origin and allows the frontend or none', () => {
  assert.ok(run(originGuard, req({ origin: 'http://evil.example' })) instanceof ForbiddenError);
  assert.equal(run(originGuard, req({ origin: FRONTEND })), null);
  assert.equal(run(originGuard, req({})), null);
});

test('safe methods pass the token check', () => {
  assert.equal(run(doubleCsrfProtection, req({ method: 'GET', origin: FRONTEND })), null);
});

test('non-browser requests (no Origin) skip the token check', () => {
  assert.equal(run(doubleCsrfProtection, req({})), null);
});

test('a browser POST without a token is rejected with the tagged CSRF error', () => {
  const err = run(doubleCsrfProtection, req({ origin: FRONTEND }));
  assert.equal(err?.code, 'EBADCSRFTOKEN');
  assert.equal(err?.status ?? err?.statusCode, 403);
});

test('a token issued by /api/csrf-token is accepted when echoed in the header', () => {
  const cookies = {};
  let body;
  const res = { cookie: (name, value) => (cookies[name] = value), json: (b) => (body = b) };
  csrfTokenHandler(req({ method: 'GET' }), res);
  assert.ok(body.csrfToken);
  const ok = req({ origin: FRONTEND, cookies, headers: { 'x-csrf-token': body.csrfToken } });
  assert.equal(run(doubleCsrfProtection, ok), null);
  const wrong = req({ origin: FRONTEND, cookies, headers: { 'x-csrf-token': 'not-the-token' } });
  assert.equal(run(doubleCsrfProtection, wrong)?.code, 'EBADCSRFTOKEN');
});
