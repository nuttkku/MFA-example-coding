---
name: docker-compose-dev-stack
description: Docker Compose dev stack for Node + PostgreSQL + Vite - healthchecks, non-root containers, hot reload through bind mounts on Windows, a secrets generator, and an optional Keycloak addon file. Use when asked to "dockerize this app", "add Postgres to compose", "make nodemon reload on Windows/Docker Desktop", or "run Keycloak locally for SSO testing".
---

# Docker Compose dev stack (Postgres + Express + Vite [+ Keycloak])

Files in `reference/`: `docker-compose.yml`, `backend.Dockerfile` + `frontend.Dockerfile`, `nodemon.json`, `.dockerignore`,
`root.env.example` + `backend.env.example`, `generate-secrets.sh`.

## Decisions

- **Order of start-up**: `depends_on: condition: service_healthy` on Postgres *and* retry-with-backoff in the
  migration runner (covers the race right after the container starts). Migrations + seed run on every boot and
  are idempotent.
- **Secrets**: `bash scripts/generate-secrets.sh` creates `.env` files with random values (never commit them,
  never default `TOTP_ENCRYPTION_KEY`). DB credentials live only in the root `.env`; compose forwards them into
  the backend so they are not duplicated.
- **Non-root**: `chown -R node:node /app` then `USER node` in both Dockerfiles (Semgrep
  `dockerfile.security.missing-user`). `RUN apk update && apk upgrade --no-cache` pulls OS security patches
  (Trivy flagged old OpenSSL in the Alpine base).
- **Hot reload**: `src/` bind-mounted; on Windows/Docker Desktop file events do not arrive, so
  `nodemon.json` uses `legacyWatch: true` (+ `pollingInterval` when chokidar 4 is forced by an override to
  drop the vulnerable `braces`).
- **One origin for the browser**: Vite proxies `/api` to `http://backend:4000`; there is no CORS to configure
  and cookies stay same-origin.
- **Keycloak addon** is a second compose file, never run alone:
  `docker compose -f docker-compose.yml -f docker-compose.keycloak.yml up -d --build`. It imports
  `realm-export.json` and overrides backend env (see skill `oidc-sso-login` for the internal/public issuer
  problem).
- Reset data: `docker compose down -v` (use the same `-f` flags you started with).

## Pitfalls hit

- Scripts checked out with CRLF break `bash` (`set: pipefail: invalid option name`) - keep `*.sh` LF via
  `.gitattributes`.
- Vite rejects requests whose Host is the compose service name (`Blocked request. This host ("frontend")`);
  test from the same network namespace (`--network container:<name>` + `localhost`) or add `allowedHosts`.
