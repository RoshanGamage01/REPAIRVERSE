/**
 * Repair-versus-replace decision engine (deterministic, transparent).
 *
 * Only uses figures that have a stated origin: sourced part offers, verified repair-outcome
 * costs, or values supplied by the user. Missing figures are reported as missing, never filled in.
 */
import type { RepairRecommendation, RiskLevel } from '@repairverse/shared';

export interface CostFigure {
  amountCents: number;
  origin: string; // e.g. "part offer from X observed 2026-11-01", "user-provided", "median of 23 verified repairs"
}

export interface DecisionInput {
  diagnosisConfidence: number | null; // posterior of leading hypothesis
  failureModeName: string | null;
  riskLevel: RiskLevel | null;
  difficulty: number | null; // 1..5 from procedure
  partsCost: CostFigure | null;
  partsAvailability: 'available' | 'limited' | 'unavailable' | 'unknown';
  laborCost: CostFigure | null;
  replacementCost: CostFigure | null;
  productAgeYears: number | null;
  underWarranty: boolean | null;
  verifiedRepairSuccess: { successes: number; total: number } | null;
}

export interface DecisionFactor {
  factor: string;
  assessment: string;
  direction: 'favours_repair' | 'favours_replacement' | 'favours_professional' | 'neutral' | 'unknown';
}

export interface DecisionResult {
  recommendation: RepairRecommendation;
  headline: string;
  estimatedRepairCost: { lowCents: number; highCents: number; components: CostFigure[] } | null;
  replacementCost: CostFigure | null;
  costRatio: number | null;
  factors: DecisionFactor[];
  missingInformation: string[];
  caveats: string[];
}

export function decideRepairOrReplace(i: DecisionInput): DecisionResult {
  const factors: DecisionFactor[] = [];
  const missing: string[] = [];
  const caveats = [
    'Costs shown come only from sourced offers, verified repair records or figures you entered. REPAIRVERSE does not estimate market prices.',
  ];

  // 1. Diagnosis certainty gate.
  if (i.diagnosisConfidence === null || i.failureModeName === null) {
    missing.push('A likely diagnosis (complete the diagnostic wizard first).');
  } else if (i.diagnosisConfidence < 0.5) {
    factors.push({ factor: 'Diagnosis certainty', assessment: `Leading hypothesis "${i.failureModeName}" has ${Math.round(i.diagnosisConfidence * 100)}% relative likelihood — not yet decisive.`, direction: 'unknown' });
  } else {
    factors.push({ factor: 'Diagnosis certainty', assessment: `Leading hypothesis "${i.failureModeName}" (${Math.round(i.diagnosisConfidence * 100)}% relative likelihood).`, direction: 'neutral' });
  }

  // 2. Warranty.
  if (i.underWarranty === true) factors.push({ factor: 'Warranty', assessment: 'The device appears to be under warranty. Opening it yourself may void coverage — contact the manufacturer or seller first.', direction: 'favours_professional' });
  else if (i.underWarranty === null) missing.push('Warranty status.');

  // 3. Safety / complexity.
  if (i.riskLevel === 'high') factors.push({ factor: 'Safety', assessment: 'This repair involves high-risk hazards and must be performed by a qualified professional.', direction: 'favours_professional' });
  else if (i.riskLevel === 'medium') factors.push({ factor: 'Safety', assessment: 'Requires opening the device; moderate risk of damage if done incorrectly.', direction: 'neutral' });
  if (i.difficulty !== null) {
    factors.push({
      factor: 'Complexity',
      assessment: `Difficulty ${i.difficulty}/5.${i.difficulty >= 4 ? ' Specialised skills or tools are typically needed.' : ''}`,
      direction: i.difficulty >= 4 ? 'favours_professional' : 'favours_repair',
    });
  } else missing.push('A documented repair procedure (difficulty unknown).');

  // 4. Parts.
  const availabilityText: Record<DecisionInput['partsAvailability'], string> = {
    available: 'Compatible parts are available from sourced offers.',
    limited: 'Compatible parts have limited availability.',
    unavailable: 'No compatible parts are currently available from known sources.',
    unknown: 'Part availability is unknown — no parts provider has sourced offers for a compatible part.',
  };
  factors.push({
    factor: 'Parts availability',
    assessment: availabilityText[i.partsAvailability],
    direction: i.partsAvailability === 'available' ? 'favours_repair' : i.partsAvailability === 'unavailable' ? 'favours_replacement' : 'unknown',
  });

  // 5. Costs.
  const components: CostFigure[] = [];
  if (i.partsCost) components.push(i.partsCost);
  else missing.push('Part cost (no sourced price for a compatible part).');
  if (i.laborCost) components.push(i.laborCost);
  const repairLow = components.reduce((s, c) => s + c.amountCents, 0);
  const estimatedRepairCost = components.length ? { lowCents: repairLow, highCents: repairLow, components } : null;
  if (!i.replacementCost) missing.push('Replacement cost (enter the price of a comparable new or refurbished product).');
  let costRatio: number | null = null;
  if (estimatedRepairCost && i.replacementCost && i.replacementCost.amountCents > 0) {
    costRatio = estimatedRepairCost.highCents / i.replacementCost.amountCents;
    factors.push({
      factor: 'Cost',
      assessment: `Known repair costs are ${Math.round(costRatio * 100)}% of the replacement cost${i.laborCost ? '' : ' (excluding labour)'}.`,
      direction: costRatio >= 0.6 ? 'favours_replacement' : 'favours_repair',
    });
  }

  // 6. Age.
  if (i.productAgeYears !== null) {
    factors.push({ factor: 'Product age', assessment: `${i.productAgeYears.toFixed(1)} years old. REPAIRVERSE does not estimate remaining lifespan without verified lifecycle data.`, direction: 'neutral' });
  } else missing.push('Product age or purchase date.');

  // 7. Outcome evidence.
  if (i.verifiedRepairSuccess && i.verifiedRepairSuccess.total >= 5) {
    const rate = i.verifiedRepairSuccess.successes / i.verifiedRepairSuccess.total;
    factors.push({ factor: 'Repair track record', assessment: `${i.verifiedRepairSuccess.successes} of ${i.verifiedRepairSuccess.total} verified repairs for this failure succeeded.`, direction: rate >= 0.7 ? 'favours_repair' : 'neutral' });
  } else {
    factors.push({ factor: 'Repair track record', assessment: 'Not enough verified repair outcomes to report a success rate.', direction: 'unknown' });
  }
  caveats.push('Environmental impact is not scored: no credible lifecycle data is recorded for this product.');

  // Decision.
  let recommendation: RepairRecommendation;
  let headline: string;
  if (i.diagnosisConfidence === null || i.diagnosisConfidence < 0.5) {
    recommendation = 'more_diagnosis_required';
    headline = 'Narrow down the cause before spending money on parts or a replacement.';
  } else if (i.riskLevel === 'high' || i.underWarranty === true || (i.difficulty !== null && i.difficulty >= 4)) {
    recommendation = 'professional_repair_recommended';
    headline = i.underWarranty ? 'Check your warranty first — a professional or manufacturer repair is the safest route.' : 'This repair should be handled by a qualified professional.';
  } else if ((costRatio !== null && costRatio >= 0.6) || i.partsAvailability === 'unavailable') {
    recommendation = 'replacement_may_be_more_economical';
    headline = costRatio !== null && costRatio >= 0.6 ? 'Known repair costs approach the price of a replacement.' : 'Compatible parts are not currently available.';
  } else {
    recommendation = 'repair_recommended';
    headline = missing.length ? 'Repair looks worthwhile based on available information — fill in the missing details to firm this up.' : 'Repair looks worthwhile.';
  }
  return { recommendation, headline, estimatedRepairCost, replacementCost: i.replacementCost, costRatio, factors, missingInformation: missing, caveats };
}
