/**
 * Part compatibility engine (deterministic).
 *
 * Compatibility is NEVER inferred from similar names or appearance. A verdict comes from:
 *  1. An explicit, evidence-backed relationship (Part COMPATIBLE_WITH Product[/Variant]).
 *  2. Otherwise, an attribute comparison against the product's component slot. Any known
 *     attribute mismatch → incompatible. All required attributes known and matching →
 *     "potential" (never "confirmed" without explicit evidence). Missing data → unknown.
 */
import type { CompatibilityState } from '@repairverse/shared';

export interface CompatEvidence {
  kind: string;
  description: string;
  sourceId?: string | null;
  sourceTitle?: string | null;
}

export interface ExplicitRelation {
  state: CompatibilityState;
  variantId: string | null;
  verificationStatus: string;
  evidence: CompatEvidence[];
}

export interface AttributeComparison {
  attribute: string;
  required: string | null;
  offered: string | null;
  result: 'match' | 'mismatch' | 'unknown';
}

export interface CompatVerdict {
  state: CompatibilityState | 'unknown';
  basis: 'explicit' | 'attribute_rules' | 'insufficient_data';
  reasons: string[];
  attributeChecks: AttributeComparison[];
  evidence: CompatEvidence[];
}

const NUMERIC = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z%]*)\s*$/;

/** Normalise attribute values for comparison: case/whitespace-insensitive; numeric with unit tolerance. */
export function attributesMatch(attribute: string, required: string, offered: string): boolean {
  const a = required.trim().toLowerCase();
  const b = offered.trim().toLowerCase();
  if (a === b) return true;
  const ma = a.match(NUMERIC);
  const mb = b.match(NUMERIC);
  if (ma && mb && ma[2] === mb[2]) {
    const x = parseFloat(ma[1]);
    const y = parseFloat(mb[1]);
    // Physical dimensions allow 1% tolerance; electrical values require exact equality.
    const tol = /dimension|length|width|height|thickness|size|diagonal/.test(attribute) ? 0.01 : 0;
    return Math.abs(x - y) <= Math.abs(x) * tol;
  }
  // Allow list values on the required side: "a|b" means either is acceptable.
  if (a.includes('|')) return a.split('|').map((s) => s.trim()).includes(b);
  return false;
}

export function evaluateCompatibility(input: {
  variantId: string | null;
  explicit: ExplicitRelation[];
  requiredAttributes: string[]; // from component type
  slotAttributes: Record<string, string>; // product component's known attributes
  partAttributes: Record<string, string>;
}): CompatVerdict {
  // Explicit relationships: variant-specific beats product-wide; incompatibility beats compatibility.
  const applicable = input.explicit.filter((e) => e.verificationStatus !== 'rejected' && (e.variantId === null || e.variantId === input.variantId));
  const specific = applicable.filter((e) => e.variantId !== null);
  const pool = specific.length ? specific : applicable;
  const checks: AttributeComparison[] = input.requiredAttributes.map((attr) => {
    const required = input.slotAttributes[attr] ?? null;
    const offered = input.partAttributes[attr] ?? null;
    return { attribute: attr, required, offered, result: required === null || offered === null ? 'unknown' : attributesMatch(attr, required, offered) ? 'match' : 'mismatch' };
  });

  if (pool.length) {
    const incompatible = pool.find((e) => e.state === 'incompatible');
    const chosen = incompatible ?? pool.find((e) => e.state === 'confirmed') ?? pool[0];
    const reasons = [`Explicit compatibility record (${chosen.state})${chosen.variantId ? ' for this specific variant' : ''}, verification: ${chosen.verificationStatus}.`];
    const mismatches = checks.filter((c) => c.result === 'mismatch');
    let state = chosen.state;
    if (state === 'confirmed' && mismatches.length) {
      // Conflicting data: never present as confirmed.
      state = 'potential';
      reasons.push(`Conflict: recorded attributes disagree on ${mismatches.map((m) => m.attribute).join(', ')}. Treat as unverified until resolved.`);
    }
    if (state === 'confirmed' && chosen.verificationStatus !== 'verified') {
      state = 'potential';
      reasons.push('The compatibility claim has not yet been verified by a reviewer.');
    }
    return { state, basis: 'explicit', reasons, attributeChecks: checks, evidence: pool.flatMap((e) => e.evidence) };
  }

  if (!input.requiredAttributes.length) {
    return { state: 'unknown', basis: 'insufficient_data', reasons: ['No compatibility record and no comparable attributes are defined for this component type.'], attributeChecks: checks, evidence: [] };
  }
  const mismatch = checks.filter((c) => c.result === 'mismatch');
  if (mismatch.length) {
    return {
      state: 'incompatible',
      basis: 'attribute_rules',
      reasons: mismatch.map((m) => `${m.attribute}: product requires "${m.required}", part offers "${m.offered}".`),
      attributeChecks: checks,
      evidence: [{ kind: 'attribute_match', description: 'Derived from recorded attribute mismatch.' }],
    };
  }
  const unknown = checks.filter((c) => c.result === 'unknown');
  if (unknown.length) {
    return {
      state: 'unknown',
      basis: 'insufficient_data',
      reasons: [`Cannot assess: missing data for ${unknown.map((u) => u.attribute).join(', ')}.`],
      attributeChecks: checks,
      evidence: [],
    };
  }
  return {
    state: 'potential',
    basis: 'attribute_rules',
    reasons: ['All recorded attributes match, but no documentation or verified repair confirms this fit.'],
    attributeChecks: checks,
    evidence: [{ kind: 'attribute_match', description: `Matching attributes: ${checks.map((c) => c.attribute).join(', ')}` }],
  };
}
