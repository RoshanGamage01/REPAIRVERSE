import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { one } from '../src/db/pool.js';

export const app = createApp();

export async function resetDb() {
  await migrate({ reset: true });
  await seed({ demo: true, adminEmail: 'admin@test.dev', adminPassword: 'admin-password-123', quiet: true });
}

/** A cookie-holding client that sends the anti-CSRF header on every request. */
export function client() {
  const agent = request.agent(app);
  const wrap = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => agent[m](url).set('X-Requested-With', 'repairverse');
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete'), agent };
}

export async function login(email: string, password: string) {
  const c = client();
  const r = await c.post('/api/v1/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

export async function register(email: string, accountType: 'consumer' | 'technician' = 'consumer', extra: Record<string, unknown> = {}) {
  const c = client();
  const r = await c.post('/api/v1/auth/register').send({ email, password: 'correct-horse-battery', displayName: email.split('@')[0], accountType, ...extra });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  return { c, user: r.body.user };
}

export const idOf = async (sql: string, params: unknown[] = []) => (await one(sql, params))!.id as string;
