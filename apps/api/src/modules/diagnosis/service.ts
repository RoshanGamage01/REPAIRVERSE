import { classifyRepairSafety, confidenceBand, maxRisk, type RiskLevel } from '@repairverse/shared';
import { one, pool, query, tx, type Queryable } from '../../db/pool.js';
import { diagnose, UNSURE, type FMNode, type ProbeNode, type DiagnosisResult } from '../../engines/diagnosis.js';
import { matchSymptoms } from '../../engines/symptomMatcher.js';
import { extractSymptoms } from '../../ai/operations.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { track } from '../../lib/audit.js';
import { isStaff } from '../../lib/auth.js';
import type { AuthUser } from '../../types.js';

export const DIAGNOSIS_DISCLAIMER =
  'These are ranked hypotheses, not confirmed faults. Probabilities are relative likelihoods computed from the knowledge network and your answers, and include a share for causes not yet in the knowledge base.';

/** Category plus all ancestors (so generic knowledge applies to sub-categories). */
export async function categoryLineage(categoryId: string, db: Queryable = pool): Promise<string[]> {
  const rows = await query(
    `WITH RECURSIVE up AS (SELECT id, parent_id FROM categories WHERE id = $1 UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id) SELECT id FROM up`,
    [categoryId],
    db,
  );
  return rows.map((r) => r.id);
}

export async function loadDiagnosticGraph(productId: string | null, categoryId: string | null): Promise<{ fms: FMNode[]; probes: ProbeNode[]; fmRows: Map<string, any> }> {
  const cats = categoryId ? await categoryLineage(categoryId) : [];
  const fmRows = await query(
    `SELECT fm.*, ct.name AS component_name, ct.slug AS component_slug
       FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id
      WHERE fm.verification_status <> 'rejected'
        AND ((fm.product_id IS NOT NULL AND fm.product_id = $1) OR (fm.product_id IS NULL AND fm.category_id = ANY($2::uuid[])))`,
    [productId, cats],
  );
  const ids = fmRows.map((r) => r.id);
  const links = ids.length ? await query(`SELECT failure_mode_id, symptom_id, likelihood FROM failure_mode_symptoms WHERE failure_mode_id = ANY($1)`, [ids]) : [];
  const fms: FMNode[] = fmRows.map((r) => ({
    id: r.id,
    name: r.name,
    componentTypeId: r.component_type_id,
    componentName: r.component_name,
    priorWeight: Number(r.prior_weight),
    riskLevel: r.risk_level,
    symptomLikelihoods: Object.fromEntries(links.filter((l) => l.failure_mode_id === r.id).map((l) => [l.symptom_id, Number(l.likelihood)])),
  }));
  const probeRows = ids.length
    ? await query(
        `SELECT p.* FROM diagnostic_probes p
          WHERE (p.category_id IS NULL OR p.category_id = ANY($2::uuid[]))
            AND EXISTS (SELECT 1 FROM probe_effects e WHERE e.probe_id = p.id AND e.failure_mode_id = ANY($1))`,
        [ids, cats],
      )
    : [];
  const effects = probeRows.length ? await query(`SELECT * FROM probe_effects WHERE probe_id = ANY($1) AND failure_mode_id = ANY($2)`, [probeRows.map((p) => p.id), ids]) : [];
  const probes: ProbeNode[] = probeRows.map((p) => {
    const eff: ProbeNode['effects'] = {};
    for (const e of effects.filter((x) => x.probe_id === p.id)) (eff[e.answer_value] ??= {})[e.failure_mode_id] = Number(e.likelihood_ratio);
    return { id: p.id, kind: p.kind, prompt: p.prompt, riskLevel: p.risk_level, options: p.options, effects: eff };
  });
  return { fms, probes, fmRows: new Map(fmRows.map((r) => [r.id, r])) };
}

export async function symptomVocabulary(categoryId: string | null) {
  const cats = categoryId ? await categoryLineage(categoryId) : [];
  return query(`SELECT id, slug, name, synonyms FROM symptoms WHERE category_id IS NULL OR category_id = ANY($1::uuid[]) ORDER BY name`, [cats]);
}

export function viewerMaxProbeRisk(user: AuthUser | undefined): RiskLevel {
  if (user && (user.role === 'admin' || (user.role === 'technician' && user.technicianVerified))) return 'high';
  return 'medium';
}

async function loadSession(id: string) {
  const s = await one('SELECT * FROM diagnosis_sessions WHERE id = $1', [id]);
  if (!s) throw notFound('Diagnosis');
  return s;
}

export function assertSessionAccess(s: any, user: AuthUser | undefined, apiClientId?: string) {
  if (apiClientId && s.api_client_id === apiClientId) return;
  if (!user) throw forbidden();
  if (s.user_id === user.id || isStaff(user)) return;
  if (s.organization_id && user.memberships.some((m) => m.organizationId === s.organization_id)) return;
  throw forbidden();
}

async function activeObservations(sessionId: string, db?: Queryable) {
  return query(`SELECT * FROM diagnosis_observations WHERE session_id = $1 AND superseded_at IS NULL ORDER BY position`, [sessionId], db);
}

async function nextPosition(sessionId: string, db: Queryable) {
  const r = await one('SELECT coalesce(max(position), 0) + 1 AS p FROM diagnosis_observations WHERE session_id = $1', [sessionId], db);
  return r!.p as number;
}

/** Interpret free text into symptom observations: lexical matching always; AI extraction when configured. */
async function interpret(sessionId: string, text: string, categoryId: string | null, userId: string | null) {
  const vocab = await symptomVocabulary(categoryId);
  const lexical = matchSymptoms(text, vocab);
  const ai = await extractSymptoms({ description: text, vocabulary: vocab.map((v) => ({ slug: v.slug, name: v.name })), userId, sessionId });
  const bySlug = new Map(vocab.map((v) => [v.slug, v]));
  const found = new Map<string, { symptomId: string; origin: 'lexical_match' | 'ai_extracted'; evidence: string }>();
  for (const m of lexical) found.set(m.symptomId, { symptomId: m.symptomId, origin: 'lexical_match', evidence: m.sentence });
  if (ai.ok) {
    for (const s of ai.data.symptoms) {
      const v = bySlug.get(s.slug);
      if (v && !found.has(v.id)) found.set(v.id, { symptomId: v.id, origin: 'ai_extracted', evidence: s.evidence_quote });
    }
  }
  return {
    matches: [...found.values()],
    interpretation: {
      method: ai.ok ? 'ai_and_lexical' : 'lexical',
      aiStatus: ai.ok ? 'used' : ai.reason,
      aiMessage: ai.ok ? null : ai.message,
      aiOperationId: ai.ok ? ai.operationId : ai.operationId ?? null,
      unmatchedObservations: ai.ok ? ai.data.unmatched_observations : [],
      safetyFlags: ai.ok ? ai.data.safety_flags : [],
    },
  };
}

export async function startDiagnosis(
  input: { productId?: string | null; categoryId?: string | null; deviceId?: string | null; jobId?: string | null; description: string; symptomIds: string[]; fileIds: string[] },
  ctx: { user?: AuthUser; organizationId?: string | null; apiClientId?: string },
) {
  let categoryId = input.categoryId ?? null;
  if (input.productId) {
    const p = await one('SELECT category_id FROM products WHERE id = $1', [input.productId]);
    if (!p) throw notFound('Product');
    categoryId = p.category_id;
  }
  if (input.deviceId && ctx.user) {
    const d = await one('SELECT owner_user_id, organization_id FROM devices WHERE id = $1', [input.deviceId]);
    if (!d || (d.owner_user_id !== ctx.user.id && !ctx.user.memberships.some((m) => m.organizationId === d.organization_id))) throw forbidden('Device not accessible');
  }
  if (!categoryId) throw badRequest('Identify the product or choose a product category to start a diagnosis');

  const session = await one(
    `INSERT INTO diagnosis_sessions(user_id, organization_id, job_id, device_id, product_id, category_id, description, file_ids, api_client_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [ctx.user?.id ?? null, ctx.organizationId ?? null, input.jobId ?? null, input.deviceId ?? null, input.productId ?? null, categoryId, input.description, input.fileIds, ctx.apiClientId ?? null],
  );
  const { matches, interpretation } = await interpret(session!.id, input.description, categoryId, ctx.user?.id ?? null);
  await tx(async (db) => {
    let pos = 1;
    const seen = new Set<string>();
    for (const sid of input.symptomIds) {
      if (seen.has(sid)) continue;
      seen.add(sid);
      await db.query(`INSERT INTO diagnosis_observations(session_id, kind, symptom_id, origin, position) VALUES ($1,'symptom',$2,'user',$3)`, [session!.id, sid, pos++]);
    }
    for (const m of matches) {
      if (seen.has(m.symptomId)) continue;
      seen.add(m.symptomId);
      await db.query(`INSERT INTO diagnosis_observations(session_id, kind, symptom_id, origin, note, position) VALUES ($1,'symptom',$2,$3,$4,$5)`, [session!.id, m.symptomId, m.origin, m.evidence.slice(0, 500), pos++]);
    }
    await db.query('UPDATE diagnosis_sessions SET interpretation = $2 WHERE id = $1', [session!.id, JSON.stringify(interpretation)]);
  });
  await track('diagnosis_started', ctx.user?.id, session!.id, { productIdentified: !!input.productId, symptomCount: matches.length + input.symptomIds.length, method: interpretation.method });
  return getDiagnosisView(session!.id, ctx.user, ctx.apiClientId);
}

export async function addSymptoms(sessionId: string, input: { symptomIds: string[]; text?: string }, user?: AuthUser, apiClientId?: string) {
  const s = await loadSession(sessionId);
  assertSessionAccess(s, user, apiClientId);
  const extra = input.text ? await interpret(sessionId, input.text, s.category_id, user?.id ?? null) : { matches: [] };
  await tx(async (db) => {
    let pos = await nextPosition(sessionId, db);
    const existing = new Set((await activeObservations(sessionId, db)).filter((o) => o.symptom_id).map((o) => o.symptom_id));
    for (const sid of input.symptomIds) {
      if (existing.has(sid)) continue;
      existing.add(sid);
      await db.query(`INSERT INTO diagnosis_observations(session_id, kind, symptom_id, origin, position) VALUES ($1,'symptom',$2,'user',$3)`, [sessionId, sid, pos++]);
    }
    for (const m of extra.matches) {
      if (existing.has(m.symptomId)) continue;
      existing.add(m.symptomId);
      await db.query(`INSERT INTO diagnosis_observations(session_id, kind, symptom_id, origin, note, position) VALUES ($1,'symptom',$2,$3,$4,$5)`, [sessionId, m.symptomId, m.origin, m.evidence, pos++]);
    }
    if (input.text) await db.query(`UPDATE diagnosis_sessions SET description = description || E'\n' || $2, updated_at = now() WHERE id = $1`, [sessionId, input.text]);
  });
  return getDiagnosisView(sessionId, user, apiClientId);
}

/** Record or change an answer. Changing an earlier answer supersedes it — the journey keeps history. */
export async function answerProbe(sessionId: string, input: { probeId: string; answer: string; note?: string }, user?: AuthUser, apiClientId?: string) {
  const s = await loadSession(sessionId);
  assertSessionAccess(s, user, apiClientId);
  if (s.status !== 'active') throw badRequest('This diagnosis is closed. Reopen it to change answers.');
  const probe = await one('SELECT * FROM diagnostic_probes WHERE id = $1', [input.probeId]);
  if (!probe) throw notFound('Diagnostic question');
  const valid = new Set([...probe.options.map((o: any) => o.value), UNSURE]);
  if (!valid.has(input.answer)) throw badRequest(`Invalid answer. Expected one of: ${[...valid].join(', ')}`);
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  if (riskRank[probe.risk_level as RiskLevel] > riskRank[viewerMaxProbeRisk(user)]) throw forbidden('This test is restricted to verified professionals');
  await tx(async (db) => {
    await db.query(`UPDATE diagnosis_observations SET superseded_at = now() WHERE session_id = $1 AND probe_id = $2 AND superseded_at IS NULL`, [sessionId, input.probeId]);
    const pos = await nextPosition(sessionId, db);
    await db.query(
      `INSERT INTO diagnosis_observations(session_id, kind, probe_id, answer, note, origin, position) VALUES ($1,'probe_answer',$2,$3,$4,$5,$6)`,
      [sessionId, input.probeId, input.answer, input.note ?? null, user?.role === 'technician' ? 'technician' : 'user', pos],
    );
    await db.query('UPDATE diagnosis_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
  });
  return getDiagnosisView(sessionId, user, apiClientId);
}

export async function retractObservation(sessionId: string, observationId: string, user?: AuthUser) {
  const s = await loadSession(sessionId);
  assertSessionAccess(s, user);
  const r = await one(`UPDATE diagnosis_observations SET superseded_at = now() WHERE id = $1 AND session_id = $2 AND superseded_at IS NULL RETURNING id`, [observationId, sessionId]);
  if (!r) throw notFound('Observation');
  return getDiagnosisView(sessionId, user);
}

export async function computeDiagnosis(sessionId: string, user?: AuthUser) {
  const s = await loadSession(sessionId);
  const graph = await loadDiagnosticGraph(s.product_id, s.category_id);
  const obs = await activeObservations(sessionId);
  const result = diagnose(
    graph.fms,
    graph.probes,
    { symptomIds: obs.filter((o) => o.kind === 'symptom').map((o) => o.symptom_id), answers: obs.filter((o) => o.kind === 'probe_answer').map((o) => ({ probeId: o.probe_id, answer: o.answer })) },
    { maxProbeRisk: viewerMaxProbeRisk(user), maxSuggestions: 3 },
  );
  return { session: s, graph, obs, result };
}

export async function getDiagnosisView(sessionId: string, user?: AuthUser, apiClientId?: string) {
  const { session: s, graph, obs, result } = await computeDiagnosis(sessionId, user);
  assertSessionAccess(s, user, apiClientId);
  const view = await enrich(s, graph, obs, result, user);
  // Snapshot for history, outcome evaluation and metrics.
  await query('UPDATE diagnosis_sessions SET result = $2 WHERE id = $1', [
    sessionId,
    JSON.stringify({ hypotheses: result.hypotheses.slice(0, 5).map((h) => ({ failureModeId: h.failureModeId, name: h.name, probability: h.probability })), unknownProbability: result.unknownProbability, readiness: result.readiness, computedAt: new Date().toISOString() }),
  ]);
  return view;
}

async function enrich(s: any, graph: Awaited<ReturnType<typeof loadDiagnosticGraph>>, obs: any[], result: DiagnosisResult, user?: AuthUser) {
  const symptomIds = [...new Set(obs.filter((o) => o.symptom_id).map((o) => o.symptom_id))];
  const symptomRows = symptomIds.length ? await query('SELECT id, slug, name FROM symptoms WHERE id = ANY($1)', [symptomIds]) : [];
  const symptomName = new Map(symptomRows.map((r) => [r.id, r.name]));
  const probeIds = [...new Set([...obs.filter((o) => o.probe_id).map((o) => o.probe_id), ...result.nextProbes.map((p) => p.probeId)])];
  const probeRows = probeIds.length ? await query('SELECT * FROM diagnostic_probes WHERE id = ANY($1)', [probeIds]) : [];
  const probeById = new Map(probeRows.map((p) => [p.id, p]));
  const answerLabel = (probeId: string, value: string) => (value === UNSURE ? 'Not sure' : probeById.get(probeId)?.options.find((o: any) => o.value === value)?.label ?? value);
  const answerByProbe = new Map(obs.filter((o) => o.probe_id).map((o) => [o.probe_id, o.answer]));

  const top = result.hypotheses.slice(0, 6);
  const fmIds = top.map((h) => h.failureModeId);
  const procedures = fmIds.length
    ? await query(
        `SELECT p.id, p.failure_mode_id, p.title, p.difficulty, p.risk_level, p.provenance, p.verification_status, p.estimated_minutes_min, p.estimated_minutes_max, p.is_demo,
                coalesce(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tools
           FROM repair_procedures p LEFT JOIN procedure_tools pt ON pt.procedure_id = p.id LEFT JOIN tools t ON t.id = pt.tool_id
          WHERE p.failure_mode_id = ANY($1) AND p.verification_status <> 'rejected' AND (p.product_id IS NULL OR p.product_id = $2)
          GROUP BY p.id ORDER BY p.difficulty`,
        [fmIds, s.product_id],
      )
    : [];
  const citations = fmIds.length
    ? await query(
        `SELECT c.entity_id, s.id AS source_id, s.title, s.kind, s.url, c.locator, c.verification_status FROM knowledge_citations c JOIN knowledge_sources s ON s.id = c.source_id
          WHERE c.entity_type = 'failure_mode' AND c.entity_id = ANY($1) AND s.status = 'active'`,
        [fmIds],
      )
    : [];
  const testProbes = fmIds.length
    ? await query(
        `SELECT DISTINCT p.id, p.prompt, p.risk_level, p.instructions, e.failure_mode_id FROM diagnostic_probes p JOIN probe_effects e ON e.probe_id = p.id
          WHERE p.kind = 'test' AND e.failure_mode_id = ANY($1)`,
        [fmIds],
      )
    : [];
  const maxProbeRisk = viewerMaxProbeRisk(user);
  const riskRank = { low: 0, medium: 1, high: 2 } as const;

  const hypotheses = top.map((h) => {
    const fm = graph.fmRows.get(h.failureModeId)!;
    const procs = procedures.filter((p) => p.failure_mode_id === h.failureModeId);
    const declared = maxRisk(fm.risk_level, ...procs.map((p) => p.risk_level));
    const safety = classifyRepairSafety({ text: `${fm.name}. ${fm.description}. ${procs.map((p) => p.title).join('. ')}`, declaredRisk: declared });
    const describe = (e: { kind: string; id: string; weight: number }) =>
      e.kind === 'symptom'
        ? { kind: 'symptom', label: symptomName.get(e.id) ?? 'Reported symptom', strength: e.weight }
        : { kind: 'answer', label: `${probeById.get(e.id)?.prompt ?? 'Answer'} → ${answerLabel(e.id, answerByProbe.get(e.id) ?? '')}`, strength: e.weight };
    const pendingTests = testProbes.filter((t) => t.failure_mode_id === h.failureModeId && !answerByProbe.has(t.id));
    return {
      failureModeId: h.failureModeId,
      name: h.name,
      description: fm.description,
      component: { id: fm.component_type_id, name: fm.component_name },
      probability: Math.round(h.probability * 1000) / 1000,
      confidenceBand: confidenceBand(h.probability),
      status: 'hypothesis' as const,
      supportingEvidence: h.supporting.slice(0, 6).map(describe),
      contradictingEvidence: h.contradicting.slice(0, 4).map(describe),
      missingInformation: pendingTests.length ? pendingTests.map((t) => `Result of: ${t.prompt}`) : [],
      recommendedTests: pendingTests.map((t) => ({ probeId: t.id, prompt: t.prompt, riskLevel: t.risk_level, allowed: riskRank[t.risk_level as RiskLevel] <= riskRank[maxProbeRisk], instructions: t.instructions })),
      requiredTools: [...new Set(procs.flatMap((p) => p.tools))],
      procedures: procs.map((p) => ({ id: p.id, title: p.title, difficulty: p.difficulty, riskLevel: p.risk_level, provenance: p.provenance, verificationStatus: p.verification_status, estimatedMinutes: p.estimated_minutes_min ? [p.estimated_minutes_min, p.estimated_minutes_max] : null })),
      complexity: procs.length ? Math.min(...procs.map((p) => p.difficulty)) : null,
      safety,
      knowledge: {
        verificationStatus: fm.verification_status,
        isDemo: fm.is_demo,
        confidence: Number(fm.confidence),
        verifiedCases: fm.verified_case_count,
        sources: citations.filter((c) => c.entity_id === h.failureModeId).map((c) => ({ id: c.source_id, title: c.title, kind: c.kind, url: c.url, locator: c.locator })),
      },
    };
  });

  const nextQuestions = result.nextProbes.map((np) => {
    const p = probeById.get(np.probeId)!;
    return {
      probeId: p.id,
      kind: p.kind,
      prompt: p.prompt,
      help: p.help,
      instructions: p.instructions,
      riskLevel: p.risk_level,
      options: [...p.options, { value: UNSURE, label: 'Not sure' }],
      expectedInformationGain: Math.round(np.expectedInformationGain * 1000) / 1000,
      why: `Helps distinguish between ${np.discriminates.map((id) => graph.fmRows.get(id)?.name).filter(Boolean).slice(0, 3).join(', ')}.`,
    };
  });

  const journey = [
    { type: 'initial', label: 'Problem described', detail: s.description, at: s.created_at },
    ...obs.map((o) =>
      o.kind === 'symptom'
        ? { type: 'symptom', observationId: o.id, label: symptomName.get(o.symptom_id) ?? 'Symptom', detail: o.origin === 'user' ? 'Selected by you' : o.origin === 'ai_extracted' ? `AI interpreted from: “${o.note}”` : `Matched from: “${o.note}”`, origin: o.origin, at: o.created_at }
        : {
            type: probeById.get(o.probe_id)?.kind === 'test' ? 'test' : 'question',
            observationId: o.id,
            probeId: o.probe_id,
            label: probeById.get(o.probe_id)?.prompt ?? 'Question',
            detail: answerLabel(o.probe_id, o.answer),
            answer: o.answer,
            options: [...(probeById.get(o.probe_id)?.options ?? []), { value: UNSURE, label: 'Not sure' }],
            origin: o.origin,
            at: o.created_at,
          },
    ),
  ];

  const missing: string[] = [];
  if (!s.product_id) missing.push('The exact product model is not identified — knowledge specific to the model cannot be applied.');
  if (!result.hypotheses.length) missing.push('No failure knowledge in the network matches these symptoms yet.');
  if (result.unknownProbability > 0.35) missing.push('A substantial share of probability remains on causes not represented in the knowledge base.');

  const product = s.product_id ? await one('SELECT id, name, slug, model_number FROM products WHERE id = $1', [s.product_id]) : null;
  const category = await one('SELECT id, name, slug FROM categories WHERE id = $1', [s.category_id]);
  const leading = hypotheses[0];
  const safetyStop = (s.interpretation?.safetyFlags?.length ?? 0) > 0 || leading?.safety.professionalOnly;

  return {
    id: s.id,
    status: s.status,
    description: s.description,
    product,
    category,
    deviceId: s.device_id,
    jobId: s.job_id,
    createdAt: s.created_at,
    saved: s.saved,
    interpretation: s.interpretation,
    readiness: result.readiness,
    evidenceCount: result.evidenceCount,
    unknownProbability: Math.round(result.unknownProbability * 1000) / 1000,
    hypotheses,
    nextQuestions,
    journey,
    missingInformation: missing,
    safetyNotice: safetyStop
      ? {
          level: 'stop',
          message: leading?.safety.professionalOnly
            ? 'The leading hypothesis involves high-risk hazards. Do not open the device — consult a qualified professional.'
            : `Safety signals detected in your description: ${s.interpretation.safetyFlags.join(', ')}. Unplug the device and stop using it.`,
        }
      : null,
    confirmedFailureModeId: s.confirmed_failure_mode_id,
    disclaimer: DIAGNOSIS_DISCLAIMER,
  };
}

export async function completeDiagnosis(sessionId: string, user: AuthUser | undefined, opts: { save?: boolean } = {}) {
  const s = await loadSession(sessionId);
  assertSessionAccess(s, user);
  await query(`UPDATE diagnosis_sessions SET status='completed', completed_at = coalesce(completed_at, now()), saved = saved OR $2 WHERE id = $1`, [sessionId, !!opts.save]);
  if (s.status !== 'completed') await track('diagnosis_completed', user?.id, sessionId, {});
  if (opts.save && s.device_id) {
    const res = s.result?.hypotheses?.[0];
    await query(`INSERT INTO device_events(device_id, kind, title, details, diagnosis_id, created_by) VALUES ($1,'diagnosis',$2,$3,$4,$5)`, [
      s.device_id,
      'Diagnosis completed',
      res ? `Leading hypothesis: ${res.name} (${Math.round(res.probability * 100)}% relative likelihood — not confirmed)` : s.description,
      sessionId,
      user?.id ?? null,
    ]);
  }
  return getDiagnosisView(sessionId, user);
}
