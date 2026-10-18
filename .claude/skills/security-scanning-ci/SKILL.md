---
name: security-scanning-ci
description: Set up a security-gated CI/CD pipeline for a Dockerised Node app - npm audit, Semgrep, Snyk (deps + Snyk Code), Docker build, Trivy image scan, API smoke test, Playwright browser test, GHCR publish on tag - and triage findings (fix vs documented false positive). Use when asked to "add CI", "scan for vulnerabilities", "get Snyk/Semgrep to zero", or to fix a red security job.
---

# Security-gated CI/CD

Files in `reference/`: `ci.yml`, `cd.yml`, `smoke-test.sh`, `ui-test.mjs`, `CI-CD.md` (full Thai write-up).

## Jobs (all required, none optional)

`osv-scan` (OSV-Scanner), `secret-scan` (Gitleaks, full history) and a separate CodeQL workflow back up Snyk when its quota runs out - Snyk-free coverage. `audit` (npm audit --audit-level=high per package, matrix) - `security-scan` (Semgrep `p/security-audit`,
`p/secrets`, `p/javascript`, `p/nodejsscan`, `--error`) - `build` (docker compose build) - then, after build:
`image-scan` (Trivy CRITICAL/HIGH, `--ignore-unfixed`, `--skip-dirs /usr/local/lib/node_modules/npm`),
`smoke-test` (curl through the real stack), `ui-test` (Playwright on a **fresh DB**, separate stack).
CD: tag `vX.Y.Z` -> build and push `:X.Y.Z` + `:latest` to GHCR; deploy left pluggable.

## Run the same checks locally

```bash
(cd backend && npm ci && npm audit --audit-level=high)
docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config p/security-audit --config p/secrets \
  --config p/javascript --config p/nodejsscan --exclude node_modules --exclude "*.md" --error /src
snyk auth && snyk test --all-projects && snyk code test     # Snyk free tier has a monthly test quota - batch your runs
docker compose up -d --build && bash scripts/smoke-test.sh
```

## Triage rules

- **Fix first.** Typical real fixes: bump deps (`overrides` for transitive ones, e.g. `qs`), literal
  `httpOnly/secure` cookie flags, `jwt.verify` instead of `jwt.decode`, runtime-generated dummy bcrypt hash,
  zod-validate `req.query`, add CSRF protection. Prefer a non-breaking patch over the major upgrade a bot PR
  proposes (read "Merge Risk: High" PRs before merging).
- **Only then suppress**, per line, with a reason: `// nosemgrep` on the line *above* (never drop `--error` or
  `--exclude-rule` for a whole rule); Trivy via `--skip-dirs` for tooling dirs, not per-CVE lists; Snyk Code
  false positives (e.g. `UseCsurfForExpress` when csrf-csrf is used) in the Snyk web UI with a reason + expiry.
- Semgrep inside a container may scan only a handful of files if git ownership confuses it - pass explicit
  paths and check `Targets scanned`.
- Smoke tests that run curl on **Windows** can fail on cookie-jar quirks (expired `Set-Cookie` not removed);
  run them inside a Linux container (`--network container:<frontend>`, strip CRLF) like CI does.
- Every new auth flow gets an assertion in the smoke test and/or Playwright test - they caught real bugs here
  (middleware order, flaky temporary passwords) that scanners cannot see.
