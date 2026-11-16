import { beforeAll, describe, expect, it } from 'vitest';
import { login, register, resetDb } from '../helpers.js';

describe('admin extra endpoints', () => {
  beforeAll(resetDb);

  it('lists repair outcomes for staff only', async () => {
    const admin = await login('admin@test.dev', 'admin-password-123');
    const r = await admin.get('/api/v1/admin/repair-outcomes');
    expect(r.status).toBe(200);
    expect(r.body.summary.total).toBe(0);
    expect(Array.isArray(r.body.outcomes)).toBe(true);
    const { c } = await register('nostaff@example.com');
    expect((await c.get('/api/v1/admin/repair-outcomes')).status).toBe(403);
  });

  it('creates component types with normalised compat attributes', async () => {
    const admin = await login('admin@test.dev', 'admin-password-123');
    const r = await admin.post('/api/v1/knowledge/component-types').send({ name: 'Hinge assembly', compatAttributes: ['Model Fit', 'side'], defaultRisk: 'low' });
    expect(r.status).toBe(201);
    const list = await admin.get('/api/v1/component-types');
    const ct = list.body.componentTypes.find((x: any) => x.id === r.body.id);
    expect(ct.compat_attributes).toEqual(['model_fit', 'side']);
    expect((await admin.post('/api/v1/knowledge/component-types').send({ name: 'Hinge assembly' })).status).toBe(409);
    const { c } = await register('nostaff2@example.com');
    expect((await c.post('/api/v1/knowledge/component-types').send({ name: 'X thing' })).status).toBe(403);
  });
});
