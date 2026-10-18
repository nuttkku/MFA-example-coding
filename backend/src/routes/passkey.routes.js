import { Router } from 'express';
import { requireAuth, requirePreAuth } from '../middleware/auth.middleware.js';
import { loginLimiter, twoFaLimiter, passkeyOptionsLimiter } from '../middleware/rateLimit.middleware.js';
import * as passkey from '../controllers/passkey.controller.js';

const router = Router();

// Passwordless login - no prior step.
router.post('/login/options', passkeyOptionsLimiter, passkey.startLogin);
router.post('/login/verify', loginLimiter, passkey.finishLogin);

// Second factor after password/SSO - needs the pre-auth cookie of the verify stage.
router.get('/2fa/methods', requirePreAuth('verify'), passkey.twoFactorMethods);
router.post('/2fa/options', passkeyOptionsLimiter, requirePreAuth('verify'), passkey.startTwoFactor);
router.post('/2fa/verify', twoFaLimiter, requirePreAuth('verify'), passkey.finishTwoFactor);

// Managing your own passkeys - full session; adding one needs TOTP step-up.
router.get('/', requireAuth, passkey.list);
router.post('/register/options', twoFaLimiter, requireAuth, passkey.startRegistration);
router.post('/register/verify', requireAuth, passkey.finishRegistration);
router.delete('/:id', requireAuth, passkey.remove);

export default router;
