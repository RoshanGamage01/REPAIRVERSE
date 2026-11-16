/**
 * Diagnostic reasoning engine (pure, deterministic).
 *
 * Model: a naive-Bayes style posterior over candidate failure modes F plus an explicit
 * residual hypothesis U ("cause not represented in the knowledge base").
 *
 *   score(f) = log prior(f) + Σ_s log P(s | f) + Σ_probes log P(answer | f)
 *
 * - P(s|f) comes from FailureMode CAUSES_SYMPTOM edges; unlinked symptoms get a small
 *   background rate so a single unexplained symptom does not eliminate a hypothesis.
 * - Probe answer likelihoods are derived from stored likelihood ratios, normalised into a
 *   proper conditional distribution over the probe's options.
 * - U keeps probability mass for unknown causes, which prevents the engine from becoming
 *   confident merely because the knowledge base is small.
 *
 * Question selection maximises expected information gain (entropy reduction), with a cost
 * penalty for physical tests relative to simple questions, and respects safety: probes whose
 * risk exceeds what the viewer may perform are never suggested.
 *
 * The engine never "confirms" a fault: its output is a ranked set of hypotheses.
 */
import type { RiskLevel } from '@repairverse/shared';

export const UNKNOWN_ID = 'unknown';
const UNLINKED_SYMPTOM_P = 0.03;
const UNKNOWN_SYMPTOM_FLOOR = 0.05;
const UNKNOWN_PRIOR_SHARE = 0.18; // residual prior mass relative to total known prior
export const UNSURE = 'unsure';

export interface FMNode {
  id: string;
  name: string;
  componentTypeId: string;
  componentName?: string;
  priorWeight: number;
  riskLevel: RiskLevel;
  symptomLikelihoods: Record<string, number>; // symptomId -> P(s|f)
}

export interface ProbeNode {
  id: string;
  kind: 'question' | 'test';
  prompt: string;
  riskLevel: RiskLevel;
  options: { value: string; label: string }[];
  /** answer -> failureModeId -> likelihood ratio (default 1). */
  effects: Record<string, Record<string, number>>;
}

export interface Observations {
  symptomIds: string[];
  answers: { probeId: string; answer: string }[];
}

export interface Hypothesis {
  failureModeId: string;
  name: string;
  probability: number;
  supporting: { kind: 'symptom' | 'answer'; id: string; weight: number }[];
  contradicting: { kind: 'symptom' | 'answer'; id: string; weight: number }[];
}

export interface ProbeSuggestion {
  probeId: string;
  kind: 'question' | 'test';
  prompt: string;
  expectedInformationGain: number;
  discriminates: string[]; // failure mode ids most affected
}

export interface DiagnosisResult {
  hypotheses: Hypothesis[];
  unknownProbability: number;
  entropyBits: number;
  nextProbes: ProbeSuggestion[];
  readiness: 'needs_more_information' | 'leading_hypothesis' | 'no_further_questions';
  evidenceCount: number;
}

function log(x: number) {
  return Math.log(Math.max(x, 1e-12));
}

function normalise(scores: Map<string, number>): Map<string, number> {
  const max = Math.max(...scores.values());
  let sum = 0;
  const exp = new Map<string, number>();
  for (const [k, v] of scores) {
    const e = Math.exp(v - max);
    exp.set(k, e);
    sum += e;
  }
  for (const [k, v] of exp) exp.set(k, v / sum);
  return exp;
}

export function entropy(p: Iterable<number>): number {
  let h = 0;
  for (const x of p) if (x > 0) h -= x * Math.log2(x);
  return h;
}

/** P(answer | f) for every option, from likelihood ratios. Unknown bucket answers uniformly. */
export function answerDistribution(probe: ProbeNode, fmId: string): Record<string, number> {
  const opts = probe.options.map((o) => o.value).filter((v) => v !== UNSURE);
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const a of opts) {
    const lr = fmId === UNKNOWN_ID ? 1 : probe.effects[a]?.[fmId] ?? 1;
    raw[a] = lr;
    sum += lr;
  }
  for (const a of opts) raw[a] = raw[a] / sum;
  return raw;
}

function scoreAll(fms: FMNode[], probes: Map<string, ProbeNode>, obs: Observations) {
  const totalPrior = fms.reduce((s, f) => s + f.priorWeight, 0) || 1;
  const scores = new Map<string, number>();
  const trace = new Map<string, { supporting: Hypothesis['supporting']; contradicting: Hypothesis['contradicting'] }>();
  const symptomIds = [...new Set(obs.symptomIds)];
  // P(s | unknown cause): the prior-weighted marginal rate of the symptom across known failures.
  // An unrepresented cause is assumed to produce symptoms at the population rate, so the residual
  // keeps its share unless evidence specifically favours a known failure mode.
  const unknownSymptomP = new Map<string, number>();
  for (const sid of symptomIds) {
    let m = 0;
    for (const f of fms) m += (f.priorWeight / totalPrior) * (f.symptomLikelihoods[sid] ?? UNLINKED_SYMPTOM_P);
    unknownSymptomP.set(sid, Math.max(UNKNOWN_SYMPTOM_FLOOR, m));
  }

  for (const f of fms) {
    let s = log(f.priorWeight / totalPrior);
    const supporting: Hypothesis['supporting'] = [];
    const contradicting: Hypothesis['contradicting'] = [];
    for (const sid of symptomIds) {
      const p = f.symptomLikelihoods[sid];
      if (p !== undefined) {
        s += log(p);
        supporting.push({ kind: 'symptom', id: sid, weight: p / unknownSymptomP.get(sid)! });
      } else {
        s += log(UNLINKED_SYMPTOM_P);
        contradicting.push({ kind: 'symptom', id: sid, weight: UNLINKED_SYMPTOM_P / unknownSymptomP.get(sid)! });
      }
    }
    for (const a of obs.answers) {
      if (a.answer === UNSURE) continue;
      const probe = probes.get(a.probeId);
      if (!probe) continue;
      const dist = answerDistribution(probe, f.id);
      const base = answerDistribution(probe, UNKNOWN_ID);
      const p = dist[a.answer];
      if (p === undefined) continue;
      s += log(p);
      const ratio = p / base[a.answer];
      if (ratio > 1.05) supporting.push({ kind: 'answer', id: a.probeId, weight: ratio });
      else if (ratio < 0.95) contradicting.push({ kind: 'answer', id: a.probeId, weight: ratio });
    }
    scores.set(f.id, s);
    trace.set(f.id, { supporting, contradicting });
  }

  // Residual hypothesis.
  let u = log(UNKNOWN_PRIOR_SHARE / (1 + UNKNOWN_PRIOR_SHARE));
  // Known priors are scaled by 1/(1+share) so the residual takes its share of total mass.
  for (const [k, v] of scores) scores.set(k, v + log(1 / (1 + UNKNOWN_PRIOR_SHARE)));
  for (const sid of symptomIds) u += log(unknownSymptomP.get(sid)!);
  for (const a of obs.answers) {
    if (a.answer === UNSURE) continue;
    const probe = probes.get(a.probeId);
    if (!probe) continue;
    const p = answerDistribution(probe, UNKNOWN_ID)[a.answer];
    if (p !== undefined) u += log(p);
  }
  scores.set(UNKNOWN_ID, u);
  return { posterior: normalise(scores), trace };
}

function posteriorAfter(fms: FMNode[], probes: Map<string, ProbeNode>, obs: Observations) {
  return scoreAll(fms, probes, obs).posterior;
}

export function diagnose(
  fms: FMNode[],
  probeList: ProbeNode[],
  obs: Observations,
  opts: { maxProbeRisk?: RiskLevel; maxSuggestions?: number; minProbability?: number } = {},
): DiagnosisResult {
  const probes = new Map(probeList.map((p) => [p.id, p]));
  const { posterior, trace } = scoreAll(fms, probes, obs);
  const minP = opts.minProbability ?? 0.01;

  const hypotheses: Hypothesis[] = fms
    .map((f) => ({
      failureModeId: f.id,
      name: f.name,
      probability: posterior.get(f.id) ?? 0,
      supporting: trace.get(f.id)!.supporting.sort((a, b) => b.weight - a.weight),
      contradicting: trace.get(f.id)!.contradicting.sort((a, b) => a.weight - b.weight),
    }))
    .filter((h) => h.probability >= minP)
    .sort((a, b) => b.probability - a.probability);

  const current = [...posterior.values()];
  const h0 = entropy(current);
  const answered = new Set(obs.answers.map((a) => a.probeId));
  const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  const maxRisk = riskRank[opts.maxProbeRisk ?? 'medium'];
  const relevant = new Set(hypotheses.filter((h) => h.probability >= 0.02).map((h) => h.failureModeId));

  const suggestions: ProbeSuggestion[] = [];
  for (const probe of probeList) {
    if (answered.has(probe.id) || riskRank[probe.riskLevel] > maxRisk) continue;
    const touched = new Set<string>();
    for (const a of Object.keys(probe.effects)) for (const fid of Object.keys(probe.effects[a])) if (relevant.has(fid)) touched.add(fid);
    if (!touched.size) continue;
    // Expected posterior entropy over answers.
    const options = probe.options.map((o) => o.value).filter((v) => v !== UNSURE);
    let expected = 0;
    for (const a of options) {
      let pa = 0;
      for (const [fid, pf] of posterior) pa += pf * (answerDistribution(probe, fid)[a] ?? 0);
      if (pa <= 1e-9) continue;
      const post = posteriorAfter(fms, probes, { ...obs, answers: [...obs.answers, { probeId: probe.id, answer: a }] });
      expected += pa * entropy(post.values());
    }
    const gain = Math.max(0, h0 - expected);
    const cost = probe.kind === 'test' ? 0.35 + riskRank[probe.riskLevel] * 0.25 : 0;
    suggestions.push({
      probeId: probe.id,
      kind: probe.kind,
      prompt: probe.prompt,
      expectedInformationGain: gain / (1 + cost),
      discriminates: [...touched].sort((a, b) => (posterior.get(b) ?? 0) - (posterior.get(a) ?? 0)).slice(0, 4),
    });
  }
  suggestions.sort((a, b) => b.expectedInformationGain - a.expectedInformationGain);
  const useful = suggestions.filter((s) => s.expectedInformationGain > 0.02);
  const top = hypotheses[0]?.probability ?? 0;
  const readiness: DiagnosisResult['readiness'] = top >= 0.7 ? 'leading_hypothesis' : useful.length ? 'needs_more_information' : 'no_further_questions';

  return {
    hypotheses,
    unknownProbability: posterior.get(UNKNOWN_ID) ?? 0,
    entropyBits: h0,
    nextProbes: useful.slice(0, opts.maxSuggestions ?? 3),
    readiness,
    evidenceCount: new Set(obs.symptomIds).size + obs.answers.filter((a) => a.answer !== UNSURE).length,
  };
}
