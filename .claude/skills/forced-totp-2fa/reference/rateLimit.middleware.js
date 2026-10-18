import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';

// Shared counters when REDIS_URL is set, otherwise express-rate-limit's default
// in-memory store. Each limiter needs its own key prefix so their budgets stay
// separate. A Redis outage at request time makes limited routes fail (500)
// rather than silently dropping the limit.
function store(name) {
  if (!redisClient) return undefined;
  return new RedisStore({ prefix: `rl:${name}:`, sendCommand: (...args) => redisClient.sendCommand(args) });
}

export const loginLimiter = rateLimit({
  store: store('login'),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

export const twoFaLimiter = rateLimit({
  store: store('twofa'),
  windowMs: 5 * 60 * 1000,
  limit: 10,
  // Only failed attempts (4xx/5xx) count: the point is to cap guessing, and a
  // user finishing setup then signing in again shortly after shouldn't burn
  // through the budget with correct codes.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts, please try again later.' },
});

// Coarse per-IP ceiling for routes that are authenticated or read-only and so
// have no failure budget of their own (listing/deleting passkeys, ...).
export const generalLimiter = rateLimit({
  store: store('general'),
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Starting a passkey ceremony is cheap and reveals nothing, but each call
// stores a challenge row - cap it per IP so nobody can fill that table.
export const passkeyOptionsLimiter = rateLimit({
  store: store('passkey-options'),
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many passkey requests, please try again later.' },
});
