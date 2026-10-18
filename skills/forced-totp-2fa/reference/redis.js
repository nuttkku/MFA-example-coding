import { createClient } from 'redis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// Optional. Without REDIS_URL every rate limiter keeps its counters in this
// process's memory, which is fine for the single backend container this
// project runs. Behind a load balancer with several backend instances each one
// would count separately (an attacker gets N times the budget), so set
// REDIS_URL to share the counters - see docker-compose.redis.yml.
export const redisClient = env.REDIS_URL ? createClient({ url: env.REDIS_URL }) : null;

if (redisClient) {
  redisClient.on('error', (err) => logger.error('Redis error:', err.message));
  // Top-level await: the rate-limit stores load their Lua script as soon as
  // they are constructed, so the connection must exist before they are. If
  // Redis is unreachable at boot the app fails fast, like it does for Postgres.
  await redisClient.connect();
  logger.info('Rate limiting uses the shared Redis store');
}
