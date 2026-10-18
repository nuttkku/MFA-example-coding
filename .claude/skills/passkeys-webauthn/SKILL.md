---
name: passkeys-webauthn
description: Add passkey (WebAuthn / FIDO2) support to a Node/Express + PostgreSQL app with SimpleWebAuthn v14 - passwordless login and passkey-as-second-factor, TOTP step-up registration, one-time server-side challenges, Chromium virtual-authenticator tests. Use when asked to "add passkeys / WebAuthn / FIDO2 / biometric login", "passwordless login", or to review a passkey implementation for MFA-bypass, replay, or RP-ID mistakes.
---

# Passkeys (WebAuthn / FIDO2) with SimpleWebAuthn

Code in `reference/`. Uses `@simplewebauthn/server` + `@simplewebauthn/browser` v14 - never hand-roll CBOR/COSE/
signature checks (same reasoning as using `openid-client` for OIDC). Mounted at `/api/auth/passkeys`.

## Two roles

1. **Passwordless login** (`/login/options` + `/login/verify`) issues a full session directly. This is the only
   exception to "every login passes a pre-auth stage" (see `forced-totp-2fa`), and it is safe only because the
   server **enforces `requireUserVerification: true`** (the signed UV flag, not just a client-side option):
   passkey + biometric/PIN is multi-factor by itself. **Never relax this to `preferred`** or the path becomes
   single-factor.
2. **Second factor instead of a TOTP code** (`/2fa/options` + `/2fa/verify`, requires the pre-auth cookie of stage
   `verify`). First factor already done, so UV may be `preferred`; `allowCredentials` is limited to that user's
   own credentials; failures count toward the same 2FA lockout as TOTP.

## Rules that matter

- **Registration needs step-up with a fresh TOTP code** (`requireTotpStepUp`) and TOTP must already be enabled:
  a passkey bypasses password *and* TOTP, so a stolen session cookie must not be able to plant one, and there
  must always be a recovery path. The `register` challenge row is bound to `user_id`; check
  `challenge.user_id === req.user.id` at `/register/verify`.
- **Challenges live server-side, single use**: table `webauthn_challenges`, cookie holds only the row UUID.
  `DELETE ... WHERE id AND purpose AND expires_at > now() RETURNING` *before* verifying, success or failure.
  A signed-cookie challenge could be replayed until expiry; concurrent requests get it only once. Filter the
  cookie with a uuid schema first (otherwise Postgres throws -> 500). Clean expired rows on insert.
- **`expectedOrigin` / `expectedRPID` come from config** (`WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_ID`, defaulting from
  `FRONTEND_ORIGIN`), never from the request (a dev proxy rewrites Host). The RP ID is permanent: changing it
  orphans every registered passkey.
- Register with `residentKey: 'required'` (needed for username-less login), `userVerification: 'required'`,
  `attestationType: 'none'`, and `excludeCredentials` for the user's existing credentials.
- **User handle = the user's random UUID**, not email (WebAuthn 14.6.1); on login check the returned
  `userHandle` matches the credential's owner.
- Passwordless login: reject `status === 'disabled'` (return a clear 403), do **not** apply password lockout
  (same DoS reasoning as SSO), reject accounts without TOTP enabled.
- **Admin reset 2FA also deletes all of that user's passkeys** (reset = "device lost").
- Public key is stored as-is (`BYTEA`, COSE_Key) - not secret, nothing to encrypt. A counter that goes backwards
  (cloned authenticator) is rejected by the library; synced passkeys always report 0, which is normal.
- Rate limits: a generous limiter on option endpoints, `loginLimiter` on `/login/verify`, `twoFaLimiter` where a
  TOTP code is checked (`/2fa/verify`, `/register/options`). Beware: all failing calls on a limited route share
  one budget in a smoke test - assert "no session -> 401" on an unlimited route such as `GET /passkeys`.
- Audit: `passkey_registered`, `passkey_register_failed`, `passkey_register_stepup_failed`, `passkey_deleted`,
  `passkey_login_success/failed` (with `reason`), `2fa_passkey_success/failed`.
- Validate the browser's credential JSON with a shape-only zod schema. **Zod 4**: `z.record(z.string(),
  z.unknown())` - the one-argument `z.record(z.unknown())` no longer exists.

## CSRF interplay

State-changing passkey endpoints are POSTs, so they go through the CSRF layer (`csrf-double-submit-spa`). The
frontend wrapper must retry with a fresh token **only for a CSRF rejection** (`code: 'csrf'`), not for every 403:
"account disabled" is a 403 too, and replaying a passkey-login request with a consumed challenge would replace
the real error with a confusing 401.

## Testing

Playwright + Chromium **virtual authenticator** over CDP (`WebAuthn.addVirtualAuthenticator`: ctap2, internal,
resident key, user verification) drives full ceremonies: no passkey button before registration; wrong TOTP at
step-up rejected; register; passwordless login; passkey instead of TOTP; delete -> the authenticator that still
holds the private key can no longer log in; disabled account refused; admin reset removes passkeys. API smoke
test: registration needs step-up, options force UV, unknown credential rejected, challenge cannot be reused,
verify without challenge cookie -> 401.

## Files in `reference/`

`passkey.service.js` (challenges, registration/authentication, verification), `passkey.controller.js`,
`passkey.routes.js`, `004_passkeys.sql`, `passkeys.js` (browser ceremony helper), `Login.svelte`,
`Verify2FA.svelte`, `Profile.svelte` (manage/add/remove passkeys).
