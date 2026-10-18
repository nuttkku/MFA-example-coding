# Security Policy

This repository is a **learning example** of an authentication system (mandatory TOTP 2FA, passkeys, RBAC, SSO,
CSRF protection). It is not a hosted service and has no production deployment, but because people copy its
patterns into real projects, security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Instead use GitHub's private reporting:
**Security → Report a vulnerability** on this repository
(<https://github.com/nuttkku/MFA-example-coding/security/advisories/new>).

Include, where you can:

- the affected file/endpoint and commit
- steps to reproduce (requests, or a failing assertion for `scripts/smoke-test.sh` / `e2e/ui-test.mjs`)
- the impact you expect (e.g. 2FA bypass, account takeover, session fixation)

You should get a first reply within 7 days. Fixes land on `main` through a normal pull request that must pass
the full CI (npm audit, Semgrep, CodeQL, OSV-Scanner, Gitleaks, Trivy, smoke and browser tests); the write-up
of each finding and its fix goes into [CLAUDE.md](CLAUDE.md#ผลการสแกนความปลอดภัย).

## Supported versions

Only the latest commit on `main` is maintained.

## Scope

In scope: anything that weakens the guarantees the project claims - that no login path skips 2FA, that
passkeys require user verification, RBAC enforcement, session/refresh-token handling, CSRF protection, and
secret storage.

Out of scope: the demo credentials and placeholder secrets that are documented as such (for example the
`twofa-backend-secret-change-me` client secret in `keycloak/realm-export.json`, or the default test account
that is only seeded when `NODE_ENV` is not `production`), and limitations listed under
"สิ่งที่ตั้งใจไม่ทำ" in CLAUDE.md.

## Known, accepted scanner findings

- Snyk Code `UseCsurfForExpress` at `backend/src/app.js`: a name-based false positive - CSRF is enforced by
  `csrf-csrf` plus an Origin guard (`backend/src/middleware/csrf.middleware.js`).
