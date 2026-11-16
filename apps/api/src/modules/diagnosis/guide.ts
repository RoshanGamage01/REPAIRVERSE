import { canViewProcedureSteps, classifyRepairSafety, maxRisk, type RiskLevel } from '@repairverse/shared';
import { one, query } from '../../db/pool.js';
import { generateRepairGuide } from '../../ai/operations.js';
import { retrieve } from '../knowledge/retrieval.js';
import { notFound } from '../../lib/errors.js';
import { isUuid } from '../../lib/http.js';
import { track } from '../../lib/audit.js';
import type { AuthUser } from '../../types.js';

export const PROFESSIONAL_GUIDANCE = {
  title: 'Stop — this repair needs a qualified professional',
  reasons: [
    'It involves hazards that can cause serious injury, fire or death (for example mains voltage, stored high-voltage charge, damaged lithium cells, refrigerant or gas).',
    'Professionals have the training, test equipment and protective procedures to do this safely.',
  ],
  whatYouCanDo: [
    'Unplug the device and stop using it.',
    'Do not open the casing.',
    'Find a technician (REPAIRVERSE lists technicians and shows whether their credentials have been verified).',
    'Bring your diagnostic report — it saves the technician time.',
  ],
};

function viewerCtx(user?: AuthUser) {
  return user ? { role: user.role, technicianVerified: user.technicianVerified } : null;
}

export async function procedureView(id: string, user?: AuthUser) {
  const p = await one(
    `SELECT rp.*, fm.name AS failure_mode_name, fm.description AS fm_description, c.slug AS category_slug FROM repair_procedures rp JOIN failure_modes fm ON fm.id = rp.failure_mode_id
       LEFT JOIN categories c ON c.id = fm.category_id WHERE ${isUuid(id) ? 'rp.id = $1' : 'rp.slug = $1'}`,
    [id],
  );
  if (!p) throw notFound('Procedure');
  const [steps, tools, comps, sources] = await Promise.all([
    query(
      `SELECT ps.position, ps.title, ps.body, ps.expected_observation, ps.caution, ps.provenance, s.id AS source_id, s.title AS source_title, s.url AS source_url, s.kind AS source_kind
         FROM procedure_steps ps LEFT JOIN knowledge_sources s ON s.id = ps.source_id WHERE ps.procedure_id = $1 ORDER BY position`,
      [p.id],
    ),
    query('SELECT t.id, t.name, t.description FROM procedure_tools pt JOIN tools t ON t.id = pt.tool_id WHERE pt.procedure_id = $1', [p.id]),
    query('SELECT ct.id, ct.name FROM procedure_component_types x JOIN component_types ct ON ct.id = x.component_type_id WHERE x.procedure_id = $1', [p.id]),
    query(
      `SELECT DISTINCT s.id, s.title, s.kind, s.url, s.reliability_tier, c.locator FROM knowledge_citations c JOIN knowledge_sources s ON s.id = c.source_id WHERE c.entity_type = 'repair_procedure' AND c.entity_id = $1`,
      [p.id],
    ),
  ]);
  const text = [p.title, p.objective, ...steps.map((s) => `${s.title} ${s.body}`)].join('. ');
  const safety = classifyRepairSafety({ text, declaredRisk: p.risk_level, categorySlug: p.category_slug });
  const allowed = canViewProcedureSteps(safety.level, viewerCtx(user));
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    objective: p.objective,
    failureMode: { id: p.failure_mode_id, name: p.failure_mode_name },
    difficulty: p.difficulty,
    estimatedMinutes: p.estimated_minutes_min ? [p.estimated_minutes_min, p.estimated_minutes_max] : null,
    riskLevel: safety.level,
    provenance: p.provenance,
    verificationStatus: p.verification_status,
    isDemo: p.is_demo,
    version: p.version,
    tools,
    requiredComponents: comps,
    safety,
    safetyNotes: p.safety_notes,
    preparation: allowed ? p.preparation : [],
    steps: allowed ? steps : [],
    verification: allowed ? p.verification : [],
    reassembly: allowed ? p.reassembly : [],
    stepsWithheld: !allowed,
    professionalGuidance: allowed ? null : PROFESSIONAL_GUIDANCE,
    sources,
  };
}

/**
 * Assemble a repair guide for a hypothesis: stored procedures first (with provenance),
 * then — only if requested and permitted — an AI-generated guide grounded in retrieved knowledge.
 */
export async function buildGuide(args: { failureModeId: string; productId: string | null; user?: AuthUser; generate: boolean }) {
  const fm = await one(
    `SELECT fm.*, ct.name AS component_name, c.slug AS category_slug FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id LEFT JOIN categories c ON c.id = fm.category_id WHERE fm.id = $1`,
    [args.failureModeId],
  );
  if (!fm) throw notFound('Failure mode');
  const product = args.productId ? await one('SELECT id, name, model_number FROM products WHERE id = $1', [args.productId]) : null;
  const procRows = await query(
    `SELECT id FROM repair_procedures WHERE failure_mode_id = $1 AND verification_status <> 'rejected' AND (product_id IS NULL OR product_id = $2)
      ORDER BY product_id IS NOT NULL DESC, CASE provenance WHEN 'manufacturer_documentation' THEN 0 WHEN 'expert_reviewed' THEN 1 WHEN 'verified_repair_record' THEN 2 WHEN 'community_contribution' THEN 3 WHEN 'demo' THEN 4 ELSE 5 END, difficulty`,
    [fm.id, args.productId],
  );
  const procedures = await Promise.all(procRows.map((r) => procedureView(r.id, args.user)));
  const overallRisk: RiskLevel = maxRisk(fm.risk_level, ...procedures.map((p) => p.riskLevel));
  const safety = classifyRepairSafety({ text: `${fm.name}. ${fm.description}`, declaredRisk: overallRisk, categorySlug: fm.category_slug });
  const professionalOnly = !canViewProcedureSteps(safety.level, viewerCtx(args.user));

  let aiGuide: any = null;
  if (args.generate) {
    if (professionalOnly) {
      aiGuide = { status: 'refused', message: 'AI-generated walkthroughs are not produced for high-risk repairs. Please consult a qualified professional.' };
    } else {
      const references = await retrieve(`${fm.name} ${fm.component_name} ${product?.name ?? ''} repair`, {
        limit: 6,
        entityRefs: [{ type: 'failure_mode', id: fm.id }, ...procedures.map((p) => ({ type: 'repair_procedure', id: p.id }))],
      });
      const r = await generateRepairGuide({
        productName: product ? `${product.name} ${product.model_number ?? ''}`.trim() : `a device (${fm.category_slug ?? 'unknown category'})`,
        failureModeName: fm.name,
        failureModeDescription: fm.description,
        references: references.map((x) => ({ id: x.id, title: x.title, text: x.text })),
        userId: args.user?.id,
        entityId: fm.id,
      });
      if (!r.ok) aiGuide = { status: r.reason, message: r.message };
      else {
        // Output safety validation: the classifier can only raise the risk level.
        const text = [r.data.objective, ...r.data.steps.map((s) => `${s.title} ${s.body}`)].join('. ');
        const outSafety = classifyRepairSafety({ text, declaredRisk: overallRisk, categorySlug: fm.category_slug });
        if (!canViewProcedureSteps(outSafety.level, viewerCtx(args.user))) {
          await query(`UPDATE ai_operations SET status = 'rejected_by_validation', validation_errors = $2 WHERE id = $1`, [r.operationId, JSON.stringify({ safety: outSafety.hazards })]);
          aiGuide = { status: 'refused', message: 'The generated guide involved high-risk work and was withheld. Please consult a qualified professional.', hazards: outSafety.hazards };
        } else {
          const refById = new Map(references.map((x) => [x.id, x]));
          aiGuide = {
            status: 'generated',
            provenance: 'ai_generated',
            model: r.model,
            operationId: r.operationId,
            knowledgeSufficient: r.data.knowledge_sufficient,
            insufficiencyReason: r.data.insufficiency_reason,
            objective: r.data.objective,
            difficulty: r.data.difficulty,
            estimatedMinutes: r.data.estimated_minutes_min ? [r.data.estimated_minutes_min, r.data.estimated_minutes_max] : null,
            tools: r.data.tools,
            safetyRequirements: [...new Set([...r.data.safety_requirements, ...outSafety.hazards.map((h) => h.guidance)])],
            preparation: r.data.preparation,
            steps: r.data.steps.map((s, i) => ({
              position: i + 1,
              title: s.title,
              body: s.body,
              expectedObservation: s.expected_observation,
              caution: s.caution,
              provenance: s.reference_ids.length ? 'ai_generated_grounded' : 'ai_generated',
              references: s.reference_ids.map((id) => {
                const ref = refById.get(id)!;
                return { id, title: ref.title, url: ref.url, sourceKind: ref.sourceKind, locator: ref.locator };
              }),
            })),
            verification: r.data.verification,
            reassembly: r.data.reassembly,
            alternatives: r.data.alternatives,
            safety: outSafety,
          };
        }
      }
    }
  }
  const withSources = procedures.filter((p) => p.sources.length).length + (aiGuide?.steps?.some((s: any) => s.references.length) ? 1 : 0);
  await track('repair_guide_viewed', args.user?.id, fm.id, { procedures: procedures.length, aiRequested: args.generate, aiStatus: aiGuide?.status ?? null, withSources: withSources > 0 });
  return {
    failureMode: { id: fm.id, name: fm.name, description: fm.description, component: fm.component_name, riskLevel: fm.risk_level, verificationStatus: fm.verification_status, isDemo: fm.is_demo },
    status: 'hypothesis',
    safety,
    professionalOnly,
    professionalGuidance: professionalOnly ? PROFESSIONAL_GUIDANCE : null,
    procedures,
    aiGuide,
    knowledgeAvailable: procedures.length > 0,
    noKnowledgeMessage: procedures.length ? null : 'No documented repair procedure exists in the knowledge network for this failure yet.',
  };
}
