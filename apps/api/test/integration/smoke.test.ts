import { beforeAll, describe, expect, it } from 'vitest';
import { client, idOf, login, resetDb } from '../helpers.js';

/** Every read endpoint, as every role: no 5xx allowed. Catches SQL/serialization errors outside the scenarios. */
describe('endpoint smoke test', () => {
  beforeAll(resetDb);

  it('serves all GET endpoints without server errors', async () => {
    const admin = await login('admin@test.dev', 'admin-password-123');
    const tech = await login('tech@repairverse.dev', 'demo-password-123');
    const consumer = await login('demo@repairverse.dev', 'demo-password-123');
    const anon = client();
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const componentId = await idOf(`SELECT id FROM product_components WHERE product_id = $1 LIMIT 1`, [productId]);
    const partId = await idOf(`SELECT id FROM parts LIMIT 1`);
    const fmId = await idOf(`SELECT id FROM failure_modes LIMIT 1`);
    const procId = await idOf(`SELECT id FROM repair_procedures LIMIT 1`);
    const docId = await idOf(`SELECT id FROM documents LIMIT 1`);
    const deviceId = await idOf(`SELECT id FROM devices WHERE owner_user_id IS NOT NULL LIMIT 1`);
    const job = await tech.post('/api/v1/pro/jobs').send({ customerName: 'C', complaint: 'no power', device: { nickname: 'X', productId } });

    const urls = [
      '/api/v1/status', '/api/v1/auth/me', '/api/v1/categories', '/api/v1/component-types', '/api/v1/tools', '/api/v1/brands', '/api/v1/manufacturers', '/api/v1/symptoms',
      '/api/v1/products', '/api/v1/products?q=aurora', `/api/v1/products/${productId}`, '/api/v1/products/demo-devices-aurora-14-ar14-23', `/api/v1/components/${componentId}`,
      '/api/v1/saved', '/api/v1/auth/technicians', '/api/v1/auth/technicians?lat=51.5&lng=-0.12&radiusKm=20', '/api/v1/auth/me/technician-profile',
      '/api/v1/parts', '/api/v1/parts?q=panel', `/api/v1/parts/${partId}`, '/api/v1/parts/providers', `/api/v1/parts/for-product/${productId}`,
      `/api/v1/procedures/${procId}`, '/api/v1/procedures/laptop-reseat-memory', '/api/v1/knowledge/search?q=backlight', '/api/v1/knowledge/failure-modes', `/api/v1/knowledge/failure-modes/${fmId}`,
      '/api/v1/knowledge/sources', '/api/v1/knowledge/documents', `/api/v1/knowledge/documents/${docId}`, '/api/v1/knowledge/graph/stats',
      '/api/v1/library/devices', `/api/v1/library/devices/${deviceId}`, '/api/v1/library/history', '/api/v1/library/reminders', `/api/v1/library/devices/${deviceId}/export`,
      '/api/v1/diagnoses', '/api/v1/contributions/mine', '/api/v1/developer/clients',
      '/api/v1/pro/overview', '/api/v1/pro/jobs', '/api/v1/pro/organization', `/api/v1/pro/jobs/${job.body.id}`, `/api/v1/pro/jobs/${job.body.id}/quote`, `/api/v1/pro/jobs/${job.body.id}/report`,
      '/api/v1/moderation/contributions', '/api/v1/moderation/contributions?status=all', '/api/v1/moderation/reports',
      '/api/v1/admin/overview', '/api/v1/admin/metrics', '/api/v1/admin/users', '/api/v1/admin/organizations', '/api/v1/admin/verification-requests', '/api/v1/admin/ai/config',
      '/api/v1/admin/ai/usage', '/api/v1/admin/ai/content', '/api/v1/admin/system/health', '/api/v1/admin/jobs', '/api/v1/admin/audit-logs', '/api/v1/admin/api-clients',
      '/api/public/v1/openapi.json', '/healthz',
    ];
    const failures: string[] = [];
    for (const [name, c] of Object.entries({ admin, tech, consumer, anon })) {
      for (const u of urls) {
        const r = await c.get(u);
        if (r.status >= 500) failures.push(`${name} ${u} → ${r.status}`);
      }
    }
    expect(failures).toEqual([]);
    // Spot-check authorization boundaries
    expect((await consumer.get('/api/v1/admin/users')).status).toBe(403);
    expect((await anon.get('/api/v1/admin/metrics')).status).toBe(401);
    expect((await consumer.get(`/api/v1/pro/jobs/${job.body.id}`)).status).toBe(403);
    expect((await admin.get('/api/v1/admin/metrics')).body.metrics).toHaveLength(13);
  });
});
