import { Router } from 'express';
import { AI_CAPABILITIES, AIModelConfigInput, USER_ROLES } from '@repairverse/shared';
import { one, pool, query } from '../../db/pool.js';
import { requireRole } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { ah, pageParams, parse } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { aiAvailability, aiUsageSummary } from '../../ai/orchestrator.js';
import { redisStatus } from '../../lib/redis.js';
import { retryDeadJob } from '../../queue/queue.js';
import { config } from '../../config.js';
import { partsProviders } from '../parts/service.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin', 'moderator'));
const adminOnly = requireRole('admin');

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Product success metrics (PRODUCT_SPECIFICATION.md §Metrics). */
adminRouter.get(
  '/metrics',
  ah(async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = `now() - interval '${days} days'`;
    const ev = await query(`SELECT name, count(*)::int AS n FROM analytics_events WHERE created_at >= ${since} GROUP BY name`);
    const e = (name: string) => ev.find((x) => x.name === name)?.n ?? 0;
    const outcomes = await one(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE succeeded)::int AS succeeded, count(*) FILTER (WHERE top_hypothesis_correct)::int AS top_correct,
              count(*) FILTER (WHERE top_hypothesis_correct IS NOT NULL)::int AS evaluated, count(*) FILTER (WHERE follow_up_status = 'recurred')::int AS recurred
         FROM repair_outcomes WHERE created_at >= ${since}`,
    );
    const repeat = await one(
      `SELECT count(*)::int AS n FROM (SELECT device_id, component_type_id FROM device_events WHERE kind = 'component_replaced' AND component_type_id IS NOT NULL AND occurred_at >= ${since}
         GROUP BY device_id, component_type_id HAVING count(*) > 1) x`,
    );
    const contrib = await one(
      `SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'rejected')::int AS rejected, count(*)::int AS total,
              count(*) FILTER (WHERE type = 'repair_outcome')::int AS outcome_contributions FROM contributions WHERE created_at >= ${since}`,
    );
    const closedJobs = await one(`SELECT count(*)::int AS n FROM repair_jobs WHERE closed_at >= ${since} AND status IN ('completed','delivered')`);
    const compat = await one(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'confirmed' AND verification_status IN ('verified','demo'))::int AS confirmed_verified,
              count(*) FILTER (WHERE state = 'potential')::int AS potential, count(*) FILTER (WHERE state = 'incompatible')::int AS incompatible FROM part_compatibility`,
    );
    const ai = await one(
      `SELECT coalesce(sum(cost_usd),0)::float AS total_cost, coalesce(sum(cost_usd) FILTER (WHERE entity_type = 'diagnosis_session'),0)::float AS diagnosis_cost FROM ai_operations WHERE created_at >= ${since}`,
    );
    const guides = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE (properties->>'withSources')::boolean)::int AS with_sources FROM analytics_events WHERE name = 'repair_guide_viewed' AND created_at >= ${since}`);
    const identAttempts = e('identification_attempted');
    res.json({
      periodDays: days,
      metrics: [
        { key: 'identification_success_rate', label: 'Product identification success rate', value: ratio(e('identification_confirmed'), identAttempts), numerator: e('identification_confirmed'), denominator: identAttempts, definition: 'Top suggestion confirmed by the user ÷ identification attempts' },
        { key: 'identification_correction_rate', label: 'Identification correction rate', value: ratio(e('identification_corrected'), e('identification_confirmed') + e('identification_corrected')), numerator: e('identification_corrected'), denominator: e('identification_confirmed') + e('identification_corrected'), definition: 'Confirmations that differed from the top suggestion' },
        { key: 'diagnostic_completion_rate', label: 'Diagnostic completion rate', value: ratio(e('diagnosis_completed'), e('diagnosis_started')), numerator: e('diagnosis_completed'), denominator: e('diagnosis_started') },
        { key: 'diagnostic_accuracy', label: 'Diagnostic accuracy vs confirmed outcomes', value: ratio(outcomes!.top_correct, outcomes!.evaluated), numerator: outcomes!.top_correct, denominator: outcomes!.evaluated, definition: 'Leading hypothesis matched the technician-confirmed failure' },
        { key: 'repair_success_rate', label: 'Repair success rate', value: ratio(outcomes!.succeeded, outcomes!.total), numerator: outcomes!.succeeded, denominator: outcomes!.total },
        { key: 'repair_guide_completion_rate', label: 'Repair guide → completed repair', value: ratio(e('repair_completed_consumer'), e('repair_guide_viewed')), numerator: e('repair_completed_consumer'), denominator: e('repair_guide_viewed'), definition: 'Consumer-recorded completed repairs ÷ guides viewed' },
        { key: 'compatibility_confidence', label: 'Parts compatibility confidence', value: ratio(compat!.confirmed_verified, compat!.total), numerator: compat!.confirmed_verified, denominator: compat!.total, definition: 'Verified confirmed relations ÷ all compatibility relations', breakdown: compat },
        { key: 'technician_contribution_rate', label: 'Technician contribution rate', value: ratio(contrib!.outcome_contributions, closedJobs!.n), numerator: contrib!.outcome_contributions, denominator: closedJobs!.n, definition: 'Outcome contributions ÷ closed jobs' },
        { key: 'knowledge_approval_rate', label: 'Knowledge approval rate', value: ratio(contrib!.approved, contrib!.approved + contrib!.rejected), numerator: contrib!.approved, denominator: contrib!.approved + contrib!.rejected },
        { key: 'repeat_repair_incidents', label: 'Repeat repair incidents', value: repeat!.n + outcomes!.recurred, definition: 'Same component replaced twice on one device, plus recurred outcomes' },
        { key: 'cost_per_ai_diagnosis', label: 'AI cost per diagnosis (USD)', value: e('diagnosis_started') ? Math.round((ai!.diagnosis_cost / e('diagnosis_started')) * 10000) / 10000 : null },
        { key: 'cost_per_completed_repair', label: 'AI cost per completed repair workflow (USD)', value: outcomes!.total ? Math.round((ai!.total_cost / outcomes!.total) * 10000) / 10000 : null },
        { key: 'recommendations_with_sources', label: 'Recommendations with supporting sources', value: ratio(guides!.with_sources, guides!.n), numerator: guides!.with_sources, denominator: guides!.n },
      ],
    });
  }),
);

adminRouter.get(
  '/overview',
  ah(async (_req, res) => {
    const counts = await one(`SELECT
      (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM users WHERE role = 'technician')::int AS technicians,
      (SELECT count(*) FROM organizations)::int AS organizations,
      (SELECT count(*) FROM contributions WHERE status = 'pending')::int AS pending_contributions,
      (SELECT count(*) FROM verification_requests WHERE status = 'pending')::int AS pending_verifications,
      (SELECT count(*) FROM extracted_items WHERE status = 'pending')::int AS pending_extractions,
      (SELECT count(*) FROM content_reports WHERE status = 'open')::int AS open_reports,
      (SELECT count(*) FROM background_jobs WHERE status = 'dead')::int AS dead_jobs,
      (SELECT count(*) FROM diagnosis_sessions WHERE created_at > now() - interval '7 days')::int AS diagnoses_7d,
      (SELECT coalesce(sum(cost_usd),0) FROM ai_operations WHERE created_at >= date_trunc('month', now()))::float AS ai_cost_month`);
    res.json({ counts, aiBudgetUsd: config.AI_MONTHLY_BUDGET_USD });
  }),
);

adminRouter.get(
  '/users',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const q = String(req.query.q ?? '');
    const rows = await query(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.reputation, u.created_at, u.last_login_at, tp.verification_status, count(*) OVER()::int AS total
         FROM users u LEFT JOIN technician_profiles tp ON tp.user_id = u.id
        WHERE ($3 = '' OR u.email ILIKE '%' || $3 || '%' OR u.display_name ILIKE '%' || $3 || '%') ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset, q],
    );
    res.json({ users: rows, total: rows[0]?.total ?? 0 });
  }),
);

adminRouter.patch(
  '/users/:id',
  adminOnly,
  ah(async (req, res) => {
    if (req.params.id === req.user!.id) throw forbidden('You cannot change your own role or status');
    const role = req.body?.role;
    const status = req.body?.status;
    if (role && !USER_ROLES.includes(role)) throw badRequest('Invalid role');
    if (status && !['active', 'suspended'].includes(status)) throw badRequest('Invalid status');
    const r = await one('UPDATE users SET role = coalesce($2, role), status = coalesce($3, status) WHERE id = $1 RETURNING id', [req.params.id, role ?? null, status ?? null]);
    if (!r) throw notFound('User');
    if (status === 'suspended') await query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    await audit(req, 'user.updated', 'user', req.params.id, { role, status });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/organizations',
  ah(async (_req, res) => {
    res.json({
      organizations: await query(
        `SELECT o.*, (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id)::int AS members, (SELECT count(*) FROM repair_jobs j WHERE j.organization_id = o.id)::int AS jobs
           FROM organizations o ORDER BY o.created_at DESC LIMIT 200`,
      ),
    });
  }),
);

adminRouter.get(
  '/verification-requests',
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    res.json({
      requests: await query(
        `SELECT vr.*, u.display_name, u.email, u.reputation, tp.headline, tp.specialties, tp.years_experience, tp.business_name, tp.service_area,
                (SELECT count(*) FROM contributions c WHERE c.contributor_id = u.id AND c.status = 'approved')::int AS approved_contributions,
                (SELECT count(*) FROM repair_outcomes o WHERE o.reporter_id = u.id AND o.verification_status = 'verified')::int AS verified_outcomes
           FROM verification_requests vr JOIN users u ON u.id = vr.user_id LEFT JOIN technician_profiles tp ON tp.user_id = u.id
          WHERE ($1 = 'all' OR vr.status = $1) ORDER BY vr.created_at`,
        [status],
      ),
    });
  }),
);

/** Credentials are shown as verified only after an administrator completes this review. */
adminRouter.post(
  '/verification-requests/:id/review',
  adminOnly,
  ah(async (req, res) => {
    const decision = req.body?.decision;
    if (!['approve', 'reject', 'request_evidence'].includes(decision)) throw badRequest('Invalid decision');
    const vr = await one('SELECT * FROM verification_requests WHERE id = $1', [req.params.id]);
    if (!vr) throw notFound('Verification request');
    if (vr.user_id === req.user!.id) throw forbidden('You cannot verify yourself');
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_evidence';
    await query('UPDATE verification_requests SET status = $2, reviewer_id = $3, review_notes = $4, reviewed_at = now() WHERE id = $1', [vr.id, status, req.user!.id, req.body?.notes ?? null]);
    const tpStatus = decision === 'approve' ? 'verified' : decision === 'reject' ? 'rejected' : 'pending';
    await query(`UPDATE technician_profiles SET verification_status = $2, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END, verified_by = CASE WHEN $2 = 'verified' THEN $3::uuid ELSE NULL END WHERE user_id = $1`, [
      vr.user_id,
      tpStatus,
      req.user!.id,
    ]);
    await audit(req, `technician.verification_${status}`, 'user', vr.user_id, { requestId: vr.id, notes: req.body?.notes });
    res.json({ ok: true, status });
  }),
);

// ─── AI configuration & usage ───
adminRouter.get(
  '/ai/config',
  ah(async (_req, res) => {
    const rows = await query('SELECT * FROM ai_model_config ORDER BY capability');
    res.json({ config: rows, availability: await aiAvailability(), monthlyBudgetUsd: config.AI_MONTHLY_BUDGET_USD });
  }),
);

adminRouter.put(
  '/ai/config/:capability',
  adminOnly,
  ah(async (req, res) => {
    const cap = req.params.capability;
    if (!AI_CAPABILITIES.includes(cap as any)) throw badRequest('Unknown capability');
    const i = parse(AIModelConfigInput, req.body);
    await query(
      `INSERT INTO ai_model_config(capability, provider, model, input_cost_per_mtok, output_cost_per_mtok, enabled, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (capability) DO UPDATE SET provider=EXCLUDED.provider, model=EXCLUDED.model, input_cost_per_mtok=EXCLUDED.input_cost_per_mtok, output_cost_per_mtok=EXCLUDED.output_cost_per_mtok,
         enabled=EXCLUDED.enabled, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [cap, i.provider, i.model, i.inputCostPerMTok, i.outputCostPerMTok, i.enabled, req.user!.id],
    );
    await audit(req, 'ai.config_updated', 'ai_model_config', cap, i);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/ai/usage',
  ah(async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const recent = await query(
      `SELECT id, operation, capability, provider, model, status, input_tokens, output_tokens, cost_usd, latency_ms, error, entity_type, entity_id, created_at FROM ai_operations ORDER BY created_at DESC LIMIT 100`,
    );
    const totals = await one(
      `SELECT count(*)::int AS calls, coalesce(sum(cost_usd),0)::float AS cost, coalesce(sum(input_tokens),0)::int AS input_tokens, coalesce(sum(output_tokens),0)::int AS output_tokens,
              count(*) FILTER (WHERE status = 'rejected_by_validation')::int AS rejected, count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM ai_operations WHERE created_at >= now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    res.json({ totals, daily: await aiUsageSummary(days), recent });
  }),
);

/** AI-generated content review: extracted items and AI operations awaiting attention. */
adminRouter.get(
  '/ai/content',
  ah(async (_req, res) => {
    const extracted = await query(
      `SELECT e.id, e.item_type, e.payload, e.confidence, e.extractor, e.status, e.created_at, d.id AS document_id, s.title AS source_title
         FROM extracted_items e JOIN documents d ON d.id = e.document_id JOIN knowledge_sources s ON s.id = d.source_id WHERE e.status IN ('pending','needs_evidence') ORDER BY e.created_at LIMIT 100`,
    );
    const procedures = await query(`SELECT id, title, verification_status, created_at FROM repair_procedures WHERE provenance = 'ai_generated' ORDER BY created_at DESC LIMIT 50`);
    res.json({ extracted, procedures });
  }),
);

// ─── Operations ───
adminRouter.get(
  '/system/health',
  ah(async (_req, res) => {
    const started = Date.now();
    await query('SELECT 1');
    const dbLatency = Date.now() - started;
    const jobs = await query(`SELECT status, count(*)::int AS n FROM background_jobs GROUP BY status`);
    const dbSize = await one(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
    const ext = await query(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','postgis','pg_trgm')`);
    res.json({
      database: { status: 'ok', latencyMs: dbLatency, size: dbSize?.size, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, extensions: ext },
      redis: redisStatus(),
      storage: config.STORAGE_DRIVER,
      queue: jobs,
      ai: await aiAvailability(),
      partsProviders: partsProviders(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      version: process.env.APP_VERSION ?? '0.1.0',
    });
  }),
);

adminRouter.get(
  '/jobs',
  ah(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    res.json({
      jobs: await query(`SELECT id, type, status, attempts, max_attempts, last_error, progress, created_at, updated_at, run_at FROM background_jobs WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 100`, [status]),
    });
  }),
);

adminRouter.post(
  '/jobs/:id/retry',
  adminOnly,
  ah(async (req, res) => {
    const r = await retryDeadJob(req.params.id);
    if (!r) throw badRequest('Only dead or failed jobs can be retried');
    await audit(req, 'job.retried', 'background_job', req.params.id);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/audit-logs',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query, 200);
    const action = String(req.query.action ?? '');
    res.json({
      logs: await query(
        `SELECT a.*, u.display_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ($3 = '' OR a.action ILIKE $3 || '%') ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset, action],
      ),
    });
  }),
);

adminRouter.get(
  '/api-clients',
  ah(async (_req, res) => {
    res.json({
      clients: await query(
        `SELECT c.id, c.name, c.key_prefix, c.scopes, c.rate_limit_per_minute, c.monthly_quota, c.status, c.created_at, c.last_used_at, u.email AS owner,
                (SELECT count(*) FROM api_usage x WHERE x.client_id = c.id AND x.created_at >= date_trunc('month', now()))::int AS month_requests
           FROM api_clients c JOIN users u ON u.id = c.owner_user_id ORDER BY c.created_at DESC`,
      ),
    });
  }),
);

adminRouter.post(
  '/api-clients/:id/revoke',
  adminOnly,
  ah(async (req, res) => {
    await query(`UPDATE api_clients SET status = 'revoked' WHERE id = $1`, [req.params.id]);
    await audit(req, 'api_client.revoked_by_admin', 'api_client', req.params.id);
    res.json({ ok: true });
  }),
);

adminRouter.patch(
  '/api-clients/:id',
  adminOnly,
  ah(async (req, res) => {
    const rl = Number(req.body?.rateLimitPerMinute);
    const quota = Number(req.body?.monthlyQuota);
    await query(`UPDATE api_clients SET rate_limit_per_minute = coalesce($2, rate_limit_per_minute), monthly_quota = coalesce($3, monthly_quota) WHERE id = $1`, [
      req.params.id,
      Number.isFinite(rl) && rl > 0 ? rl : null,
      Number.isFinite(quota) && quota > 0 ? quota : null,
    ]);
    await audit(req, 'api_client.limits_updated', 'api_client', req.params.id, req.body ?? {});
    res.json({ ok: true });
  }),
);
