import crypto from 'node:crypto';
import { doubleCsrf } from 'csrf-csrf';
import { env } from '../config/env.js';
import { ForbiddenError } from '../utils/errors.js';

// Derived from an existing secret (domain-separated by the label) so CSRF
// protection needs no extra env var to provision, yet can never be confused
// with any of the JWT/cookie signing keys.
const CSRF_SECRET = crypto.createHmac('sha256', env.SSO_STATE_SECRET).update('csrf-double-submit').digest('hex');

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  // Stateless double-submit: the token is not bound to a login session because
  // it must also protect the pre-login requests (login itself).
  getSessionIdentifier: () => '',
  cookieName: 'csrf_token',
  cookieOptions: { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/' },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  // Requests with no Origin header do not come from a browser (curl, server-to-
  // server, the smoke test): they carry no ambient cookies for an attacker to
  // ride on. Browsers always send Origin on cross-site POST/PATCH/DELETE, so
  // every browser-originated state change must present the token.
  skipCsrfProtection: (req) => !req.get('origin'),
  errorConfig: { statusCode: 403, message: 'Invalid CSRF token', code: 'EBADCSRFTOKEN' },
});

// Belt and braces on top of the token: a browser request whose Origin is not
// the configured frontend is rejected outright.
function originGuard(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin !== env.FRONTEND_ORIGIN) {
    return next(new ForbiddenError('Cross-site request blocked'));
  }
  return next();
}

export const csrfProtection = [originGuard, doubleCsrfProtection];

export function csrfTokenHandler(req, res) {
  res.json({ csrfToken: generateCsrfToken(req, res) });
}
