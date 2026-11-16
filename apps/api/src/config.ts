import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/repairverse'),
  REDIS_URL: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  APP_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:5173'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(200),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(300),
  RUN_WORKER_IN_PROCESS: z.enum(['true', 'false']).default('true'),
  SERVE_WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;

if (config.NODE_ENV === 'production' && config.APP_SECRET === 'dev-only-secret-change-me-please') {
  console.error('APP_SECRET must be set in production');
  process.exit(1);
}

export const isTest = config.NODE_ENV === 'test';
export const cookieSecure = config.COOKIE_SECURE ? config.COOKIE_SECURE === 'true' : config.NODE_ENV === 'production';
