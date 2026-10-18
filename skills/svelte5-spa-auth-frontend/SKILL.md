---
name: svelte5-spa-auth-frontend
description: Build or migrate a Svelte 5 (runes) + Vite 8 SPA with hash routing, route guards, a fetch wrapper, and the login -> 2FA setup/verify -> dashboard screens. Use when asked to "make a Svelte login/2FA UI", "migrate Svelte 4 to 5", "upgrade to Vite 8 to clear npm audit", or to add guarded routes with svelte-spa-router.
---

# Svelte 5 + Vite 8 auth frontend

Files in `reference/`: `vite.config.js`, `package.json`, `App.svelte`, `main.js`, `guards.js`, `events.js`,
`auth.js` (store), `Login.svelte`, `Setup2FA.svelte`, `Verify2FA.svelte`.

## Structure

- `lib/api.js` - the only `fetch` wrapper (`credentials: 'include'`, CSRF header; see `csrf-double-submit-spa`).
- `lib/guards.js` - `authGuard`, `adminGuard`, `userManagementReadGuard`, attached via `wrap({ conditions })`.
- `lib/stores/auth.js` - session state; calls `GET /auth/me` on mount.
- Routing: `svelte-spa-router` v5 (hash `#/...`) - plain SPA, no SvelteKit needed.
- Dev: Vite proxies `/api/*` to the backend, so the browser sees a single origin (cookies are same-origin,
  no CORS). Set `server.cors: false`, and `server.allowedHosts` if you test from another container.

## Svelte 4 -> 5 migration (took two code edits, then runes)

1. `new App({ target })` -> `mount(App, { target })`.
2. `<Router on:conditionsFailed>` -> `onConditionsFailed={...}` (callback prop in svelte-spa-router 5).
3. Convert components to runes (`$state`, `$derived`, `onclick` instead of `on:click`) and set
   `compilerOptions: { runes: true }` in `vite.config.js` so leftover Svelte 4 syntax fails to compile instead of
   silently running in legacy mode.
4. `|preventDefault` / `|self` modifiers are gone - use tiny wrappers (`lib/events.js`).
5. Vite 8 needs Node `^20.19 || >=22.12`; it uses rolldown, so esbuild-specific CI exclusions can be deleted.
6. Classic `svelte/store` stores still work in runes mode.

Result in this repo: `npm audit` went to 0 (Svelte SSR/DOM-clobbering XSS, esbuild dev-server CORS, vite
`server.fs.deny` advisories had no patch on Svelte 4 / Vite 5).

## Security notes for the UI

No `{@html}` anywhere; show backup codes only from an in-memory store (never persisted); hide admin links via
role but rely on the server for enforcement; SSO buttons are `<a href>` navigations built from
`/sso/providers`. Test the real UI with Playwright (see `security-scanning-ci`).
