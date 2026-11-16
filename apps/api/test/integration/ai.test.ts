import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idOf, register, resetDb } from '../helpers.js';
import { setProviderOverride, type AIProvider, type StructuredRequest } from '../../src/ai/provider.js';
import { one, query } from '../../src/db/pool.js';

/** Scripted provider: returns canned structured outputs so we can test governance around real AI calls. */
class ScriptedProvider implements AIProvider {
  readonly name = 'openai';
  calls: StructuredRequest[] = [];
  constructor(private script: Record<string, (req: StructuredRequest) => unknown>) {}
  isConfigured() { return true; }
  async structured(req: StructuredRequest) {
    this.calls.push(req);
    const fn = this.script[req.schemaName];
    if (!fn) throw new Error(`no script for ${req.schemaName}`);
    return { data: fn(req), usage: { inputTokens: 1000, outputTokens: 200 } };
  }
  async embed() { throw new Error('embeddings not scripted'); }
  async transcribe() { return { text: 'my laptop screen stays black', usage: { inputTokens: 0, outputTokens: 0 } }; }
}

describe('AI governance', () => {
  let provider: ScriptedProvider;
  beforeAll(async () => {
    await resetDb();
    provider = new ScriptedProvider({
      symptom_extraction: () => ({
        symptoms: [
          { slug: 'black-screen', evidence_quote: 'nothing shows' },
          { slug: 'made-up-symptom', evidence_quote: 'nothing shows' }, // not in vocabulary
          { slug: 'overheating', evidence_quote: 'it was boiling hot' }, // quote not in input
        ],
        unmatched_observations: ['user mentions a recent move'],
        safety_flags: [],
      }),
      repair_guide: (req) => ({
        knowledge_sufficient: true, insufficiency_reason: null, objective: 'Reseat the display cable', difficulty: 3, estimated_minutes_min: 30, estimated_minutes_max: 60,
        tools: ['Precision screwdriver set'], safety_requirements: ['Disconnect the battery'], preparation: ['Back up data'],
        steps: [
          { title: 'Open the base', body: 'Remove the bottom cover per service documentation.', expected_observation: null, caution: null, reference_ids: [req.user.match(/ref (\S+?):/)?.[1] ?? 'none', 'chunk:00000000-0000-0000-0000-000000000000'] },
        ],
        verification: ['Image stable'], reassembly: ['Refit cover'], alternatives: [],
      }),
      identification: () => ({ category_slug: 'laptops-computers', brand: 'Demo Devices', manufacturer: null, product_name: 'Aurora 14', model: null, model_variants: [], label_text: ['MODEL AR14-23'], visible_components: ['keyboard', 'trackpad'], physical_condition: 'Used, scuffed lid', possible_damage: ['scratch on lid'], observations: ['14-inch laptop'], confidence: 0.6, needs: [] }),
    });
    setProviderOverride(provider);
  });
  afterAll(() => setProviderOverride(null));

  it('filters hallucinated symptoms and records an auditable, costed AI operation', async () => {
    const { c } = await register('ai@example.com');
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const d = await c.post('/api/v1/diagnoses').send({ productId, description: 'I press power and nothing shows on the display' });
    expect(d.body.interpretation.method).toBe('ai_and_lexical');
    const symptoms = d.body.journey.filter((j: any) => j.type === 'symptom');
    expect(symptoms.map((s: any) => s.label)).toEqual(['Screen stays black']);
    expect(symptoms[0].origin).toBe('ai_extracted');
    // Untrusted user content is delimited in the prompt
    expect(provider.calls[0].user).toMatch(/<untrusted source="user">/);
    const op = await one(`SELECT * FROM ai_operations WHERE operation = 'symptom_extraction' ORDER BY created_at DESC LIMIT 1`);
    expect(op.status).toBe('succeeded');
    expect(Number(op.cost_usd)).toBeGreaterThan(0);
    expect(op.entity_id).toBe(d.body.id);
  });

  it('strips invented citations from generated guides and labels provenance', async () => {
    const { c } = await register('guide@example.com');
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const d = await c.post('/api/v1/diagnoses').send({ productId, description: 'screen stays black' });
    const fm = await idOf(`SELECT id FROM failure_modes WHERE slug = 'laptop-display-cable-fault'`);
    const g = await c.post(`/api/v1/diagnoses/${d.body.id}/guide`).send({ failureModeId: fm, generate: true });
    expect(g.body.aiGuide.status).toBe('generated');
    const refs = g.body.aiGuide.steps[0].references.map((r: any) => r.id);
    expect(refs).not.toContain('chunk:00000000-0000-0000-0000-000000000000');
    expect(g.body.aiGuide.provenance).toBe('ai_generated');
  });

  it('identifies from photos using AI-read label text, never as a confirmation', async () => {
    const { c } = await register('photo@example.com');
    const sharp = (await import('sharp')).default;
    const img = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#888' } }).png().toBuffer();
    const up = await c.post('/api/v1/files').attach('files', img, { filename: 'l.png', contentType: 'image/png' });
    const r = await c.post('/api/v1/identifications').send({ fileIds: [up.body.files[0].id] });
    expect(r.body.status).toBe('candidates');
    expect(r.body.candidates[0].name).toBe('Aurora 14');
    expect(r.body.candidates[0].matchedBy.join(' ')).toMatch(/Label text "MODEL AR14-23"|read from photo/);
    expect(r.body.ai.visible_components).toContain('keyboard');
    expect(r.body.note).toMatch(/until you confirm/);
  });

  it('rejects AI output that fails schema validation', async () => {
    setProviderOverride(new ScriptedProvider({ symptom_extraction: () => ({ symptoms: 'not-an-array' }) }));
    const { c } = await register('invalid@example.com');
    const productId = await idOf(`SELECT id FROM products WHERE slug = 'demo-devices-aurora-14-ar14-23'`);
    const d = await c.post('/api/v1/diagnoses').send({ productId, description: 'My laptop turns on but the screen stays black' });
    expect(d.status).toBe(201);
    expect(d.body.interpretation.aiStatus).toBe('validation_failed');
    expect(d.body.hypotheses.length).toBeGreaterThan(0); // deterministic engine still works
    const rows = await query(`SELECT status FROM ai_operations WHERE status = 'rejected_by_validation'`);
    expect(rows.length).toBeGreaterThan(0);
    setProviderOverride(provider);
  });
});
