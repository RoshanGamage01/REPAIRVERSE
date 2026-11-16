import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { client, idOf, register, resetDb } from '../helpers.js';
import { one } from '../../src/db/pool.js';

describe('Scenario A — consumer repair', () => {
  beforeAll(resetDb);

  it('runs the full consumer repair journey', async () => {
    // 1. Register
    const { c, user } = await register('alex@example.com');
    expect(user.role).toBe('consumer');

    // 2. Photograph a laptop (real image upload; EXIF/metadata stripped server-side)
    const img = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#333' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).toBuffer();
    const up = await c.post('/api/v1/files').attach('files', img, { filename: 'laptop.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(201);
    const fileId = up.body.files[0].id;
    const stored = await one('SELECT kind, mime_type FROM files WHERE id = $1', [fileId]);
    expect(stored.kind).toBe('image');

    // 3. Identification: photo alone (no AI configured) → requests more information, never guesses
    const id1 = await c.post('/api/v1/identifications').send({ fileIds: [fileId], text: 'my laptop' });
    expect(id1.status).toBe(201);
    expect(id1.body.status).toBe('needs_more_info');
    expect(id1.body.needs.length).toBeGreaterThan(0);
    expect(id1.body.categoryHint.slug).toBe('laptops-computers');
    expect(id1.body.observations.join(' ')).toMatch(/AI provider/);

    //    …user adds the model number → candidate with evidence; user confirms
    const id2 = await c.post('/api/v1/identifications').send({ modelNumber: 'AR14-23', fileIds: [fileId] });
    expect(id2.body.status).toBe('candidates');
    const top = id2.body.candidates[0];
    expect(top.name).toBe('Aurora 14');
    expect(top.confidence).toBeLessThan(1);
    expect(top.matchedBy.join(' ')).toMatch(/Model number/);
    const productId = top.productId;
    const variantId = await idOf(`SELECT id FROM product_variants WHERE variant_code = 'AR14-23-F'`);
    const conf = await c.post(`/api/v1/identifications/${id2.body.id}/confirm`).send({ productId, variantId });
    expect(conf.body.corrected).toBe(false);

    // Save the device to the library
    const dev = await c.post('/api/v1/library/devices').send({ productId, variantId, nickname: 'Work laptop', purchaseDate: '2023-03-01' });
    expect(dev.status).toBe(201);
    const deviceId = dev.body.id;

    // 4–5. Describe the black-screen problem → hypotheses
    const d0 = await c.post('/api/v1/diagnoses').send({ productId, deviceId, description: 'My laptop turns on, but the screen stays black. The keyboard lights are working.' });
    expect(d0.status).toBe(201);
    expect(d0.body.interpretation.method).toBe('lexical');
    expect(d0.body.journey.filter((j: any) => j.type === 'symptom')).toHaveLength(3);
    expect(d0.body.hypotheses.length).toBeGreaterThanOrEqual(3);
    for (const h of d0.body.hypotheses) expect(h.status).toBe('hypothesis');
    expect(d0.body.unknownProbability).toBeGreaterThan(0);
    expect(d0.body.disclaimer).toMatch(/not confirmed/);
    expect(d0.body.nextQuestions[0].prompt).toMatch(/external monitor|flashlight/i);

    // 6–7. Answer questions → diagnosis updates
    const ext = d0.body.nextQuestions.find((q: any) => /external monitor/i.test(q.prompt));
    const d1 = await c.post(`/api/v1/diagnoses/${d0.body.id}/answers`).send({ probeId: ext.probeId, answer: 'yes' });
    const flash = d1.body.nextQuestions.find((q: any) => /flashlight/i.test(q.prompt));
    expect(flash).toBeTruthy();
    const d2 = await c.post(`/api/v1/diagnoses/${d0.body.id}/answers`).send({ probeId: flash.probeId, answer: 'yes' });
    expect(d2.body.hypotheses[0].name).toBe('Display backlight failure');
    expect(d2.body.hypotheses[0].probability).toBeGreaterThan(d0.body.hypotheses.find((h: any) => h.name === 'Display backlight failure').probability);
    expect(d2.body.hypotheses[0].supportingEvidence.some((e: any) => e.kind === 'answer')).toBe(true);

    //    Go back and change an answer — the journey keeps the update
    const d3 = await c.post(`/api/v1/diagnoses/${d0.body.id}/answers`).send({ probeId: flash.probeId, answer: 'no' });
    expect(d3.body.hypotheses[0].name).not.toBe('Display backlight failure');
    const d4 = await c.post(`/api/v1/diagnoses/${d0.body.id}/answers`).send({ probeId: flash.probeId, answer: 'yes' });
    expect(d4.body.hypotheses[0].name).toBe('Display backlight failure');
    expect(d4.body.journey.filter((j: any) => j.probeId === flash.probeId)).toHaveLength(1);

    // 8. Safe repair recommendation: guide + repair-vs-replace
    const cableFm = d4.body.hypotheses.find((h: any) => h.name === 'Loose or damaged display cable');
    const guide = await c.post(`/api/v1/diagnoses/${d0.body.id}/guide`).send({ failureModeId: cableFm.failureModeId });
    expect(guide.status).toBe(200);
    expect(guide.body.procedures[0].steps.length).toBeGreaterThan(0);
    expect(guide.body.procedures[0].provenance).toBe('demo');
    expect(guide.body.safety.level).toBe('medium');
    expect(guide.body.status).toBe('hypothesis');
    const aiGuide = await c.post(`/api/v1/diagnoses/${d0.body.id}/guide`).send({ failureModeId: cableFm.failureModeId, generate: true });
    expect(aiGuide.body.aiGuide.status).toBe('not_configured'); // no fake AI output

    const decision = await c.post('/api/v1/decisions').send({ diagnosisId: d0.body.id, replacementCostCents: 90000 });
    expect(decision.status).toBe(200);
    expect(['repair_recommended', 'more_diagnosis_required', 'professional_repair_recommended']).toContain(decision.body.recommendation);
    expect(decision.body.factors.length).toBeGreaterThan(3);
    expect(decision.body.caveats.join(' ')).toMatch(/does not estimate market prices/);

    // 9. Parts and compatibility for the display panel
    const panelType = await idOf(`SELECT id FROM component_types WHERE slug = 'display-panel'`);
    const parts = await c.get(`/api/v1/parts/for-product/${productId}?variantId=${variantId}&componentTypeId=${panelType}`);
    expect(parts.body.confirmed.map((p: any) => p.part.partNumber)).toContain('DP-140F30');
    expect(parts.body.incompatible.map((p: any) => p.part.partNumber)).toEqual(expect.arrayContaining(['DP-140Q40', 'GX156-FHD30']));
    expect(parts.body.potential.map((p: any) => p.part.partNumber)).toContain('GX140-FHD30');

    // 10. Save to history
    const done = await c.post(`/api/v1/diagnoses/${d0.body.id}/complete`).send({ save: true });
    expect(done.body.status).toBe('completed');
    const hist = await c.get('/api/v1/library/history');
    expect(hist.body.diagnoses.some((d: any) => d.id === d0.body.id)).toBe(true);
    const devView = await c.get(`/api/v1/library/devices/${deviceId}`);
    expect(devView.body.events.some((e: any) => e.kind === 'diagnosis')).toBe(true);
    const csv = await c.get(`/api/v1/library/devices/${deviceId}/export?format=csv`);
    expect(csv.text).toMatch(/Diagnosis completed/);
  });

  it('protects private data between users', async () => {
    const a = await register('owner@example.com');
    const b = await register('intruder@example.com');
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const d = await a.c.post('/api/v1/diagnoses').send({ productId, description: 'screen stays black' });
    expect((await b.c.get(`/api/v1/diagnoses/${d.body.id}`)).status).toBe(403);
    const dev = await a.c.post('/api/v1/library/devices').send({ nickname: 'Mine' });
    expect((await b.c.get(`/api/v1/library/devices/${dev.body.id}`)).status).toBe(403);
    expect((await client().get('/api/v1/library/devices')).status).toBe(401);
  });

  it('withholds high-risk steps from consumers and stops on hazards', async () => {
    const { c } = await register('tvowner@example.com');
    const tv = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-lumen-55-lm55'`);
    const d = await c.post('/api/v1/diagnoses').send({ productId: tv, description: 'No picture but sound works and the power light is on' });
    const back = d.body.hypotheses.find((h: any) => h.name === 'LED backlight failure');
    expect(back.safety.professionalOnly).toBe(true);
    const g = await c.post(`/api/v1/diagnoses/${d.body.id}/guide`).send({ failureModeId: back.failureModeId, generate: true });
    expect(g.body.professionalOnly).toBe(true);
    expect(g.body.procedures[0].steps).toHaveLength(0);
    expect(g.body.procedures[0].stepsWithheld).toBe(true);
    expect(g.body.aiGuide.status).toBe('refused');
  });

  it('requires the anti-CSRF header for cookie-authenticated mutations', async () => {
    const { c } = await register('csrf@example.com');
    const r = await c.agent.post('/api/v1/library/devices').send({ nickname: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf');
  });
});
