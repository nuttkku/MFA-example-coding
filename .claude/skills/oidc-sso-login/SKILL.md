---
name: oidc-sso-login
description: Add optional SSO login (Keycloak, LINE Login, any OIDC provider via openid-client v6, and Facebook OAuth 2.0 written by hand) to a Node/Express app, with safe account linking and 2FA still enforced. Use when asked to "add Google/LINE/Facebook/Keycloak/OIDC login", to fix redirect_uri/issuer mismatches behind docker or a proxy, or to review SSO account-linking logic for takeover bugs.
---

# SSO / OIDC login (Facebook, LINE, Keycloak, generic OIDC)

Code in `reference/`. Providers are individually switched on in `.env`; a half-configured provider is
**soft-disabled** (logged, not fatal) so the app still boots.

## Flow

`GET /sso/:provider/start` -> sets signed `sso_state` cookie `{provider,state,nonce,codeVerifier}` (10 min,
SameSite=Lax, own secret) -> redirect to IdP -> `GET /sso/:provider/callback` -> verify -> find/create user ->
**`issuePreAuthCookie(...)` - the same call password login makes** (see skill `forced-totp-2fa`). SSO never
returns a full session directly, so 2FA cannot be bypassed.

## Decisions

- **Facebook is not OIDC** (no discovery, no id_token): 3 manual HTTP calls (authorize dialog -> code exchange ->
  `/me`) with `state` + server-side client secret. **LINE, Keycloak, generic OIDC are real OIDC**: share one
  `oidcClient.service.js` using `openid-client` v6 (`discovery()`, `authorizationCodeGrant()`); never hand-roll
  JWT/JWKS validation. Use **PKCE on every OIDC provider**.
- **Internal vs public URL (docker)**: backend discovers via `http://keycloak:8080`, browser must be sent to
  `http://localhost:8080`. After discovery, rewrite `issuer`, `authorization_endpoint`, `end_session_endpoint`
  to the public origin - **including `issuer`**, otherwise `iss` validation fails
  (`unexpected "iss" response parameter value`).
- **Build `redirect_uri` from a configured `FRONTEND_ORIGIN`, never from `req.get('host')`**: behind a dev proxy
  the Host is `backend:4000` and the token exchange fails with `invalid_grant: Incorrect redirect_uri`.
- **Account matching order** (`findOrCreateUserFromIdentity`):
  1. `(provider, providerUserId)` already linked -> that user.
  2. IdP email **verified** and equals an existing user -> link to that user.
  3. Email matches but **not verified** -> do not link (account takeover) *and* do not reuse the email for the
     new user (UNIQUE violation) -> use placeholder `<provider>.<id>@sso.local`.
  4. Otherwise create a new `user` (no password: `password_hash` nullable).
- **Disabled accounts must be blocked on SSO too** (check `status` in the callback before issuing pre-auth).
- Do **not** apply password-lockout to SSO: anyone who knows the victim's email could lock them out of SSO.
- Log only a sanitised `error` query param (`[\w.-]`, <= 64 chars) - raw values allow log injection.

## Files in `reference/`

`identityProviders.js` (registry), `oidcClient.service.js`, `facebook.service.js`, `sso.service.js`,
`sso.controller.js`, `sso.routes.js`, `002_add_sso.sql`, `docker-compose.keycloak.yml` + `realm-export.json`
(demo Keycloak realm; the client secret in it is a placeholder - change it).

## Frontend

Fetch `GET /sso/providers` and render only enabled providers as plain `<a href>` links (a real navigation, not
`fetch`).
