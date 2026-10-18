// Loaded with `node --import ./test/setup.js` before any test file, so the
// zod-validated config in src/config/env.js sees a complete environment. Set
// unconditionally: a developer's backend/.env must never leak into unit test
// results. Secrets are random per run rather than literals in the source, so
// nothing key-shaped is committed. No database is needed - pg's Pool only
// connects on the first query, and these tests never issue one.
import { randomBytes } from 'node:crypto';

const random = (bytes) => randomBytes(bytes).toString('hex');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: random(8),
  DB_NAME: 'test',
  ACCESS_TOKEN_SECRET: random(32),
  REFRESH_TOKEN_SECRET: random(32),
  PRE_AUTH_TOKEN_SECRET: random(32),
  SSO_STATE_SECRET: random(32),
  TOTP_ENCRYPTION_KEY: random(32),
  FRONTEND_ORIGIN: 'http://localhost:5173',
  COOKIE_SECURE: 'false',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: random(8),
});
