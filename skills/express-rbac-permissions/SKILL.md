---
name: express-rbac-permissions
description: Implement role-based access control in Express with one central permission map and a requirePermission middleware, plus an admin user-management API (create, change role, disable, reset password) with self-lockout guards. Use when asked to "add roles/RBAC/permissions", "admin can manage users", or when reviewing authorization of an Express API.
---

# Express RBAC with a central permission map

Code in `reference/`. The whole model is one file plus one middleware.

## Design

```js
// config/permissions.js - the ONLY place that knows which role may do what
export const PERMISSIONS = {
  'users:read':  ['admin', 'manager'],
  'users:write': ['admin'],
  'audit:read':  ['admin'],
};
// middleware: requirePermission('users:write') -> 403 if req.user.role not allowed
```

Routes: `router.use(requireAuth)` first (authenticated **and** 2FA-complete), then per-route
`requirePermission(...)`. Unknown permission strings deny by default (`roleHasPermission` returns false).
Adding a role or permission = edit `permissions.js` only.

## Rules

1. **Authenticate, then authorize.** `requireAuth` re-loads the user from the DB on every request (so a role
   change or `disabled` status takes effect immediately, not when the JWT expires). Disabled -> 403.
2. **Never trust the role in the token alone** for sensitive decisions; read `req.user` from the DB.
3. **Self-protection guards** in `patchUser`: an admin cannot demote or disable themselves (prevents locking the
   system out of its last admin).
4. **Validate `:id` params** with `zod.string().uuid()` and `.toLowerCase()` *before* comparing with
   `req.user.id`. Otherwise a malformed id gives a 500 from Postgres, and an upper-case copy of your own id
   (Postgres accepts it) sidesteps the self-demotion guard.
5. **Validate query strings too** (`listUsersQuerySchema.parse(req.query)`): `req.query.x` can be an array or
   object, which Snyk Code flags as `HTTPSourceWithUncheckedType`.
6. Disabling a user must also **revoke all their refresh tokens**; resetting a password must unlock the account.
7. Audit every admin mutation (`recordEvent`), including target id and role.
8. Seed the first admin from env (no default password); any test account must be skipped when
   `NODE_ENV=production`.

## Files in `reference/`

`permissions.js`, `rbac.middleware.js`, `auth.middleware.js` (requireAuth / requirePreAuth),
`admin.controller.js`, `admin.routes.js`.

## Test it

Smoke test: create a `user`-role account, call an admin route with it -> expect 403; manager can `GET` users
but gets 403 on `POST`/`PATCH`; admin patching own id with role `user` -> 409 (also with upper-case id).
