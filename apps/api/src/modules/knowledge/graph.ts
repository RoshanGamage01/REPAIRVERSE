import type { z } from 'zod';
import type { FailureModeInput, ProcedureInput } from '@repairverse/shared';
import { one, type Queryable } from '../../db/pool.js';
import { uniqueSlug } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';

type Ctx = { createdBy: string; verification: 'verified' | 'pending_review' | 'unverified'; isPublic: boolean };

/** Component HAS_FAILURE FailureMode, FailureMode CAUSES_SYMPTOM Symptom, KnowledgeSource SUPPORTS Claim. */
export async function createFailureMode(i: z.infer<typeof FailureModeInput>, ctx: Ctx, db: Queryable): Promise<string> {
  if (!i.productId && !i.categoryId) throw badRequest('A failure mode must be scoped to a product or a category');
  let categoryId = i.categoryId ?? null;
  if (i.productId && !categoryId) categoryId = (await one('SELECT category_id FROM products WHERE id = $1', [i.productId], db))?.category_id ?? null;
  const fm = await one(
    `INSERT INTO failure_modes(slug, name, description, component_type_id, category_id, product_id, risk_level, base_prior, prior_weight, verification_status, is_public, created_by, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,0.3) RETURNING id`,
    [uniqueSlug(i.name), i.name, i.description, i.componentTypeId, categoryId, i.productId ?? null, i.riskLevel, i.priorWeight, ctx.verification, ctx.isPublic, ctx.createdBy],
    db,
  );
  for (const s of i.symptoms) {
    await db.query(`INSERT INTO failure_mode_symptoms VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING`, [fm!.id, s.symptomId, s.likelihood]);
  }
  for (const sid of i.sourceIds) {
    await db.query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, verification_status, created_by) VALUES ('failure_mode',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [fm!.id, sid, ctx.verification, ctx.createdBy]);
  }
  return fm!.id;
}

/** RepairProcedure RESOLVES FailureMode, REQUIRES_TOOL Tool, REQUIRES_PART (component type). */
export async function createProcedure(i: z.infer<typeof ProcedureInput>, ctx: Ctx, db: Queryable): Promise<string> {
  const p = await one(
    `INSERT INTO repair_procedures(slug, title, objective, failure_mode_id, product_id, difficulty, estimated_minutes_min, estimated_minutes_max, risk_level, provenance, verification_status,
                                   preparation, safety_notes, verification, reassembly, is_public, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [
      uniqueSlug(i.title),
      i.title,
      i.objective,
      i.failureModeId,
      i.productId ?? null,
      i.difficulty,
      i.estimatedMinutesMin ?? null,
      i.estimatedMinutesMax ?? null,
      i.riskLevel,
      i.provenance,
      ctx.verification,
      i.preparation,
      i.safetyNotes,
      i.verification,
      i.reassembly,
      ctx.isPublic,
      ctx.createdBy,
    ],
    db,
  );
  for (const [idx, s] of i.steps.entries()) {
    await db.query(`INSERT INTO procedure_steps(procedure_id, position, title, body, expected_observation, caution, provenance, source_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      p!.id,
      idx + 1,
      s.title,
      s.body,
      s.expectedObservation ?? null,
      s.caution ?? null,
      s.provenance,
      s.sourceId ?? null,
    ]);
  }
  for (const t of i.toolIds) await db.query(`INSERT INTO procedure_tools VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p!.id, t]);
  for (const c of i.componentTypeIds) await db.query(`INSERT INTO procedure_component_types VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p!.id, c]);
  for (const sid of i.sourceIds) {
    await db.query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, verification_status, created_by) VALUES ('repair_procedure',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [p!.id, sid, ctx.verification, ctx.createdBy]);
  }
  return p!.id;
}
