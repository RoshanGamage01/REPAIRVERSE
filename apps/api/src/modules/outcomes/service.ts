/**
 * Repair outcome learning.
 *
 * Outcomes are recorded as "pending_review". Only after moderation verifies an outcome does it
 * influence the knowledge graph, and even then conservatively: priors and symptom likelihoods move
 * as Bayesian updates weighted by independent corroboration, never from one report alone.
 */
import type { Request } from 'express';
import { one, query, tx, type Queryable } from '../../db/pool.js';
import { track } from '../../lib/audit.js';
import { effectivePrior, knowledgeConfidence, updatedLikelihood } from '../../engines/confidence.js';

export async function recordRepairOutcome(job: any, input: { succeeded: boolean; actualFailureModeId?: string | null; actualFailureText?: string; procedureId?: string | null; contributeToKnowledge: boolean }, req: Request) {
  const session = job.diagnosis_session_id ? await one('SELECT * FROM diagnosis_sessions WHERE id = $1', [job.diagnosis_session_id]) : null;
  const symptomRows = session ? await query(`SELECT symptom_id FROM diagnosis_observations WHERE session_id = $1 AND kind = 'symptom' AND superseded_at IS NULL`, [session.id]) : [];
  const answers = session
    ? await query(
        `SELECT p.prompt, o.answer FROM diagnosis_observations o JOIN diagnostic_probes p ON p.id = o.probe_id WHERE o.session_id = $1 AND o.kind = 'probe_answer' AND o.superseded_at IS NULL`,
        [session.id],
      )
    : [];
  const tests = await query('SELECT name, result, notes FROM job_tests WHERE job_id = $1', [job.id]);
  const replaced = await query(`SELECT r.component_type_id, ct.name AS component, r.part_id, r.old_part_number, r.new_part_number FROM job_replaced_components r JOIN component_types ct ON ct.id = r.component_type_id WHERE job_id = $1`, [job.id]);
  const cost = await one('SELECT coalesce(sum(quantity * unit_price_cents),0)::int AS c FROM job_quote_items WHERE job_id = $1', [job.id]);
  const minutes = await one('SELECT coalesce(sum(minutes),0)::int AS m FROM job_work_log WHERE job_id = $1', [job.id]);
  const device = await one('SELECT product_id FROM devices WHERE id = $1', [job.device_id]);
  const actualFm = input.actualFailureModeId ?? job.confirmed_failure_mode_id ?? null;
  const hyps: any[] = session?.result?.hypotheses ?? [];
  const topCorrect = actualFm && hyps.length ? hyps[0].failureModeId === actualFm : null;

  return tx(async (db) => {
    const o = await one(
      `INSERT INTO repair_outcomes(job_id, device_id, product_id, reporter_id, organization_id, symptom_ids, original_symptoms, initial_hypotheses, diagnosis_session_id, tests_performed,
                                   actual_failure_mode_id, actual_failure_text, components_replaced, procedure_id, cost_cents, duration_minutes, succeeded, follow_up_status, top_hypothesis_correct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending',$18) RETURNING id`,
      [
        job.id,
        job.device_id,
        device?.product_id ?? null,
        req.user!.id,
        job.organization_id,
        symptomRows.map((s) => s.symptom_id),
        job.complaint,
        JSON.stringify(hyps),
        session?.id ?? null,
        JSON.stringify([...answers.map((a) => ({ test: a.prompt, result: a.answer })), ...tests.map((t) => ({ test: t.name, result: t.result, notes: t.notes }))]),
        actualFm,
        input.actualFailureText ?? null,
        JSON.stringify(replaced),
        input.procedureId ?? null,
        cost!.c || null,
        minutes!.m || null,
        input.succeeded,
        topCorrect,
      ],
      db,
    );
    if (session) await db.query(`UPDATE diagnosis_sessions SET status = 'completed', completed_at = coalesce(completed_at, now()), confirmed_failure_mode_id = coalesce($2, confirmed_failure_mode_id) WHERE id = $1`, [session.id, actualFm]);

    let contributionId: string | null = null;
    if (input.contributeToKnowledge) {
      const fmName = actualFm ? (await one('SELECT name FROM failure_modes WHERE id = $1', [actualFm], db))?.name : null;
      // Anonymised payload: no customer name, contact, serial number or organisation details.
      const c = await one(
        `INSERT INTO contributions(contributor_id, organization_id, type, title, target_entity_type, target_entity_id, payload, evidence, repair_outcome_id)
         VALUES ($1,$2,'repair_outcome',$3,'failure_mode',$4,$5,$6,$7) RETURNING id`,
        [
          req.user!.id,
          job.organization_id,
          `${input.succeeded ? 'Successful' : 'Unsuccessful'} repair: ${fmName ?? input.actualFailureText ?? 'unspecified failure'}`,
          actualFm,
          JSON.stringify({
            productId: device?.product_id ?? null,
            symptomIds: symptomRows.map((s) => s.symptom_id),
            actualFailureModeId: actualFm,
            actualFailureText: input.actualFailureText ?? null,
            componentsReplaced: replaced.map((r) => ({ component: r.component, componentTypeId: r.component_type_id, partId: r.part_id, newPartNumber: r.new_part_number })),
            tests: tests.map((t) => ({ name: t.name, result: t.result })),
            succeeded: input.succeeded,
            topHypothesisCorrect: topCorrect,
            durationMinutes: minutes!.m || null,
          }),
          JSON.stringify(tests.map((t) => ({ kind: 'text', label: 'Final test', value: `${t.name}: ${t.result}` }))),
          o!.id,
        ],
        db,
      );
      contributionId = c!.id;
    }
    await track('repair_outcome_recorded', req.user!.id, o!.id, { succeeded: input.succeeded, topHypothesisCorrect: topCorrect, contributed: input.contributeToKnowledge }, db);
    return { outcomeId: o!.id as string, contributionId, topHypothesisCorrect: topCorrect };
  });
}

/** Recompute learned statistics for a failure mode from verified outcomes. Idempotent. */
export async function recomputeFailureModeStats(failureModeId: string, db?: Queryable) {
  const fm = await one('SELECT * FROM failure_modes WHERE id = $1', [failureModeId], db);
  if (!fm) return null;
  const stats = await one(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE succeeded)::int AS successes, count(DISTINCT reporter_id)::int AS reporters,
            count(*) FILTER (WHERE cardinality(symptom_ids) > 0)::int AS n_with_symptoms
       FROM repair_outcomes WHERE actual_failure_mode_id = $1 AND verification_status = 'verified'`,
    [failureModeId],
    db,
  );
  const tier = await one(
    `SELECT max(s.reliability_tier)::int AS t FROM knowledge_citations c JOIN knowledge_sources s ON s.id = c.source_id WHERE c.entity_type = 'failure_mode' AND c.entity_id = $1 AND s.status = 'active'`,
    [failureModeId],
    db,
  );
  const links = await query('SELECT symptom_id, base_likelihood FROM failure_mode_symptoms WHERE failure_mode_id = $1', [failureModeId], db);
  for (const l of links) {
    const withSymptom = await one(
      `SELECT count(*)::int AS k FROM repair_outcomes WHERE actual_failure_mode_id = $1 AND verification_status = 'verified' AND $2 = ANY(symptom_ids)`,
      [failureModeId, l.symptom_id],
      db,
    );
    const updated = stats!.n_with_symptoms ? updatedLikelihood(Number(l.base_likelihood), withSymptom!.k, stats!.n_with_symptoms) : Number(l.base_likelihood);
    await query('UPDATE failure_mode_symptoms SET likelihood = $3 WHERE failure_mode_id = $1 AND symptom_id = $2', [failureModeId, l.symptom_id, updated], db);
  }
  const prior = effectivePrior(Number(fm.base_prior), stats!.n, stats!.reporters);
  const confidence = knowledgeConfidence({ bestSourceTier: tier?.t ?? 0, independentReporters: stats!.reporters, verifiedCases: stats!.n, isDemo: fm.is_demo });
  await query(
    `UPDATE failure_modes SET prior_weight = $2, confidence = $3, verified_case_count = $4, verified_success_count = $5, independent_reporter_count = $6 WHERE id = $1`,
    [failureModeId, prior, confidence, stats!.n, stats!.successes, stats!.reporters],
    db,
  );
  return { priorWeight: prior, confidence, verifiedCases: stats!.n, independentReporters: stats!.reporters };
}

/** Apply a verified outcome to the graph: stats, and compatibility evidence for parts used in successful repairs. */
export async function applyVerifiedOutcome(outcomeId: string, reviewerId: string, db: Queryable) {
  const o = await one(`UPDATE repair_outcomes SET verification_status = 'verified' WHERE id = $1 RETURNING *`, [outcomeId], db);
  if (!o) return null;
  const applied: Record<string, unknown> = { outcomeVerified: outcomeId };
  if (o.actual_failure_mode_id) applied.failureModeStats = await recomputeFailureModeStats(o.actual_failure_mode_id, db);
  if (o.succeeded && o.product_id) {
    const compat: string[] = [];
    for (const c of o.components_replaced as any[]) {
      if (!c.part_id) continue;
      let rel = await one(`SELECT id FROM part_compatibility WHERE part_id = $1 AND product_id = $2 AND variant_id IS NULL`, [c.part_id, o.product_id], db);
      // A successful verified repair is evidence, not proof: create a "potential" relationship if none exists.
      if (!rel) rel = await one(`INSERT INTO part_compatibility(part_id, product_id, state, verification_status, created_by, notes) VALUES ($1,$2,'potential','unverified',$3,'Created from a verified repair outcome') RETURNING id`, [c.part_id, o.product_id, reviewerId], db);
      await db.query(`INSERT INTO compatibility_evidence(compatibility_id, kind, description, repair_outcome_id, contributor_id) VALUES ($1,'verified_repair',$2,$3,$4)`, [
        rel!.id,
        `Used successfully in a verified repair (${c.component}).`,
        outcomeId,
        o.reporter_id,
      ]);
      compat.push(rel!.id);
    }
    if (compat.length) applied.compatibilityEvidence = compat;
  }
  return applied;
}
