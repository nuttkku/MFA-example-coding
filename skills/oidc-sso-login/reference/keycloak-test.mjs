// Browser end-to-end test of SSO through the bundled Keycloak (the
// docker-compose.keycloak.yml addon): the full redirect chain out to the IdP's
// real login form and back, then the mandatory 2FA that SSO must not bypass.
// Needs the stack started with both compose files and a fresh database.
//
//   BASE_URL            default http://localhost:5173
//   KEYCLOAK_USER/PASS  default: the demo user in keycloak/realm-export.json
//   CHROMIUM_PATH       optional - use an already-installed Chromium binary
import { chromium } from 'playwright';
import otplib from 'otplib';

const { authenticator } = otplib;

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const KEYCLOAK_USER = process.env.KEYCLOAK_USER || 'demo@example.com';
const KEYCLOAK_PASS = process.env.KEYCLOAK_PASS || 'DemoPass123';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

// Only the app's own pages are judged; Keycloak's login theme is not ours.
// 401 (/auth/me before login) and 400 (the deliberately replayed code) are expected.
const unexpectedErrors = [];
page.on('pageerror', (err) => unexpectedErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  const fromApp = page.url().startsWith(BASE_URL);
  if (fromApp && msg.type() === 'error' && !/status of (400|401)/.test(msg.text())) {
    unexpectedErrors.push(`console: ${msg.text()}`);
  }
});

async function done(code) {
  await browser.close();
  process.exit(code);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

async function fail(message) {
  console.error(`FAIL: ${message} (at ${page.url()})`);
  await done(1);
}

async function check(promise, message) {
  try {
    await promise;
    pass(message);
  } catch {
    await fail(message);
  }
}

const expectRoute = (hash, message) =>
  check(
    page.waitForURL((url) => url.href.startsWith(BASE_URL) && url.hash.startsWith(hash), { timeout: 20000 }),
    message,
  );

const waitForNextTotpStep = () => page.waitForTimeout((31 - (Math.floor(Date.now() / 1000) % 30)) * 1000);

async function startKeycloakLogin() {
  await page.goto(`${BASE_URL}/#/login`);
  await page.click('a:has-text("Keycloak")');
}

console.log('--- first SSO login: Keycloak form, then forced 2FA setup ---');
await startKeycloakLogin();
await check(page.waitForURL(/\/realms\/twofa-example\//, { timeout: 20000 }), 'redirected to the Keycloak login form');
await page.fill('#username', KEYCLOAK_USER);
await page.fill('#password', KEYCLOAK_PASS);
await page.click('#kc-login');
await expectRoute('#/2fa/setup', 'new SSO user lands in forced 2FA setup (no session yet)');

const meBeforeSetup = await page.request.get(`${BASE_URL}/api/auth/me`);
if (meBeforeSetup.status() !== 401) await fail(`expected 401 from /auth/me before 2FA, got ${meBeforeSetup.status()}`);
pass('SSO alone does not grant a session');

await page.waitForSelector('img[alt^="Scan this QR"]');
const secret = (await page.textContent('.code-block')).trim();
const setupCode = authenticator.generate(secret);
await page.fill('#code', setupCode);
await page.click('button[type=submit]');
await expectRoute('#/2fa/backup-codes', '2FA setup confirmed, backup codes shown');
await page.click('button:has-text("I\'ve saved these codes")');
await expectRoute('#/dashboard', 'SSO user (no local password) goes straight to the dashboard');
const me = await (await page.request.get(`${BASE_URL}/api/auth/me`)).json();
if (me.user?.email !== KEYCLOAK_USER || me.user?.role !== 'user' || me.user?.hasPassword !== false) {
  await fail(`unexpected /auth/me for the SSO account: ${JSON.stringify(me.user)}`);
}
pass('session belongs to the Keycloak identity: verified email, role user, no local password');

console.log('--- second SSO login: same identity goes to verify, not setup ---');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');
await startKeycloakLogin();
// Keycloak still has its own SSO session, so it may skip the form entirely.
await page
  .waitForSelector('#username', { timeout: 5000 })
  .then(async () => {
    await page.fill('#username', KEYCLOAK_USER);
    await page.fill('#password', KEYCLOAK_PASS);
    await page.click('#kc-login');
  })
  .catch(() => {});
await expectRoute('#/2fa/verify', 'returning SSO user is asked for a 2FA code, not a new setup');

await page.fill('#code', setupCode);
await page.click('button[type=submit]');
await check(page.waitForSelector('.alert-error'), 'the code already used during setup is rejected (replay)');

await waitForNextTotpStep();
await page.fill('#code', authenticator.generate(secret));
await page.click('button[type=submit]');
await expectRoute('#/dashboard', 'fresh TOTP code completes the SSO login');

if (unexpectedErrors.length) await fail(`unexpected browser errors:\n  ${unexpectedErrors.join('\n  ')}`);
pass('no unexpected browser errors');

console.log('\nAll Keycloak SSO tests passed.');
await done(0);
