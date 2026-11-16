import { Redis } from 'ioredis';
import { config, isTest } from '../config.js';
import { logger } from './logger.js';

let client: Redis | null = null;
let healthy = false;

export function redis(): Redis | null {
  if (!config.REDIS_URL || isTest) return null;
  if (!client) {
    client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    client.on('ready', () => (healthy = true));
    client.on('error', (e) => {
      if (healthy) logger.warn({ err: e.message }, 'redis unavailable; falling back to in-memory');
      healthy = false;
    });
  }
  return healthy ? client : null;
}

export function redisStatus(): 'connected' | 'unavailable' | 'not_configured' {
  if (!config.REDIS_URL) return 'not_configured';
  redis();
  return healthy ? 'connected' : 'unavailable';
}
