import type { RepairDecisionInput } from '@repairverse/shared';
import { one, query } from '../../db/pool.js';
import { decideRepairOrReplace, type CostFigure } from '../../engines/repairDecision.js';
import { track } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { partsForProduct } from '../parts/service.js';
import { assertSessionAccess } from './service.js';
import type { AuthUser } from '../../types.js';

export async function repairDecision(input: RepairDecisionInput, user?: AuthUser) {
  let productId = input.productId ?? null;
  let deviceId = input.deviceId ?? null;
  let failureModeId = input.failureModeId ?? null;
  let diagnosisConfidence: number | null = null;

  if (input.diagnosisId) {
    const s = await one('SELECT * FROM diagnosis_sessions WHERE id = $1', [input.diagnosisId]);
    if (!s) throw forbidden();
    assertSessionAccess(s, user);
    productId ??= s.product_id;
    deviceId ??= s.device_id;
    const hyps: any[] = s.result?.hypotheses ?? [];
    const chosen = failureModeId ? hyps.find((h) => h.failureModeId === failureModeId) : hyps[0];
    failureModeId ??= chosen?.failureModeId ?? null;
    diagnosisConfidence = s.confirmed_failure_mode_id === failureModeId ? 1 : chosen?.probability ?? null;
  }
  const fm = failureModeId ? await one('SELECT * FROM failure_modes WHERE id = $1', [failureModeId]) : null;
  const procs = fm ? await query(`SELECT difficulty, risk_level FROM repair_procedures WHERE failure_mode_id = $1 AND verification_status <> 'rejected' ORDER BY difficulty`, [fm.id]) : [];

  let device: any = null;
  if (deviceId) {
    device = await one('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (device && user && device.owner_user_id !== user.id && !user.memberships.some((m) => m.organizationId === device.organization_id)) throw forbidden();
  }

  // Parts: cheapest sourced offer among confirmed-compatible parts of the failing component type.
  let partsCost: CostFigure | null = null;
  let availability: 'available' | 'limited' | 'unavailable' | 'unknown' = 'unknown';
  let partsConsidered: any[] = [];
  if (fm && productId) {
    const parts = await partsForProduct(productId, device?.variant_id ?? null, fm.component_type_id);
    partsConsidered = [...parts.confirmed, ...parts.potential].map((p) => ({ id: p.part.id, name: p.part.name, state: p.state, offers: p.offers.length }));
    const offers = parts.confirmed.flatMap((p) => p.offers.map((o: any) => ({ ...o, partName: p.part.name }))).filter((o) => o.price_cents != null && o.availability !== 'out_of_stock');
    if (offers.length) {
      const cheapest = offers.sort((a, b) => a.price_cents - b.price_cents)[0];
      partsCost = {
        amountCents: cheapest.price_cents,
        origin: `${cheapest.partName} from ${cheapest.seller}, observed ${new Date(cheapest.observed_at).toISOString().slice(0, 10)}${cheapest.is_demo ? ' (DEMONSTRATION offer — not a real listing)' : ''}`,
      };
      availability = offers.some((o) => o.availability === 'in_stock') ? 'available' : 'limited';
    } else if (parts.confirmed.length) {
      const anyOffers = parts.confirmed.some((p) => p.offers.length);
      availability = anyOffers ? 'unavailable' : 'unknown';
    }
  }

  const ageYears =
    input.productAgeYears ?? (device?.purchase_date ? (Date.now() - new Date(device.purchase_date).getTime()) / (365.25 * 86400_000) : null);
  const underWarranty = input.underWarranty ?? (device?.warranty_expires ? new Date(device.warranty_expires) > new Date() : null);

  const outcomes = fm ? { successes: fm.verified_success_count, total: fm.verified_case_count } : null;
  const result = decideRepairOrReplace({
    diagnosisConfidence,
    failureModeName: fm?.name ?? null,
    riskLevel: fm ? (procs.some((p) => p.risk_level === 'high') || fm.risk_level === 'high' ? 'high' : fm.risk_level) : null,
    difficulty: procs[0]?.difficulty ?? null,
    partsCost,
    partsAvailability: availability,
    laborCost: input.laborCostCents != null ? { amountCents: input.laborCostCents, origin: 'Labour estimate you entered' } : null,
    replacementCost:
      input.replacementCostCents != null ? { amountCents: input.replacementCostCents, origin: input.replacementCostSource ? `You entered (source: ${input.replacementCostSource})` : 'Replacement price you entered' } : null,
    productAgeYears: ageYears,
    underWarranty,
    verifiedRepairSuccess: outcomes,
  });
  await track('repair_decision_computed', user?.id, input.diagnosisId ?? null, { recommendation: result.recommendation });
  return { ...result, currency: input.currency, failureMode: fm ? { id: fm.id, name: fm.name } : null, partsConsidered };
}
