---
name: secure-session-cookies
description: Build a cookie-based JWT session for an Express SPA - httpOnly access cookie, rotating refresh token stored hashed with reuse detection, separate secret per token type, algorithm pinning. Use when asked to "implement login sessions/JWT/refresh tokens", fix Snyk/Semgrep cookie or JWT findings (HttpOnly, Secure, jwt.decode, algorithm), or review session handling.
---

# Secure cookie sessions (JWT access + rotating refresh)

Code in `reference/token.service.js` (+ `auth.middleware.js`, `env.js`).

## Token types

| cookie | secret | TTL | purpose |
|---|---|---|---|
| `pre_auth_token` | `PRE_AUTH_TOKEN_SECRET` | 5 min | between password and 2FA; cannot call APIs |
| `access_token` | `ACCESS_TOKEN_SECRET` | 15 min | API calls |
| `refresh_token` | `REFRESH_TOKEN_SECRET` | 7 d | `/auth/refresh`, SHA-256 stored in DB |
| `sso_state` | `SSO_STATE_SECRET` | 10 min | CSRF/nonce/PKCE during SSO |

**A different secret per token type** so one leaking/forging cannot stand in for another; also check a `typ`
claim. Pin `algorithm: 'HS256'` on sign and `algorithms: ['HS256']` on verify (no library inference).

## Cookie attributes (what scanners want to see literally)

`httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `secure: env.COOKIE_SECURE` (true in production, false for
plain-http localhost). Set cookies through **one helper** (`setSecureCookie`) so the flags are written at the
call site - Snyk Code's `WebCookieHttpOnlyDisabledByDefault` / `WebCookieSecureDisabledByDefault` do not follow
object spreads. Use `jwt.verify`, not `jwt.decode`, even to read back `exp` of a token you just signed
(`JwtDecodeMethod`).

## Refresh rotation + reuse detection

- Every use revokes the old token (`UPDATE ... SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`,
  check `rowCount === 1` - concurrent use of one token can only win once), sets `replaced_by`, issues a new one.
- Presenting a token that was **rotated** (`replaced_by` set) => assume theft => revoke every session of that
  user. A token revoked for other reasons (logout, password change, admin) is just a 401 - otherwise a stale
  device would sign the user out everywhere, including the session created by their password change.
- `/refresh` re-checks the user exists and is not disabled before issuing.
- Password change: revoke all refresh tokens, then issue a fresh session for the current device.
- Known limit: already-issued access JWTs stay valid until they expire (stateless).

## Other hardening

`TRUST_PROXY=false` by default (a spoofable `X-Forwarded-For` poisons rate limits/audit); set a hop count only
behind a real proxy. Error text and bcrypt timing identical for unknown email vs wrong password (compare
against a dummy hash generated at startup - never hardcode a hash literal, scanners flag it).
