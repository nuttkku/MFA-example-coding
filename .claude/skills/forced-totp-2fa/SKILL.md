---
name: forced-totp-2fa
description: Add mandatory TOTP two-factor authentication (QR setup, verify, backup codes, replay protection, per-account lockout) to a Node/Express + PostgreSQL app so that no login path can skip 2FA. Use when asked to "add 2FA/MFA/TOTP", "force 2FA for every user", or to review an existing 2FA flow for replay, brute-force or bypass bugs.
---

# Forced TOTP 2FA (Express + PostgreSQL)

Pattern extracted from this repo. Working code is in `reference/` (copy and adapt).

## Core design: the pre-auth token

A correct password (or a successful SSO callback) **never** issues a full session. It issues a short-lived
(5 min) **pre-auth cookie**, signed with its own secret, carrying `stage`:

| stage | meaning | next step |
|---|---|---|
| `setup` | user has `totp_enabled = false` | `POST /2fa/setup` (new secret + QR) -> `POST /2fa/setup/confirm` (6-digit code) -> enable TOTP, issue 10 backup codes, issue the real session |
| `verify` | TOTP already enabled | `POST /2fa/verify` with TOTP **or** backup code -> issue the real session |

Every route that needs a full session uses `requireAuth` (access cookie); pre-auth cookies cannot call them.
All login methods (password, SSO) must end in the same `issuePreAuthCookie(res, userId, stage)` call - no special
cases, which is what makes "no bypass" provable.

## Rules that matter (each one was a real bug or scanner finding)

1. **TOTP codes are single-use.** `otplib.check()` is stateless and accepts a code for ~90 s (window +/-1).
   Use `checkDelta()` to find the time-step, then claim it with a conditional
   `UPDATE users SET totp_last_used_step = $step WHERE id = $1 AND totp_last_used_step < $step`. Only a
   successful claim counts. Reset `totp_last_used_step` whenever a new secret is generated or 2FA is reset.
2. **Per-account 2FA lockout** (`failed_2fa_attempts`, `twofa_locked_until`) separate from password lockout.
   IP rate-limits alone are not enough (attacker spreads guesses across IPs). Do **not** share the counter with
   password lockout (lets anyone who knows an email lock a victim's 2FA) and do **not** reset it on password
   login success (otherwise the password holder gets fresh guesses by re-logging-in). Reset only on 2FA
   success or admin reset.
3. **Re-load the user on every pre-auth request** (`loadPreAuthUser`): the cookie lives 5 minutes, during which
   the user may be disabled, deleted, or 2FA-locked.
4. **Store TOTP secrets with AES-256-GCM** (must be decryptable), pin `authTagLength: 16` on both cipher and
   decipher and check the tag length before `setAuthTag` (Semgrep `gcm-no-tag-length`). The key
   (`TOTP_ENCRYPTION_KEY`, 32 bytes hex) comes from env with **no default**.
5. **Backup codes are bcrypt-hashed**, shown once, single-use via conditional `UPDATE ... WHERE used_at IS NULL`
   + `rowCount === 1` (two concurrent requests must not both win). Alphabet excludes 0/O/1/I/L.
6. **Admin can only *reset* 2FA, never disable it**: reset clears secret + `totp_enabled`, so the user's next
   login falls back to `setup`.
7. **Step-up for regenerating backup codes**: require a fresh TOTP code (not a backup code) - otherwise a stolen
   session cookie becomes permanent 2FA-bypass credentials.
8. Rate-limit `/2fa/*` per IP with `skipSuccessfulRequests: true` (count only failures).

## Files in `reference/`

| file | role |
|---|---|
| `twofa.service.js` | secret generation, QR, replay-safe verify, backup codes |
| `crypto.js` | AES-256-GCM encrypt/decrypt for the TOTP secret |
| `backupCodes.js` | generation/normalisation of backup codes |
| `rateLimit.middleware.js` | login + 2FA limiters |
| `001_init.sql`, `003_twofa_hardening.sql` | schema (users, backup_codes, replay + lockout columns) |
| `auth.controller.js` | login -> pre-auth cookie, setup/confirm/verify handlers, `loadPreAuthUser` |

## Verify it

Add assertions to your smoke test: password-only login returns stage `setup`/`verify` and `/me` is 401; a used
TOTP code is rejected a second time; a used backup code is rejected; N wrong codes -> 403 lock.
