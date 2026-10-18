---
name: csrf-double-submit-spa
description: Add CSRF protection to a cookie-authenticated Express API consumed by a SPA, using csrf-csrf (double-submit cookie token in an X-CSRF-Token header) plus an Origin allow-check, and wire the fetch wrapper in the frontend. Use when a scanner reports "Cross-Site Request Forgery (CSRF)" / UseCsurfForExpress, or when asked to protect a cookie-session API from CSRF without the deprecated csurf package.
---

# CSRF protection for a cookie-session SPA (csrf-csrf)

Code in `reference/` (`csrf.middleware.js`, `api.js`, `app.js` for the ordering).

## Backend

```js
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,        // HMAC(existing secret, 'csrf-double-submit') - no new env var
  getSessionIdentifier: () => '',      // stateless: must also cover pre-login requests (login itself)
  cookieName: 'csrf_token',
  cookieOptions: { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/' },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],   // header only - never the cookie
  skipCsrfProtection: (req) => !req.get('origin'),                 // see below
});
app.use(cookieParser());                    // MUST come before the CSRF middleware (else 500: csrf_token of undefined)
app.get('/api/csrf-token', csrfTokenHandler);   // GET is exempt; returns { csrfToken } + sets the cookie
app.use(csrfProtection);                    // [originGuard, doubleCsrfProtection]
```

- **Origin guard**: a request carrying an `Origin` other than `FRONTEND_ORIGIN` is rejected (403) outright.
- **No `Origin` header => not a browser** (curl, server-to-server, smoke tests). Those carry no ambient cookies
  for an attacker to ride, so they skip the token. Browsers always send `Origin` on cross-site
  POST/PUT/PATCH/DELETE, so every browser state change must present the token.
- Layered on `SameSite=Lax` cookies; do not rely on either alone.

## Frontend (`api.js`)

Fetch `/csrf-token` lazily before the first non-GET request, cache it, send `X-CSRF-Token`. On a 403 refetch the
token once and retry (cookie expired/cleared).

## Gotchas

- Snyk Code's `UseCsurfForExpress` matches the **deprecated `csurf` package by name** and keeps reporting after
  a correct csrf-csrf setup. Treat it as a false positive: ignore it in the Snyk web UI with this reasoning
  (CLI `snyk ignore` and inline `deepcode ignore` comments do not apply to Snyk Code CLI results), rather than
  adding the unmaintained package.
- Add smoke assertions: POST with `Origin: http://evil.example` -> 403; POST with the right Origin but no token
  -> 403. The browser UI test (Playwright) proves the token flow end to end.
