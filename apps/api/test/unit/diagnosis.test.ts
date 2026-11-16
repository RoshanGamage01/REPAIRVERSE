import { describe, expect, it } from 'vitest';
import { diagnose, answerDistribution, UNKNOWN_ID, type FMNode, type ProbeNode } from '../../src/engines/diagnosis.js';

const fms: FMNode[] = [
  { id: 'backlight', name: 'Backlight', componentTypeId: 'c1', priorWeight: 1, riskLevel: 'medium', symptomLikelihoods: { black: 0.85, on: 0.9 } },
  { id: 'ram', name: 'RAM', componentTypeId: 'c2', priorWeight: 1, riskLevel: 'medium', symptomLikelihoods: { black: 0.8, on: 0.9, beeps: 0.5 } },
  { id: 'charger', name: 'Charger', componentTypeId: 'c3', priorWeight: 1, riskLevel: 'low', symptomLikelihoods: { nocharge: 0.8 } },
];
const probes: ProbeNode[] = [
  { id: 'flash', kind: 'test', prompt: 'Faint image?', riskLevel: 'low', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], effects: { yes: { backlight: 9, ram: 0.1 }, no: { backlight: 0.15, ram: 1.4 } } },
  { id: 'irrelevant', kind: 'question', prompt: 'Charger LED?', riskLevel: 'low', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], effects: { yes: { charger: 0.5 }, no: { charger: 3 } } },
  { id: 'danger', kind: 'test', prompt: 'Probe the PSU', riskLevel: 'high', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], effects: { yes: { backlight: 5 }, no: { backlight: 0.2 } } },
];

describe('diagnosis engine', () => {
  it('ranks failure modes that explain the reported symptoms', () => {
    const r = diagnose(fms, probes, { symptomIds: ['black', 'on'], answers: [] });
    expect(r.hypotheses.map((h) => h.failureModeId).slice(0, 2).sort()).toEqual(['backlight', 'ram']);
    expect(r.hypotheses.find((h) => h.failureModeId === 'charger')?.probability ?? 0).toBeLessThan(0.05);
  });

  it('keeps probability mass for causes outside the knowledge base', () => {
    const r = diagnose(fms, probes, { symptomIds: ['black', 'on'], answers: [] });
    expect(r.unknownProbability).toBeGreaterThan(0.05);
    const sum = r.hypotheses.reduce((s, h) => s + h.probability, 0) + r.unknownProbability;
    expect(sum).toBeLessThanOrEqual(1.0001);
  });

  it('selects the most informative safe probe and updates on answers', () => {
    const r0 = diagnose(fms, probes, { symptomIds: ['black', 'on'], answers: [] });
    expect(r0.nextProbes[0].probeId).toBe('flash');
    expect(r0.nextProbes.find((p) => p.probeId === 'danger')).toBeUndefined(); // high-risk excluded by default
    const r1 = diagnose(fms, probes, { symptomIds: ['black', 'on'], answers: [{ probeId: 'flash', answer: 'yes' }] });
    expect(r1.hypotheses[0].failureModeId).toBe('backlight');
    expect(r1.hypotheses[0].probability).toBeGreaterThan(r0.hypotheses.find((h) => h.failureModeId === 'backlight')!.probability);
    expect(r1.hypotheses[0].supporting.some((e) => e.kind === 'answer' && e.id === 'flash')).toBe(true);
  });

  it('offers high-risk probes only when permitted', () => {
    const r = diagnose(fms, probes, { symptomIds: ['black', 'on'], answers: [{ probeId: 'flash', answer: 'yes' }] }, { maxProbeRisk: 'high', maxSuggestions: 5 });
    expect(r.nextProbes.some((p) => p.probeId === 'danger')).toBe(true);
  });

  it('treats "unsure" answers as no evidence', () => {
    const a = diagnose(fms, probes, { symptomIds: ['black'], answers: [] });
    const b = diagnose(fms, probes, { symptomIds: ['black'], answers: [{ probeId: 'flash', answer: 'unsure' }] });
    expect(b.hypotheses[0].probability).toBeCloseTo(a.hypotheses[0].probability, 6);
  });

  it('derives proper conditional answer distributions from likelihood ratios', () => {
    const d = answerDistribution(probes[0], 'backlight');
    expect(d.yes + d.no).toBeCloseTo(1);
    expect(d.yes).toBeGreaterThan(0.9);
    const u = answerDistribution(probes[0], UNKNOWN_ID);
    expect(u.yes).toBeCloseTo(0.5);
  });

  it('is deterministic', () => {
    const o = { symptomIds: ['black', 'on'], answers: [{ probeId: 'flash', answer: 'no' }] };
    expect(diagnose(fms, probes, o)).toEqual(diagnose(fms, probes, o));
  });
});
