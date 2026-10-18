import { z } from 'zod';

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const twoFaCodeSchema = z.object({
  code: z.string().min(6).max(9),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(255),
  role: z.enum(['admin', 'manager', 'user']),
  temporaryPassword: password,
});

export const uuidSchema = z.string().uuid();
export const userIdParamSchema = uuidSchema;

export const updateUserSchema = z.object({
  role: z.enum(['admin', 'manager', 'user']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const resetPasswordSchema = z.object({
  temporaryPassword: password,
});

export const listUsersQuerySchema = z.object({
  search: z.string().max(255).optional(),
});

// Shape-only check of a PublicKeyCredential serialised by @simplewebauthn/browser
// (RegistrationResponseJSON / AuthenticationResponseJSON). Everything inside
// `response` is verified cryptographically by @simplewebauthn/server; this just
// rejects obviously malformed bodies before they reach it.
const base64url = z
  .string()
  .max(4096)
  .regex(/^[A-Za-z0-9_-]*$/);
const publicKeyCredential = z.object({
  id: base64url.min(1).max(1024),
  rawId: base64url.min(1).max(1024),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().max(32).optional(),
});

export const passkeyRegisterSchema = z.object({
  name: z.string().trim().min(1).max(64),
  credential: publicKeyCredential,
});

export const passkeyAssertionSchema = z.object({
  credential: publicKeyCredential,
});
