/**
 * Knowledge confidence and contributor reputation (deterministic).
 *
 * Confidence grows with source reliability, independent corroboration and sample size —
 * never from a single report. Reputation rewards accuracy and verified outcomes, with
 * diminishing returns on volume so that submission count alone cannot dominate.
 */

export const MIN_SAMPLE_FOR_STATISTICS = 20;
const TIER_BASE = [0.2, 0.3, 0.45, 0.6, 0.72, 0.85];

export function knowledgeConfidence(input: { bestSourceTier: number | null; independentReporters: number; verifiedCases: number; isDemo?: boolean }): number {
  const tier = Math.max(0, Math.min(5, input.bestSourceTier ?? 0));
  let c = TIER_BASE[tier];
  // Each independent reporter shrinks residual doubt; capped so no amount of reports reaches certainty.
  const reporters = Math.min(input.independentReporters, 12);
  c = 1 - (1 - c) * Math.pow(0.86, reporters);
  // Sample size adds a smaller, saturating contribution (repeat cases from the same reporter count little).
  c = 1 - (1 - c) * Math.pow(0.97, Math.min(input.verifiedCases, 50));
  if (input.isDemo) c = Math.min(c, 0.35);
  return Math.round(Math.min(c, 0.97) * 1000) / 1000;
}

/** Wilson score interval (95%) for a proportion. Returns null below the minimum sample size. */
export function wilsonInterval(successes: number, total: number, minSample = MIN_SAMPLE_FOR_STATISTICS): { rate: number; low: number; high: number; n: number } | null {
  if (total < minSample || total === 0) return null;
  const z = 1.96;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { rate: p, low: (centre - margin) / denom, high: (centre + margin) / denom, n: total };
}

/**
 * Bayesian update of P(symptom | failure) from verified outcomes.
 * The stored likelihood acts as a Beta prior with `strength` pseudo-observations.
 */
export function updatedLikelihood(prior: number, observedWithSymptom: number, totalCases: number, strength = 10): number {
  const v = (prior * strength + observedWithSymptom) / (strength + totalCases);
  return Math.min(0.98, Math.max(0.02, v));
}

/** Effective prior weight: base prior boosted by independently-corroborated verified cases. */
export function effectivePrior(basePrior: number, verifiedCases: number, independentReporters: number): number {
  const effectiveCases = Math.min(verifiedCases, independentReporters * 3);
  return Math.round(basePrior * (1 + 0.15 * effectiveCases) * 1000) / 1000;
}

export interface ReviewSignal {
  decision: 'approved' | 'rejected';
  type: string;
  evidenceCount: number;
  bestSourceTier: number;
  corroborated: boolean; // independently confirmed by another contributor's verified record
  succeeded?: boolean | null;
  priorApprovedCount: number;
}

/** Reputation delta for a reviewed contribution. Quality-weighted, with diminishing returns on volume. */
export function reputationDelta(s: ReviewSignal): { delta: number; reason: string } {
  if (s.decision === 'rejected') return { delta: -3, reason: 'Contribution rejected after review' };
  let base = 4;
  const reasons = ['approved'];
  if (s.evidenceCount > 0) {
    base += Math.min(3, s.evidenceCount);
    reasons.push('with evidence');
  }
  if (s.bestSourceTier >= 4) {
    base += 3;
    reasons.push('high-quality source');
  }
  if (s.corroborated) {
    base += 4;
    reasons.push('independently corroborated');
  }
  if (s.type === 'repair_outcome' && s.succeeded === false) {
    base += 1; // failed attempts are valuable knowledge, not penalised
    reasons.push('documented failed attempt');
  }
  const volumeDamping = 1 / Math.sqrt(1 + s.priorApprovedCount / 10);
  return { delta: Math.round(base * volumeDamping * 100) / 100, reason: `Contribution ${reasons.join(', ')}` };
}
