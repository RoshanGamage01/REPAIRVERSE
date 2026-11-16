import { beforeAll, describe, expect, it } from 'vitest';
import { idOf, register, resetDb, login } from '../helpers.js';
import { one } from '../../src/db/pool.js';

describe('Scenario B — technician repair', () => {
  beforeAll(resetDb);

  it('runs a repair job from intake to knowledge contribution', async () => {
    // 1. Technician registers (gets a business workspace; NOT verified)
    const { c, user } = await register('sam@fixshop.example', 'technician', { businessName: 'Sam Fix Shop' });
    expect(user.role).toBe('technician');
    expect(user.technicianVerified).toBe(false);
    expect(user.memberships[0].name).toBe('Sam Fix Shop');

    // 2–4. Create job, register device, record symptoms
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const job = await c.post('/api/v1/pro/jobs').send({
      customerName: 'Jordan Customer',
      customerContact: 'jordan@example.com',
      complaint: 'Laptop turns on but the screen stays black. Keyboard lights work.',
      intakeCondition: 'Minor scuffs on lid',
      device: { productId, nickname: 'Aurora 14 (customer)', serialNumber: 'SN-123' },
    });
    expect(job.status).toBe(201);
    const jobId = job.body.id;

    // Illegal transitions are rejected by the deterministic workflow
    expect((await c.post(`/api/v1/pro/jobs/${jobId}/status`).send({ status: 'testing' })).status).toBe(400);

    // 5. AI-assisted diagnosis — recorded as suggestions, not confirmations
    const diag = await c.post(`/api/v1/pro/jobs/${jobId}/diagnose`).send({ symptoms: 'Faint image visible with a torch' });
    expect(diag.status).toBe(200);
    expect(diag.body.hypotheses.length).toBeGreaterThan(0);
    let detail = await c.get(`/api/v1/pro/jobs/${jobId}`);
    expect(detail.body.job.status).toBe('diagnosing');
    expect(detail.body.findings.every((f: any) => f.kind === 'ai_suggestion')).toBe(true);

    // Technician runs tests through the wizard (verified techs can do higher-risk tests; this one is low risk)
    const flash = diag.body.nextQuestions.find((q: any) => /flashlight/i.test(q.prompt)) ?? diag.body.nextQuestions[0];
    await c.post(`/api/v1/diagnoses/${diag.body.id}/answers`).send({ probeId: flash.probeId, answer: 'yes' });

    // 6. Technician confirms the actual failure
    const fm = await idOf(`SELECT id FROM failure_modes WHERE slug = 'laptop-display-cable-fault'`);
    expect((await c.post(`/api/v1/pro/jobs/${jobId}/findings`).send({ kind: 'confirmed_diagnosis', failureModeId: fm, text: 'Display cable worn through at the hinge' })).status).toBe(201);

    // Quote
    const cablePart = await idOf(`SELECT id FROM parts WHERE part_number = 'AR14-EDP30'`);
    await c.post(`/api/v1/pro/jobs/${jobId}/quote-items`).send({ kind: 'part', description: 'Display cable', partId: cablePart, quantity: 1, unitPriceCents: 2500 });
    await c.post(`/api/v1/pro/jobs/${jobId}/quote-items`).send({ kind: 'labor', description: 'Labour (1h)', quantity: 1, unitPriceCents: 6000 });
    const quote = await c.get(`/api/v1/pro/jobs/${jobId}/quote`);
    expect(quote.body.totalCents).toBe(8500);
    expect((await c.post(`/api/v1/pro/jobs/${jobId}/quote/approve`).send({})).status).toBe(200);
    await c.post(`/api/v1/pro/jobs/${jobId}/status`).send({ status: 'waiting_for_approval' });
    await c.post(`/api/v1/pro/jobs/${jobId}/status`).send({ status: 'in_repair' });

    // 7–8. Record the repair and replaced components
    await c.post(`/api/v1/pro/jobs/${jobId}/worklog`).send({ text: 'Replaced display cable, rerouted through hinge channel', minutes: 55 });
    const cableType = await idOf(`SELECT id FROM component_types WHERE slug = 'display-cable'`);
    expect((await c.post(`/api/v1/pro/jobs/${jobId}/replaced-components`).send({ componentTypeId: cableType, partId: cablePart, newPartNumber: 'AR14-EDP30' })).status).toBe(201);

    // 9. Testing
    await c.post(`/api/v1/pro/jobs/${jobId}/status`).send({ status: 'testing' });
    expect((await c.post(`/api/v1/pro/jobs/${jobId}/close`).send({ succeeded: true })).status).toBe(400); // tests required
    await c.post(`/api/v1/pro/jobs/${jobId}/tests`).send({ name: 'Display through full hinge range', result: 'pass' });
    await c.post(`/api/v1/pro/jobs/${jobId}/tests`).send({ name: '30-minute soak test', result: 'pass' });

    // 10. Close → outcome + knowledge contribution (anonymised)
    const closed = await c.post(`/api/v1/pro/jobs/${jobId}/close`).send({ succeeded: true, actualFailureModeId: fm, contributeToKnowledge: true });
    expect(closed.status).toBe(200);
    expect(closed.body.contributionId).toBeTruthy();
    const contrib = await one('SELECT * FROM contributions WHERE id = $1', [closed.body.contributionId]);
    expect(contrib.status).toBe('pending');
    expect(JSON.stringify(contrib.payload)).not.toMatch(/Jordan|jordan@example|SN-123/);
    const outcome = await one('SELECT * FROM repair_outcomes WHERE id = $1', [closed.body.outcomeId]);
    expect(outcome.verification_status).toBe('pending_review'); // not yet trusted knowledge
    expect(outcome.duration_minutes).toBe(55);

    detail = await c.get(`/api/v1/pro/jobs/${jobId}`);
    expect(detail.body.job.status).toBe('completed');
    expect(detail.body.history.map((h: any) => h.to_status)).toEqual(['received', 'diagnosing', 'waiting_for_approval', 'in_repair', 'testing', 'completed']);
    const report = await c.get(`/api/v1/pro/jobs/${jobId}/report`);
    expect(report.body.confirmedDiagnosis).toContain('Loose or damaged display cable');
    expect(report.body.aiSuggestions.length).toBeGreaterThan(0);

    // Pending outcomes do not change the knowledge graph
    const fmRow = await one('SELECT verified_case_count FROM failure_modes WHERE id = $1', [fm]);
    expect(fmRow.verified_case_count).toBe(0);
  });

  it('isolates organizations', async () => {
    const a = await register('a@shop.example', 'technician');
    const b = await register('b@shop.example', 'technician');
    const j = await a.c.post('/api/v1/pro/jobs').send({ customerName: 'X', complaint: 'broken screen', device: { nickname: 'Phone' } });
    expect((await b.c.get(`/api/v1/pro/jobs/${j.body.id}`)).status).toBe(403);
    expect((await b.c.get('/api/v1/pro/jobs')).body.jobs).toHaveLength(0);
    const consumer = await register('notpro@example.com');
    expect((await consumer.c.get('/api/v1/pro/jobs')).status).toBe(403);
  });

  it('only shows technicians as verified after admin review', async () => {
    const tech = await login('tech@repairverse.dev', 'demo-password-123');
    const me = await tech.get('/api/v1/auth/me');
    expect(me.body.user.technicianVerified).toBe(false);
    const admin = await login('admin@test.dev', 'admin-password-123');
    const reqs = await admin.get('/api/v1/admin/verification-requests');
    const r = reqs.body.requests.find((x: any) => x.email === 'tech@repairverse.dev');
    expect((await admin.post(`/api/v1/admin/verification-requests/${r.id}/review`).send({ decision: 'approve', notes: 'Checked demo evidence' })).status).toBe(200);
    expect((await tech.get('/api/v1/auth/me')).body.user.technicianVerified).toBe(true);
  });
});
