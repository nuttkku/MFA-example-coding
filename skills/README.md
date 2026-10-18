# Skills extracted from this repo

Each folder is a self-contained Claude Code skill: `SKILL.md` (frontmatter + the design rules and pitfalls) and
`reference/` (the working source files from this project, ready to copy and adapt).

| Skill | Use it for |
|---|---|
| [forced-totp-2fa](forced-totp-2fa/SKILL.md) | Mandatory TOTP 2FA: pre-auth token, replay protection, lockout, backup codes |
| [express-rbac-permissions](express-rbac-permissions/SKILL.md) | Central permission map, `requirePermission`, admin user management guards |
| [oidc-sso-login](oidc-sso-login/SKILL.md) | Keycloak / LINE / generic OIDC / Facebook login with safe account linking |
| [secure-session-cookies](secure-session-cookies/SKILL.md) | httpOnly JWT cookies, rotating refresh tokens with reuse detection |
| [csrf-double-submit-spa](csrf-double-submit-spa/SKILL.md) | CSRF protection for cookie-auth SPAs (csrf-csrf + Origin guard) |
| [security-scanning-ci](security-scanning-ci/SKILL.md) | CI/CD with npm audit, Semgrep, Snyk, Trivy, smoke + Playwright tests; triage rules |
| [svelte5-spa-auth-frontend](svelte5-spa-auth-frontend/SKILL.md) | Svelte 5 runes + Vite 8 SPA, guards, 2FA screens, Svelte 4 -> 5 migration |
| [docker-compose-dev-stack](docker-compose-dev-stack/SKILL.md) | Postgres + Express + Vite compose stack, Windows hot reload, Keycloak addon |

## Installing a skill

Copy the folder into `~/.claude/skills/` (personal, all projects) or `<project>/.claude/skills/` (one project):

```bash
cp -r skills/forced-totp-2fa ~/.claude/skills/
```

Claude loads a skill when a request matches its `description`. The `reference/` files are read on demand; they
are source snapshots, so adjust imports/paths to your project.
