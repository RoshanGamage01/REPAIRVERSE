import { Router, type Request } from 'express';
import {
  canTransitionJob,
  CloseJobInput,
  CreateJobInput,
  JobFindingInput,
  JobStatusInput,
  JobTestInput,
  JOB_STATUS_LABELS,
  QuoteItemInput,
  ReplacedComponentInput,
  WorkLogInput,
  type JobStatus,
} from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { primaryOrgId, requireAuth, requireOrgMember, requireRole } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, isUuid, pageParams, parse, uniqueSlug } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { rateLimit } from '../../lib/rateLimit.js';
import { assertFileAccess } from '../../storage/files.js';
import { getDiagnosisView, startDiagnosis } from '../diagnosis/service.js';
import { copilotAnswer } from '../../ai/operations.js';
import { retrieve } from '../knowledge/retrieval.js';
import { recordRepairOutcome } from '../outcomes/service.js';

export const proRouter = Router();
proRouter.use(requireAuth, requireRole('technician', 'admin'));

function orgId(req: Request): string {
  const explicit = req.get('x-org-id') ?? (typeof req.query.orgId === 'string' ? req.query.orgId : null);
  if (explicit) {
    requireOrgMember(req.user, explicit);
    return explicit;
  }
  return primaryOrgId(req.user);
}

async function loadJob(req: Request, id: string) {
  if (!isUuid(id)) throw notFound('Repair job');
  const j = await one('SELECT * FROM repair_jobs WHERE id = $1', [id]);
  if (!j) throw notFound('Repair job');
  requireOrgMember(req.user, j.organization_id);
  return j;
}

async function setStatus(req: Request, job: any, to: JobStatus, note?: string, db?: any) {
  if (job.status === to) return;
  if (!canTransitionJob(job.status, to)) throw badRequest(`Cannot move a job from "${JOB_STATUS_LABELS[job.status as JobStatus]}" to "${JOB_STATUS_LABELS[to]}"`);
  await query(`UPDATE repair_jobs SET status = $2, updated_at = now(), closed_at = CASE WHEN $2 IN ('completed','cancelled') THEN now() ELSE closed_at END WHERE id = $1`, [job.id, to], db);
  await query(`INSERT INTO job_status_history(job_id, from_status, to_status, note, changed_by) VALUES ($1,$2,$3,$4,$5)`, [job.id, job.status, to, note ?? null, req.user!.id], db);
  job.status = to;
}

// ─── Organization / business settings ───
proRouter.get(
  '/organization',
  ah(async (req, res) => {
    const id = orgId(req);
    const org = await one('SELECT * FROM organizations WHERE id = $1', [id]);
    const members = await query(`SELECT u.id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY m.created_at`, [id]);
    res.json({ organization: org, members, myRole: req.user!.memberships.find((m) => m.organizationId === id)?.role });
  }),
);

proRouter.post(
  '/organizations',
  ah(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2) throw badRequest('Business name required');
    const id = await tx(async (db) => {
      const o = await one(`INSERT INTO organizations(name, slug, phone, website, address) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, uniqueSlug(name), req.body.phone ?? null, req.body.website ?? null, req.body.address ?? null], db);
      await db.query(`INSERT INTO memberships(organization_id, user_id, role) VALUES ($1,$2,'owner')`, [o!.id, req.user!.id]);
      return o!.id;
    });
    await audit(req, 'organization.created', 'organization', id);
    res.status(201).json({ id });
  }),
);

proRouter.patch(
  '/organization',
  ah(async (req, res) => {
    const id = orgId(req);
    requireOrgMember(req.user, id, ['owner', 'manager']);
    await query(`UPDATE organizations SET name = coalesce($2,name), phone = coalesce($3,phone), website = coalesce($4,website), address = coalesce($5,address) WHERE id = $1`, [
      id,
      req.body?.name ?? null,
      req.body?.phone ?? null,
      req.body?.website ?? null,
      req.body?.address ?? null,
    ]);
    await audit(req, 'organization.updated', 'organization', id);
    res.json({ ok: true });
  }),
);

proRouter.post(
  '/organization/members',
  ah(async (req, res) => {
    const id = orgId(req);
    requireOrgMember(req.user, id, ['owner', 'manager']);
    const u = await one('SELECT id FROM users WHERE email = $1', [String(req.body?.email ?? '')]);
    if (!u) throw notFound('User with that email');
    const role = ['manager', 'technician', 'staff'].includes(req.body?.role) ? req.body.role : 'technician';
    await query(`INSERT INTO memberships(organization_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [id, u.id, role]);
    await audit(req, 'organization.member_added', 'organization', id, { userId: u.id, role });
    res.status(201).json({ ok: true });
  }),
);

// ─── Overview ───
proRouter.get(
  '/overview',
  ah(async (req, res) => {
    const id = orgId(req);
    const [byStatus, recent, contrib, outcomes] = await Promise.all([
      query(`SELECT status, count(*)::int AS n FROM repair_jobs WHERE organization_id = $1 GROUP BY status`, [id]),
      query(
        `SELECT j.id, j.number, j.status, j.customer_name, j.complaint, j.updated_at, d.nickname AS device FROM repair_jobs j JOIN devices d ON d.id = j.device_id
          WHERE j.organization_id = $1 AND j.status NOT IN ('delivered','cancelled') ORDER BY j.updated_at DESC LIMIT 8`,
        [id],
      ),
      one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'pending')::int AS pending FROM contributions WHERE contributor_id = $1`, [req.user!.id]),
      one(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE succeeded)::int AS succeeded, count(*) FILTER (WHERE top_hypothesis_correct)::int AS ai_top_correct,
                count(*) FILTER (WHERE top_hypothesis_correct IS NOT NULL)::int AS ai_evaluated FROM repair_outcomes WHERE organization_id = $1`,
        [id],
      ),
    ]);
    const me = await one('SELECT reputation FROM users WHERE id = $1', [req.user!.id]);
    res.json({ byStatus, recent, contributions: contrib, outcomes, reputation: me?.reputation ?? 0, technicianVerified: req.user!.technicianVerified });
  }),
);

// ─── Jobs ───
proRouter.get(
  '/jobs',
  ah(async (req, res) => {
    const id = orgId(req);
    const { limit, offset } = pageParams(req.query);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = await query(
      `SELECT j.id, j.number, j.status, j.customer_name, j.complaint, j.created_at, j.updated_at, d.nickname AS device, p.name AS product_name, p.model_number,
              count(*) OVER()::int AS total
         FROM repair_jobs j JOIN devices d ON d.id = j.device_id LEFT JOIN products p ON p.id = d.product_id
        WHERE j.organization_id = $1 AND ($4::text IS NULL OR j.status = $4)
          AND ($5 = '' OR j.customer_name ILIKE '%' || $5 || '%' OR j.complaint ILIKE '%' || $5 || '%' OR d.nickname ILIKE '%' || $5 || '%' OR j.number::text = $5)
        ORDER BY j.updated_at DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset, status, q],
    );
    res.json({ jobs: rows, total: rows[0]?.total ?? 0 });
  }),
);

proRouter.post(
  '/jobs',
  ah(async (req, res) => {
    const id = orgId(req);
    const i = parse(CreateJobInput, req.body);
    const jobId = await tx(async (db) => {
      // Customer devices belong to the organization, never to a consumer account.
      const d = await one(`INSERT INTO devices(organization_id, product_id, nickname, serial_number) VALUES ($1,$2,$3,$4) RETURNING id`, [id, i.device.productId ?? null, i.device.nickname, i.device.serialNumber ?? null], db);
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      const n = await one(`SELECT coalesce(max(number), 1000) + 1 AS n FROM repair_jobs WHERE organization_id = $1`, [id], db);
      const j = await one(
        `INSERT INTO repair_jobs(organization_id, number, device_id, customer_name, customer_contact, complaint, intake_condition, created_by, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [id, n!.n, d!.id, i.customerName, i.customerContact ?? null, i.complaint, i.intakeCondition ?? null, req.user!.id],
        db,
      );
      await db.query(`INSERT INTO job_status_history(job_id, to_status, changed_by, note) VALUES ($1,'received',$2,'Job created')`, [j!.id, req.user!.id]);
      await db.query(`INSERT INTO device_events(device_id, kind, title, details, job_id, created_by) VALUES ($1,'registered','Device received for repair',$2,$3,$4)`, [d!.id, i.complaint, j!.id, req.user!.id]);
      await audit(req, 'job.created', 'repair_job', j!.id, {}, db);
      return j!.id;
    });
    await track('repair_job_created', req.user!.id, jobId, {});
    res.status(201).json({ id: jobId });
  }),
);

proRouter.get(
  '/jobs/:id',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const [device, history, findings, quote, worklog, replaced, tests, attachments, outcome] = await Promise.all([
      one(
        `SELECT d.*, p.name AS product_name, p.slug AS product_slug, p.model_number, p.category_id, c.name AS category_name FROM devices d LEFT JOIN products p ON p.id = d.product_id LEFT JOIN categories c ON c.id = p.category_id WHERE d.id = $1`,
        [j.device_id],
      ),
      query(`SELECT h.*, u.display_name FROM job_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE job_id = $1 ORDER BY changed_at`, [j.id]),
      query(`SELECT f.*, fm.name AS failure_mode_name, u.display_name FROM job_findings f LEFT JOIN failure_modes fm ON fm.id = f.failure_mode_id LEFT JOIN users u ON u.id = f.created_by WHERE job_id = $1 ORDER BY created_at`, [j.id]),
      query(`SELECT q.*, pa.part_number FROM job_quote_items q LEFT JOIN parts pa ON pa.id = q.part_id WHERE job_id = $1 ORDER BY kind, description`, [j.id]),
      query(`SELECT w.*, u.display_name FROM job_work_log w LEFT JOIN users u ON u.id = w.created_by WHERE job_id = $1 ORDER BY created_at`, [j.id]),
      query(`SELECT r.*, ct.name AS component_name, pa.name AS part_name FROM job_replaced_components r JOIN component_types ct ON ct.id = r.component_type_id LEFT JOIN parts pa ON pa.id = r.part_id WHERE job_id = $1`, [j.id]),
      query(`SELECT * FROM job_tests WHERE job_id = $1 ORDER BY created_at`, [j.id]),
      query(`SELECT ja.file_id, ja.label, ja.stage, f.kind, f.mime_type FROM job_attachments ja JOIN files f ON f.id = ja.file_id WHERE job_id = $1`, [j.id]),
      one(`SELECT id, succeeded, verification_status, top_hypothesis_correct FROM repair_outcomes WHERE job_id = $1`, [j.id]),
    ]);
    const quoteTotal = quote.reduce((s, q) => s + q.quantity * q.unit_price_cents, 0);
    const diagnosis = j.diagnosis_session_id ? await getDiagnosisView(j.diagnosis_session_id, req.user) : null;
    res.json({
      job: { ...j, statusLabel: JOB_STATUS_LABELS[j.status as JobStatus] },
      allowedTransitions: (await import('@repairverse/shared')).JOB_TRANSITIONS[j.status as JobStatus],
      device,
      history,
      findings,
      quote: { items: quote, totalCents: quoteTotal, approvedAt: j.quote_approved_at },
      worklog,
      replacedComponents: replaced,
      tests,
      attachments,
      diagnosis,
      outcome,
    });
  }),
);

proRouter.post(
  '/jobs/:id/status',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(JobStatusInput, req.body);
    if (i.status === 'completed') throw badRequest('Use "Close job" to complete a repair so the outcome is recorded');
    await setStatus(req, j, i.status, i.note);
    await audit(req, 'job.status_changed', 'repair_job', j.id, { to: i.status });
    res.json({ ok: true, status: j.status });
  }),
);

proRouter.patch(
  '/jobs/:id',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    await query(`UPDATE repair_jobs SET intake_condition = coalesce($2, intake_condition), customer_contact = coalesce($3, customer_contact), updated_at = now() WHERE id = $1`, [
      j.id,
      req.body?.intakeCondition ?? null,
      req.body?.customerContact ?? null,
    ]);
    if (isUuid(req.body?.productId)) await query('UPDATE devices SET product_id = $2 WHERE id = $1', [j.device_id, req.body.productId]);
    res.json({ ok: true });
  }),
);

proRouter.post(
  '/jobs/:id/attachments',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const fileId = String(req.body?.fileId ?? '');
    if (!isUuid(fileId)) throw badRequest('fileId required');
    await assertFileAccess(fileId, req.user);
    await query(`INSERT INTO job_attachments(job_id, file_id, label, stage) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [j.id, fileId, req.body?.label ?? null, req.body?.stage ?? 'intake']);
    res.status(201).json({ ok: true });
  }),
);

/** Run AI-assisted diagnosis for the job. Suggestions are recorded as AI suggestions — never as confirmed findings. */
proRouter.post(
  '/jobs/:id/diagnose',
  rateLimit({ name: 'pro-diagnose', limit: 30 }),
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const device = await one('SELECT d.product_id, p.category_id FROM devices d LEFT JOIN products p ON p.id = d.product_id WHERE d.id = $1', [j.device_id]);
    const categoryId = device?.category_id ?? (isUuid(req.body?.categoryId) ? req.body.categoryId : null);
    if (!categoryId) throw badRequest('Link the device to a product or choose a category before diagnosing');
    const description = [j.complaint, req.body?.symptoms].filter(Boolean).join('\n');
    const view = await startDiagnosis(
      { productId: device?.product_id ?? null, categoryId, description, symptomIds: Array.isArray(req.body?.symptomIds) ? req.body.symptomIds.filter(isUuid) : [], fileIds: [], jobId: j.id, deviceId: null },
      { user: req.user, organizationId: j.organization_id },
    );
    await tx(async (db) => {
      await db.query(`UPDATE repair_jobs SET diagnosis_session_id = $2, updated_at = now() WHERE id = $1`, [j.id, view.id]);
      for (const h of view.hypotheses.slice(0, 3)) {
        await db.query(`INSERT INTO job_findings(job_id, kind, failure_mode_id, text, probability, created_by) VALUES ($1,'ai_suggestion',$2,$3,$4,$5)`, [
          j.id,
          h.failureModeId,
          `AI suggestion (hypothesis): ${h.name}`,
          h.probability,
          req.user!.id,
        ]);
      }
      if (['received', 'inspecting'].includes(j.status)) await setStatus(req, j, 'diagnosing', 'AI-assisted diagnosis started', db);
    });
    res.json(view);
  }),
);

proRouter.post(
  '/jobs/:id/findings',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(JobFindingInput, req.body);
    await tx(async (db) => {
      await db.query(`INSERT INTO job_findings(job_id, kind, failure_mode_id, text, created_by) VALUES ($1,$2,$3,$4,$5)`, [j.id, i.kind, i.failureModeId ?? null, i.text, req.user!.id]);
      if (i.kind === 'confirmed_diagnosis') {
        await db.query(`UPDATE repair_jobs SET confirmed_failure_mode_id = $2, updated_at = now() WHERE id = $1`, [j.id, i.failureModeId ?? null]);
        if (j.diagnosis_session_id && i.failureModeId) await db.query(`UPDATE diagnosis_sessions SET confirmed_failure_mode_id = $2 WHERE id = $1`, [j.diagnosis_session_id, i.failureModeId]);
      }
    });
    await audit(req, i.kind === 'confirmed_diagnosis' ? 'job.diagnosis_confirmed' : 'job.finding_added', 'repair_job', j.id, { failureModeId: i.failureModeId });
    res.status(201).json({ ok: true });
  }),
);

proRouter.post(
  '/jobs/:id/quote-items',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    if (j.quote_approved_at) throw conflict('The quote has been approved; record changes in the work log instead');
    const i = parse(QuoteItemInput, req.body);
    const r = await one(`INSERT INTO job_quote_items(job_id, kind, description, part_id, quantity, unit_price_cents) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [
      j.id,
      i.kind,
      i.description,
      i.partId ?? null,
      i.quantity,
      i.unitPriceCents,
    ]);
    res.status(201).json({ id: r!.id });
  }),
);

proRouter.delete(
  '/jobs/:id/quote-items/:itemId',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    if (j.quote_approved_at) throw conflict('The quote has been approved');
    await query('DELETE FROM job_quote_items WHERE id = $1 AND job_id = $2', [req.params.itemId, j.id]);
    res.status(204).end();
  }),
);

proRouter.post(
  '/jobs/:id/quote/approve',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const n = await one('SELECT count(*)::int AS n FROM job_quote_items WHERE job_id = $1', [j.id]);
    if (!n!.n) throw badRequest('Add at least one quote item first');
    await query('UPDATE repair_jobs SET quote_approved_at = now(), updated_at = now() WHERE id = $1', [j.id]);
    await audit(req, 'job.quote_approved', 'repair_job', j.id, { recordedBy: req.user!.id, note: req.body?.note ?? null });
    res.json({ ok: true });
  }),
);

/** Customer-friendly quotation document (deterministic totals). */
proRouter.get(
  '/jobs/:id/quote',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const org = await one('SELECT name, phone, website, address FROM organizations WHERE id = $1', [j.organization_id]);
    const items = await query('SELECT kind, description, quantity, unit_price_cents FROM job_quote_items WHERE job_id = $1 ORDER BY kind', [j.id]);
    const findings = await query(`SELECT kind, text FROM job_findings WHERE job_id = $1 AND kind <> 'ai_suggestion' ORDER BY created_at`, [j.id]);
    const total = items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0);
    res.json({
      business: org,
      jobNumber: j.number,
      customer: j.customer_name,
      issue: j.complaint,
      findings: findings.map((f) => ({ confirmed: f.kind === 'confirmed_diagnosis', text: f.text })),
      items: items.map((i) => ({ ...i, lineTotalCents: i.quantity * i.unit_price_cents })),
      totalCents: total,
      note: findings.some((f) => f.kind === 'confirmed_diagnosis') ? null : 'Diagnosis not yet confirmed by the technician. Final cost may change after further testing.',
    });
  }),
);

proRouter.post(
  '/jobs/:id/worklog',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(WorkLogInput, req.body);
    await query(`INSERT INTO job_work_log(job_id, text, minutes, created_by) VALUES ($1,$2,$3,$4)`, [j.id, i.text, i.minutes, req.user!.id]);
    res.status(201).json({ ok: true });
  }),
);

proRouter.post(
  '/jobs/:id/replaced-components',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(ReplacedComponentInput, req.body);
    await tx(async (db) => {
      await db.query(`INSERT INTO job_replaced_components(job_id, component_type_id, part_id, old_part_number, new_part_number, notes) VALUES ($1,$2,$3,$4,$5,$6)`, [
        j.id,
        i.componentTypeId,
        i.partId ?? null,
        i.oldPartNumber ?? null,
        i.newPartNumber ?? null,
        i.notes ?? null,
      ]);
      // RepairEvent REPLACED Component — recorded on the device timeline.
      await db.query(`INSERT INTO device_events(device_id, kind, title, details, job_id, component_type_id, created_by) VALUES ($1,'component_replaced',$2,$3,$4,$5,$6)`, [
        j.device_id,
        'Component replaced',
        [i.oldPartNumber && `Old: ${i.oldPartNumber}`, i.newPartNumber && `New: ${i.newPartNumber}`, i.notes].filter(Boolean).join(' · ') || null,
        j.id,
        i.componentTypeId,
        req.user!.id,
      ]);
    });
    res.status(201).json({ ok: true });
  }),
);

proRouter.post(
  '/jobs/:id/tests',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(JobTestInput, req.body);
    await query(`INSERT INTO job_tests(job_id, name, result, notes) VALUES ($1,$2,$3,$4)`, [j.id, i.name, i.result, i.notes ?? null]);
    res.status(201).json({ ok: true });
  }),
);

/** Close the job: records the repair outcome and (optionally) submits it as a knowledge contribution for moderation. */
proRouter.post(
  '/jobs/:id/close',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const i = parse(CloseJobInput, req.body);
    if (j.status !== 'testing') throw badRequest('Move the job to "Testing" and record final test results before closing');
    const tests = await query('SELECT name, result FROM job_tests WHERE job_id = $1', [j.id]);
    if (!tests.length) throw badRequest('Record at least one final test result before closing');
    if (i.succeeded && tests.some((t) => t.result === 'fail')) throw badRequest('A final test failed — the repair cannot be closed as successful');
    const result = await recordRepairOutcome(j, i, req);
    await tx(async (db) => {
      await setStatus(req, j, 'completed', i.succeeded ? 'Repair completed successfully' : 'Repair closed without success', db);
      await db.query(`INSERT INTO device_events(device_id, kind, title, details, job_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [
        j.device_id,
        i.succeeded ? 'repair_completed' : 'repair_attempt',
        i.succeeded ? 'Repair completed' : 'Repair attempt unsuccessful',
        i.actualFailureText ?? null,
        j.id,
        req.user!.id,
      ]);
    });
    await audit(req, 'job.closed', 'repair_job', j.id, { succeeded: i.succeeded, outcomeId: result.outcomeId, contributionId: result.contributionId });
    res.json({ ok: true, ...result });
  }),
);

/** Repair report (for the customer and the record). */
proRouter.get(
  '/jobs/:id/report',
  ah(async (req, res) => {
    const j = await loadJob(req, req.params.id);
    const [org, device, findings, replaced, tests, worklog, items] = await Promise.all([
      one('SELECT name, phone, website FROM organizations WHERE id = $1', [j.organization_id]),
      one('SELECT d.nickname, d.serial_number, p.name AS product, p.model_number FROM devices d LEFT JOIN products p ON p.id = d.product_id WHERE d.id = $1', [j.device_id]),
      query(`SELECT f.kind, f.text, fm.name AS failure_mode FROM job_findings f LEFT JOIN failure_modes fm ON fm.id = f.failure_mode_id WHERE f.job_id = $1 ORDER BY f.created_at`, [j.id]),
      query(`SELECT ct.name AS component, r.old_part_number, r.new_part_number, r.notes FROM job_replaced_components r JOIN component_types ct ON ct.id = r.component_type_id WHERE job_id = $1`, [j.id]),
      query('SELECT name, result, notes FROM job_tests WHERE job_id = $1', [j.id]),
      query('SELECT text, minutes, created_at FROM job_work_log WHERE job_id = $1 ORDER BY created_at', [j.id]),
      query('SELECT description, quantity, unit_price_cents FROM job_quote_items WHERE job_id = $1', [j.id]),
    ]);
    res.json({
      business: org,
      jobNumber: j.number,
      status: JOB_STATUS_LABELS[j.status as JobStatus],
      customer: j.customer_name,
      device,
      reportedIssue: j.complaint,
      intakeCondition: j.intake_condition,
      aiSuggestions: findings.filter((f) => f.kind === 'ai_suggestion').map((f) => f.failure_mode ?? f.text),
      technicianFindings: findings.filter((f) => f.kind === 'technician_finding').map((f) => f.text),
      confirmedDiagnosis: findings.filter((f) => f.kind === 'confirmed_diagnosis').map((f) => f.failure_mode ?? f.text),
      workPerformed: worklog,
      replacedComponents: replaced,
      finalTests: tests,
      totalCents: items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0),
      generatedAt: new Date().toISOString(),
    });
  }),
);

/** Professional AI copilot: retrieval-grounded technical Q&A. */
proRouter.post(
  '/copilot',
  rateLimit({ name: 'copilot', limit: 30 }),
  ah(async (req, res) => {
    const question = String(req.body?.question ?? '').trim();
    if (question.length < 3) throw badRequest('Ask a question');
    let context = '';
    let jobId: string | null = null;
    if (isUuid(req.body?.jobId)) {
      const j = await loadJob(req, req.body.jobId);
      jobId = j.id;
      const d = await one('SELECT p.name, p.model_number FROM devices d LEFT JOIN products p ON p.id = d.product_id WHERE d.id = $1', [j.device_id]);
      const f = await query(`SELECT kind, text FROM job_findings WHERE job_id = $1`, [j.id]);
      context = `Device: ${d?.name ?? 'unidentified'} ${d?.model_number ?? ''}\nComplaint: ${j.complaint}\nFindings:\n${f.map((x) => `- [${x.kind}] ${x.text}`).join('\n')}`;
    }
    const refs = await retrieve(`${question} ${context}`.slice(0, 500), { limit: 6 });
    const r = await copilotAnswer({ question, context, references: refs.map((x) => ({ id: x.id, title: x.title, text: x.text })), userId: req.user!.id, entityId: jobId });
    const references = refs.map((x) => ({ id: x.id, title: x.title, sourceKind: x.sourceKind, url: x.url, locator: x.locator, excerpt: x.text.slice(0, 400) }));
    if (!r.ok) {
      // Without an AI provider, return retrieved knowledge directly — clearly labelled.
      return res.json({ status: r.reason, message: r.message, answer: null, references, knowledgeAvailable: references.length > 0 });
    }
    res.json({
      status: 'answered',
      answer: r.data.answer,
      knowledgeAvailable: r.data.knowledge_available,
      citedReferences: references.filter((x) => r.data.cited_reference_ids.includes(x.id)),
      references,
      suggestedChecks: r.data.suggested_checks,
      alternativeExplanations: r.data.alternative_explanations,
      provenance: 'ai_generated',
    });
  }),
);

proRouter.get(
  '/customers/devices/:deviceId',
  ah(async (req, res) => {
    const d = await one('SELECT * FROM devices WHERE id = $1', [req.params.deviceId]);
    if (!d || !d.organization_id) throw notFound('Device');
    requireOrgMember(req.user, d.organization_id);
    const events = await query('SELECT * FROM device_events WHERE device_id = $1 ORDER BY occurred_at DESC', [d.id]);
    res.json({ device: d, events });
  }),
);

