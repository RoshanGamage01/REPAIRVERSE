import pino from 'pino';
import { config, isTest } from '../config.js';

export const logger = pino({
  level: isTest ? 'silent' : config.LOG_LEVEL,
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', '*.password', '*.password_hash'], censor: '[redacted]' },
  ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
});
