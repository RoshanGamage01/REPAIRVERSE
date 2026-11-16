import { Router } from 'express';
import { ContributionInput, FailureModeInput, ProcedureInput, ReviewContributionInput } from '@repairverse/shared';
import { one, query, tx, type Queryable } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, isUuid, pageParams, parse } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { reputationDelta } from '../../engines/confidence.js';
import { applyVerifiedOutcome } from '../outcomes/service.js';
import { createFailureMode, createProcedure } from '../knowledge/graph.js';

export const contributionsRouter = Router();

contributionsRouter.post(
  '/',
  requireAuth,
  rateLimit({ name: 'contrib', limit: 30, windowSec: 3600 }),
  ah(async (req, res) => {
    const i = parse(ContributionInput, req.body);
    if (i.type === 'repair_outcome') throw badRequest('Repair outcomes are contributed by closing a repair job');
    const org = req.user!.memberships[0]?.organizationId ?? null;
    const c = await one(
      `INSERT INTO contributions(contributor_id, organization_id, type, title, target_entity_type, target_entity_id, payload, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user!.id, org, i.type, i.title, i.targetEntityType ?? null, i.targetEntityId ?? null, JSON.stringify(i.payload), JSON.stringify(i.evidence)],
    );
    await audit(req, 'contribution.submitted', 'contribution', c!.id, { type: i.type });
    await track('contribution_submitted', req.user!.id, c!.id, { type: i.type, role: req.user!.role });
    res.status(201).json({ id: c!.id, status: 'pending' });
  }),
);

contributionsRouter.get(
  '/mine',
  requireAuth,
  ah(async (req, res) => {
    const rows = await query(
      `SELECT c.id, c.type, c.title, c.status, c.review_notes, c.created_at, c.reviewed_at, c.quality_score,
              (SELECT coalesce(sum(delta),0) FROM reputation_ledger r WHERE r.contribution_id = c.id) AS reputation_delta
         FROM contributions c WHERE c.contributor_id = $1 ORDER BY c.created_at DESC LIMIT 200`,
      [req.user!.id],
    );
    const rep = await one('SELECT reputation FROM users WHERE id = $1', [req.user!.id]);
    res.json({ contributions: rows, reputation: rep?.reputation ?? 0 });
  }),
);

contributionsRouter.post(
  '/:id/evidence',
  requireAuth,
  ah(async (req, res) => {
    const c = await one('SELECT * FROM contributions WHERE id = $1', [req.params.id]);
    if (!c) throw notFound('Contribution');
    if (c.contributor_id !== req.user!.id) throw forbidden();
    if (c.status !== 'needs_evidence' && c.status !== 'pending') throw badRequest('This contribution has already been reviewed');
    const ev = parse(ContributionInput.shape.evidence, req.body?.evidence ?? []);
    await query(`UPDATE contributions SET evidence = evidence || $2::jsonb, status = 'pending' WHERE id = $1`, [c.id, JSON.stringify(ev)]);
    res.json({ ok: true });
  }),
);

/** Public "report inaccurate information" mechanism (works for any knowledge entity). */
contributionsRouter.post(
  '/reports',
  requireAuth,
  rateLimit({ name: 'report', limit: 20, windowSec: 3600 }),
  ah(async (req, res) => {
    const entityType = String(req.body?.entityType ?? '');
    const entityId = String(req.body?.entityId ?? '');
    const reason = String(req.body?.reason ?? '').trim();
    if (!isUuid(entityId) || !entityType || reason.length < 5) throw badRequest('entityType, entityId and a reason are required');
    const r = await one(`INSERT INTO content_reports(reporter_id, entity_type, entity_id, reason) VALUES ($1,$2,$3,$4) RETURNING id`, [req.user!.id, entityType.slice(0, 40), entityId, reason.slice(0, 2000)]);
    await audit(req, 'content.reported', entityType, entityId);
    res.status(201).json({ id: r!.id });
  }),
);

// ─── Moderation ───
export const moderationRouter = Router();
moderationRouter.use(requireRole('moderator', 'admin'));

moderationRouter.get(
  '/contributions',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const rows = await query(
      `SELECT c.id, c.type, c.title, c.status, c.created_at, c.reviewed_at, u.display_name AS contributor, u.reputation AS contributor_reputation, u.role AS contributor_role,
              jsonb_array_length(c.evidence) AS evidence_count, count(*) OVER()::int AS total
         FROM contributions c JOIN users u ON u.id = c.contributor_id WHERE ($3 = 'all' OR c.status = $3) ORDER BY c.created_at LIMIT $1 OFFSET $2`,
      [limit, offset, status],
    );
    res.json({ contributions: rows, total: rows[0]?.total ?? 0 });
  }),
);

moderationRouter.get(
  '/contributions/:id',
  ah(async (req, res) => {
    const c = await one(
      `SELECT c.*, u.display_name AS contributor, u.reputation AS contributor_reputation, u.role AS contributor_role, tp.verification_status AS contributor_verification
         FROM contributions c JOIN users u ON u.id = c.contributor_id LEFT JOIN technician_profiles tp ON tp.user_id = u.id WHERE c.id = $1`,
      [req.params.id],
    );
    if (!c) throw notFound('Contribution');
    const history = await one(
      `SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'rejected')::int AS rejected FROM contributions WHERE contributor_id = $1 AND id <> $2`,
      [c.contributor_id, c.id],
    );
    let outcome = null;
    let corroboration = null;
    if (c.repair_outcome_id) {
      outcome = await one(
        `SELECT o.*, fm.name AS failure_mode_name, p.name AS product_name FROM repair_outcomes o LEFT JOIN failure_modes fm ON fm.id = o.actual_failure_mode_id LEFT JOIN products p ON p.id = o.product_id WHERE o.id = $1`,
        [c.repair_outcome_id],
      );
      if (outcome?.actual_failure_mode_id) {
        corroboration = await one(
          `SELECT count(*)::int AS verified_cases, count(DISTINCT reporter_id) FILTER (WHERE reporter_id <> $2)::int AS other_reporters FROM repair_outcomes WHERE actual_failure_mode_id = $1 AND verification_status = 'verified'`,
          [outcome.actual_failure_mode_id, c.contributor_id],
        );
      }
    }
    const symptomNames = Array.isArray(c.payload?.symptomIds) && c.payload.symptomIds.length ? await query('SELECT id, name FROM symptoms WHERE id = ANY($1)', [c.payload.symptomIds]) : [];
    res.json({ contribution: c, contributorHistory: history, outcome, corroboration, symptomNames });
  }),
);

async function applyContribution(c: any, payload: any, reviewerId: string, db: Queryable): Promise<Record<string, unknown>> {
  switch (c.type) {
    case 'repair_outcome':
      if (!c.repair_outcome_id) return {};
      return (await applyVerifiedOutcome(c.repair_outcome_id, reviewerId, db)) ?? {};
    case 'compatibility':
      if (c.target_entity_id) await db.query(`UPDATE part_compatibility SET verification_status = 'verified', updated_at = now() WHERE id = $1`, [c.target_entity_id]);
      return { compatibilityVerified: c.target_entity_id };
    case 'new_product':
      if (c.target_entity_id) await db.query(`UPDATE products SET is_public = true, verification_status = 'verified', updated_at = now() WHERE id = $1`, [c.target_entity_id]);
      return { productPublished: c.target_entity_id };
    case 'failure_report': {
      const src = await one(`INSERT INTO knowledge_sources(kind, title, reliability_tier, created_by) VALUES ('expert_submission', $1, 3, $2) RETURNING id`, [`Contribution: ${c.title}`, c.contributor_id], db);
      const fm = parse(FailureModeInput, { ...payload, sourceIds: [...(payload.sourceIds ?? []), src!.id] });
      const id = await createFailureMode(fm, { createdBy: c.contributor_id, verification: 'verified', isPublic: true }, db);
      return { failureModeCreated: id };
    }
    case 'repair_procedure': {
      const src = await one(`INSERT INTO knowledge_sources(kind, title, reliability_tier, created_by) VALUES ('expert_submission', $1, 3, $2) RETURNING id`, [`Contribution: ${c.title}`, c.contributor_id], db);
      const pr = parse(ProcedureInput, { ...payload, provenance: 'community_contribution', sourceIds: [...(payload.sourceIds ?? []), src!.id] });
      const id = await createProcedure(pr, { createdBy: c.contributor_id, verification: 'verified', isPublic: true }, db);
      return { procedureCreated: id };
    }
    default:
      // corrections, observations and inaccuracy reports are applied manually by the reviewer; the decision is recorded.
      return { recorded: true };
  }
}

moderationRouter.post(
  '/contributions/:id/review',
  ah(async (req, res) => {
    const i = parse(ReviewContributionInput, req.body);
    const result = await tx(async (db) => {
      const c = await one('SELECT * FROM contributions WHERE id = $1 FOR UPDATE', [req.params.id], db);
      if (!c) throw notFound('Contribution');
      if (c.contributor_id === req.user!.id) throw forbidden('You cannot review your own contribution');
      if (c.status === 'approved' || c.status === 'rejected') throw badRequest('This contribution has already been decided');
      if (i.decision === 'request_evidence') {
        await db.query(`UPDATE contributions SET status = 'needs_evidence', review_notes = $2, reviewer_id = $3, reviewed_at = now() WHERE id = $1`, [c.id, i.notes ?? null, req.user!.id]);
        await audit(req, 'contribution.evidence_requested', 'contribution', c.id, {}, db);
        return { status: 'needs_evidence' };
      }
      const decision = i.decision === 'approve' ? 'approved' : 'rejected';
      const payload = i.editedPayload ?? c.payload;
      let applied: Record<string, unknown> = {};
      if (decision === 'approved') applied = await applyContribution(c, payload, req.user!.id, db);
      else if (c.repair_outcome_id) await db.query(`UPDATE repair_outcomes SET verification_status = 'rejected' WHERE id = $1`, [c.repair_outcome_id]);

      // Reputation based on quality signals, not volume.
      const prior = await one(`SELECT count(*)::int AS n FROM contributions WHERE contributor_id = $1 AND status = 'approved'`, [c.contributor_id], db);
      let corroborated = false;
      if (c.type === 'repair_outcome' && c.payload?.actualFailureModeId) {
        const other = await one(
          `SELECT 1 FROM repair_outcomes WHERE actual_failure_mode_id = $1 AND verification_status = 'verified' AND reporter_id <> $2 LIMIT 1`,
          [c.payload.actualFailureModeId, c.contributor_id],
          db,
        );
        corroborated = !!other;
      }
      const tier = c.evidence.some((e: any) => e.kind === 'url') ? 3 : 0;
      const rep = reputationDelta({ decision, type: c.type, evidenceCount: c.evidence.length, bestSourceTier: tier, corroborated, succeeded: c.payload?.succeeded ?? null, priorApprovedCount: prior!.n });
      await db.query(`INSERT INTO reputation_ledger(user_id, contribution_id, delta, reason) VALUES ($1,$2,$3,$4)`, [c.contributor_id, c.id, rep.delta, rep.reason]);
      await db.query(`UPDATE users SET reputation = greatest(0, reputation + $2) WHERE id = $1`, [c.contributor_id, rep.delta]);
      await db.query(`UPDATE contributions SET status = $2, review_notes = $3, reviewer_id = $4, reviewed_at = now(), applied = $5, payload = $6, quality_score = $7 WHERE id = $1`, [
        c.id,
        decision,
        i.notes ?? null,
        req.user!.id,
        JSON.stringify(applied),
        JSON.stringify(payload),
        decision === 'approved' ? Math.min(1, rep.delta / 15) : 0,
      ]);
      await audit(req, `contribution.${decision}`, 'contribution', c.id, { type: c.type, applied, reputation: rep.delta }, db);
      return { status: decision, applied, reputationDelta: rep.delta };
    });
    await track('contribution_reviewed', req.user!.id, req.params.id, { status: result.status });
    res.json(result);
  }),
);

moderationRouter.get(
  '/reports',
  ah(async (_req, res) => {
    res.json({ reports: await query(`SELECT r.*, u.display_name AS reporter FROM content_reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.created_at`) });
  }),
);

moderationRouter.post(
  '/reports/:id',
  ah(async (req, res) => {
    const status = req.body?.status === 'dismissed' ? 'dismissed' : 'resolved';
    await query(`UPDATE content_reports SET status = $2 WHERE id = $1`, [req.params.id, status]);
    await audit(req, `report.${status}`, 'content_report', req.params.id);
    res.json({ ok: true });
  }),
);
