// Browser end-to-end test: drives the real Svelte UI (through the Vite dev
// proxy, same as a user) against a live stack, covering what the API-level
// scripts/smoke-test.sh cannot see - routing/guards, forms, modals, and the
// frontend <-> backend contract. Needs a fresh database (it performs the
// bootstrap admin's first login). Exits non-zero on the first failed check.
//
//   BASE_URL      default http://localhost:5173
//   ADMIN_EMAIL / ADMIN_PASSWORD   default: the backend/.env.example values
//   CHROMIUM_PATH optional - use an already-installed Chromium binary
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import otplib from 'otplib';

const { authenticator } = otplib;

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_immediately!1';
// Passwords this run sets are random per run rather than literals in the
// source: nothing credential-shaped is committed, and each run is independent.
const randomPassword = () => `Ui-${randomBytes(12).toString('hex')}-9z`;
const ADMIN_NEW_PASSWORD = randomPassword();
const NEW_USER_EMAIL = `ui-user-${Date.now()}@example.com`;
const NEW_USER_PASSWORD = randomPassword();

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();

// 401 (/auth/me before login, rejected passkeys), 404 (/favicon.ico), 400
// (deliberately wrong codes below) and 403 (passkey sign-in to a disabled
// account) are expected; anything else in the console is a failure.
const unexpectedErrors = [];
page.on('pageerror', (err) => unexpectedErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !/status of (400|401|403|404)/.test(msg.text())) {
    unexpectedErrors.push(`console: ${msg.text()}`);
  }
});
page.on('dialog', (dialog) => dialog.accept());

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
    page.waitForURL((url) => url.hash.startsWith(hash), { timeout: 10000 }),
    message,
  );

const waitForNextTotpStep = () => page.waitForTimeout((31 - (Math.floor(Date.now() / 1000) % 30)) * 1000);

async function login(email, password) {
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

async function completeSetup() {
  await page.waitForSelector('img[alt^="Scan this QR"]');
  const secret = (await page.textContent('.code-block')).trim();
  await page.fill('#code', authenticator.generate(secret));
  await page.click('button[type=submit]');
  await expectRoute('#/2fa/backup-codes', 'setup confirm shows backup codes');
  const count = await page.locator('.backup-codes-grid > div').count();
  if (count !== 10) await fail(`expected 10 backup codes, got ${count}`);
  pass('10 backup codes shown');
  await page.click('button:has-text("saved these codes")');
  return secret;
}

async function changePassword(current, next) {
  await expectRoute('#/change-password', 'forced password change');
  await page.fill('#current', current);
  await page.fill('#new', next);
  await page.fill('#confirm', next);
  await page.click('button[type=submit]');
  await expectRoute('#/dashboard', 'password changed, on dashboard');
}

console.log('--- guards and SSO error banner ---');
await page.goto(`${BASE_URL}/#/dashboard`);
await expectRoute('#/login', 'anonymous user is sent to /login');
// A real SSO callback arrives as a full page load from the IdP, not a hash change.
await page.goto('about:blank');
await page.goto(`${BASE_URL}/#/login?error=sso_denied`);
await check(
  page.waitForSelector('.alert-error:has-text("cancelled or denied")'),
  'SSO error code shown as a friendly message',
);

console.log('--- admin: forced 2FA setup and password change ---');
await login(ADMIN_EMAIL, ADMIN_PASSWORD);
await expectRoute('#/2fa/setup', 'password login is forced into 2FA setup');
const adminSecret = await completeSetup();
await changePassword(ADMIN_PASSWORD, ADMIN_NEW_PASSWORD);
await check(page.waitForSelector('h1:has-text("Welcome")'), 'dashboard greets the user');

console.log('--- admin: user management ---');
await page.click('a[href="#/admin/users"]');
await expectRoute('#/admin/users', 'navbar link to users page');
await page.waitForSelector('table');

await page.click('button:has-text("New user")');
await check(page.waitForSelector('.modal[role=dialog]'), 'create-user modal is a labelled dialog');
await page.click('.modal h2');
if ((await page.locator('.modal').count()) !== 1) await fail('click inside the modal closed it');
await page.mouse.click(5, 5);
if ((await page.locator('.modal').count()) !== 0) await fail('backdrop click did not close the modal');
pass('backdrop click closes the modal, inner click does not');
await page.click('button:has-text("New user")');
await page.keyboard.press('Escape');
if ((await page.locator('.modal').count()) !== 0) await fail('Escape did not close the modal');
pass('Escape closes the modal');

await page.click('button:has-text("New user")');
await page.fill('#new-email', NEW_USER_EMAIL);
await page.fill('#new-name', 'UI User');
await page.selectOption('#new-role', 'user');
await page.click('button:has-text("Create user")');
await check(page.waitForSelector(`td:has-text("${NEW_USER_EMAIL}")`), 'created user appears in the table');

await page.fill('input[placeholder^="Search"]', NEW_USER_EMAIL);
await page.click('button:has-text("Search")');
await check(
  page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1),
  'search narrows the table to one row',
);

const row = page.locator('tr', { has: page.locator('td', { hasText: NEW_USER_EMAIL }) });
await row.locator('select').selectOption('manager');
await check(
  page.waitForFunction(
    (email) =>
      [...document.querySelectorAll('tbody tr')].some(
        (tr) => tr.textContent.includes(email) && tr.querySelector('select')?.value === 'manager',
      ),
    NEW_USER_EMAIL,
  ),
  'role change saved',
);
await row.locator('select').selectOption('user');
await row.locator('button:has-text("Disable")').click();
await check(row.locator('.badge-disabled').waitFor(), 'user disabled');
await row.locator('button:has-text("Enable")').click();
await check(row.locator('.badge-active').waitFor(), 'user re-enabled');
await row.locator('button:has-text("Reset 2FA")').click();
await check(page.waitForSelector('.alert-success:has-text("2FA reset")'), 'admin reset 2FA');

// Repeated on purpose: the generated temporary password used to fail
// validation ~16% of the time, so a single try would rarely catch it
// (20 tries catch that regression ~97% of the time).
let newUserTempPassword = '';
for (let i = 0; i < 20; i += 1) {
  await row.locator('button:has-text("Reset password")').click();
  newUserTempPassword = await page.inputValue('#reset-password');
  await page.click('.modal button[type=submit]');
  await page.waitForSelector('.modal', { state: 'detached', timeout: 10000 }).catch(() => {});
  if ((await page.locator('.modal').count()) !== 0) await fail(`generated temporary password was rejected by the form`);
}
pass('20 generated temporary passwords all accepted');

await page.click('a[href="#/admin/audit-logs"]');
await expectRoute('#/admin/audit-logs', 'audit log page');
await check(page.waitForSelector('tbody tr'), 'audit log has entries');

console.log('--- admin: backup-code regeneration needs TOTP step-up ---');
await page.click('a[href="#/profile"]');
await expectRoute('#/profile', 'profile page');
await page.fill('#regen-code', '000000');
await page.click('button:has-text("Regenerate backup codes")');
await check(page.waitForSelector('.alert-error'), 'wrong code is rejected');
await waitForNextTotpStep();
await page.fill('#regen-code', authenticator.generate(adminSecret));
await page.click('button:has-text("Regenerate backup codes")');
await expectRoute('#/2fa/backup-codes', 'valid TOTP code regenerates backup codes');
const regenerated = await page.locator('.backup-codes-grid > div').allTextContents();
if (regenerated.length !== 10) await fail(`expected 10 regenerated codes, got ${regenerated.length}`);
await page.click('button:has-text("saved these codes")');
await expectRoute('#/profile', 'back to profile');

console.log('--- admin: verify stage with a backup code ---');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logout returns to login');
await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
await expectRoute('#/2fa/verify', 'second login goes to 2FA verify');
await page.fill('#code', '000000');
await page.click('button[type=submit]');
await check(page.waitForSelector('.alert-error:has-text("Invalid")'), 'wrong verification code is rejected');
await page.fill('#code', regenerated[0]);
await page.click('button[type=submit]');
await expectRoute('#/dashboard', 'backup code completes 2FA');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');

console.log('--- admin: passkeys (Chromium virtual authenticator) ---');
// A CTAP2 platform authenticator with resident keys and user verification
// that auto-approves - the same thing Touch ID / Windows Hello would do.
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});

await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
await expectRoute('#/2fa/verify', 'password login goes to 2FA verify');
await page.waitForTimeout(500);
if ((await page.locator('button:has-text("Use a passkey instead")').count()) !== 0) {
  await fail('passkey offered at verify before any passkey was registered');
}
pass('no passkey offered before one is registered');
await page.fill('#code', regenerated[1]);
await page.click('button[type=submit]');
await expectRoute('#/dashboard', 'second backup code completes 2FA');

await page.click('a[href="#/profile"]');
await expectRoute('#/profile', 'profile page');
await check(page.waitForSelector('text=No passkeys yet.'), 'profile lists no passkeys');
await page.fill('#passkey-name', 'UI test key');
await page.fill('#passkey-code', '000000');
await page.click('button:has-text("Add a passkey")');
await check(
  page.waitForSelector('.alert-error:has-text("Invalid")'),
  'adding a passkey with a wrong TOTP code is refused',
);
await waitForNextTotpStep();
await page.fill('#passkey-code', authenticator.generate(adminSecret));
await page.click('button:has-text("Add a passkey")');
await check(page.waitForSelector('.alert-success:has-text("Passkey added")'), 'passkey registered after TOTP step-up');
await check(page.waitForSelector('td:has-text("UI test key")'), 'new passkey listed on the profile');

await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');
await page.click('button:has-text("Sign in with a passkey")');
await expectRoute('#/dashboard', 'passwordless passkey sign-in goes straight to the dashboard');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');

await login(ADMIN_EMAIL, ADMIN_NEW_PASSWORD);
await expectRoute('#/2fa/verify', 'password login goes to 2FA verify');
await page.click('button:has-text("Use a passkey instead")');
await expectRoute('#/dashboard', 'passkey completes the 2FA step after a password');

await page.click('a[href="#/profile"]');
await expectRoute('#/profile', 'profile page');
await page.click('td button:has-text("Remove")');
await check(page.waitForSelector('text=No passkeys yet.'), 'passkey removed');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');
// The virtual authenticator still holds the private key - the server must
// refuse it now that the credential is gone.
await page.click('button:has-text("Sign in with a passkey")');
await check(
  page.waitForSelector('.alert-error:has-text("Passkey sign-in failed")'),
  'removed passkey can no longer sign in',
);

console.log('--- plain user: forced setup, RBAC ---');
await login(NEW_USER_EMAIL, newUserTempPassword);
await expectRoute('#/2fa/setup', 'new user (2FA reset) is forced into setup');
const userSecret = await completeSetup();
await changePassword(newUserTempPassword, NEW_USER_PASSWORD);
if ((await page.locator('a[href="#/admin/users"]').count()) !== 0) await fail('plain user sees the Users link');
pass('navbar hides admin links from a plain user');
await page.goto(`${BASE_URL}/#/admin/audit-logs`);
await expectRoute('#/unauthorized', 'RBAC guard sends a plain user to /unauthorized');

console.log('--- plain user passkey: disabled account, admin 2FA reset ---');
// Only this user's passkey on the authenticator from here on.
await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
await page.click('a[href="#/profile"]');
await expectRoute('#/profile', 'profile page');
await waitForNextTotpStep();
await page.fill('#passkey-name', 'User key');
await page.fill('#passkey-code', authenticator.generate(userSecret));
await page.click('button:has-text("Add a passkey")');
await check(page.waitForSelector('.alert-success:has-text("Passkey added")'), 'plain user registered a passkey');
await page.click('button:has-text("Log out")');
await expectRoute('#/login', 'logged out');

// The admin works in a separate browser context, so both sessions coexist.
const adminPage = await browser.newPage();
adminPage.on('dialog', (dialog) => dialog.accept());
await adminPage.goto(`${BASE_URL}/#/login`);
await adminPage.fill('#email', ADMIN_EMAIL);
await adminPage.fill('#password', ADMIN_NEW_PASSWORD);
await adminPage.click('button[type=submit]');
await adminPage.waitForURL((url) => url.hash.startsWith('#/2fa/verify'));
await adminPage.fill('#code', authenticator.generate(adminSecret));
await adminPage.click('button[type=submit]');
await adminPage.waitForURL((url) => url.hash.startsWith('#/dashboard'));
await adminPage.goto(`${BASE_URL}/#/admin/users`);
const userRow = adminPage.locator('tr', { has: adminPage.locator('td', { hasText: NEW_USER_EMAIL }) });
await userRow.locator('button:has-text("Disable")').click();
await check(userRow.locator('.badge-disabled').waitFor(), 'admin disabled the plain user');

await page.click('button:has-text("Sign in with a passkey")');
await check(
  page.waitForSelector('.alert-error:has-text("disabled")'),
  'disabled account cannot sign in with a passkey',
);

await userRow.locator('button:has-text("Enable")').click();
await check(userRow.locator('.badge-active').waitFor(), 'admin re-enabled the plain user');
await userRow.locator('button:has-text("Reset 2FA")').click();
await check(adminPage.waitForSelector('.alert-success:has-text("2FA reset")'), "admin reset the plain user's 2FA");
await adminPage.close();

await page.click('button:has-text("Sign in with a passkey")');
await check(
  page.waitForSelector('.alert-error:has-text("Passkey sign-in failed")'),
  "admin 2FA reset also removes the user's passkeys",
);

if (unexpectedErrors.length) await fail(`unexpected browser errors:\n${unexpectedErrors.join('\n')}`);
pass('no unexpected browser errors');
console.log('\nAll UI tests passed.');
await done(0);
