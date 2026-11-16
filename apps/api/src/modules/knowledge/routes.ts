import { Router } from 'express';
import { CitationInput, FailureModeInput, ProcedureInput, SOURCE_RELIABILITY, SourceInput } from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { isStaff, requireAuth, requireRole } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { ah, isUuid, pageParams, parse } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { enqueue } from '../../queue/queue.js';
import { assertFileAccess } from '../../storage/files.js';
import { retrieve } from './retrieval.js';
import { createFailureMode, createProcedure } from './graph.js';
import { sourcesFor } from '../catalog/service.js';
import { recomputeFailureModeStats } from '../outcomes/service.js';

export const knowledgeRouter = Router();
const staffOnly = requireRole('moderator', 'admin');

// ─── Public knowledge reads ───
knowledgeRouter.get(
  '/search',
  ah(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) throw badRequest('Query too short');
    const refs = await retrieve(q, { limit: 8 });
    res.json({ results: refs.map((r) => ({ id: r.id, title: r.title, excerpt: r.text.slice(0, 600), sourceKind: r.sourceKind, url: r.url, locator: r.locator, reliabilityTier: r.reliabilityTier, score: r.score })) });
  }),
);

knowledgeRouter.get(
  '/failure-modes',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const staff = isStaff(req.user);
    const rows = await query(
      `SELECT fm.id, fm.slug, fm.name, fm.risk_level, fm.verification_status, fm.is_demo, fm.is_public, fm.confidence, fm.verified_case_count, fm.prior_weight, fm.base_prior,
              ct.name AS component_name, c.name AS category_name, p.name AS product_name, count(*) OVER()::int AS total
         FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id LEFT JOIN categories c ON c.id = fm.category_id LEFT JOIN products p ON p.id = fm.product_id
        WHERE ($3 OR fm.is_public) AND ($4 = '' OR fm.name ILIKE '%' || $4 || '%') AND ($5::uuid IS NULL OR fm.category_id = $5)
        ORDER BY c.name, fm.name LIMIT $1 OFFSET $2`,
      [limit, offset, staff, String(req.query.q ?? ''), isUuid(req.query.categoryId) ? req.query.categoryId : null],
    );
    res.json({ failureModes: rows, total: rows[0]?.total ?? 0 });
  }),
);

knowledgeRouter.get(
  '/failure-modes/:id',
  ah(async (req, res) => {
    const fm = await one(
      `SELECT fm.*, ct.name AS component_name, c.name AS category_name, p.name AS product_name FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id
         LEFT JOIN categories c ON c.id = fm.category_id LEFT JOIN products p ON p.id = fm.product_id WHERE ${isUuid(req.params.id) ? 'fm.id = $1' : 'fm.slug = $1'}`,
      [req.params.id],
    );
    if (!fm || (!fm.is_public && !isStaff(req.user))) throw notFound('Failure mode');
    const [symptoms, probes, procedures, sources] = await Promise.all([
      query(`SELECT s.id, s.name, fs.likelihood, fs.base_likelihood FROM failure_mode_symptoms fs JOIN symptoms s ON s.id = fs.symptom_id WHERE fs.failure_mode_id = $1 ORDER BY fs.likelihood DESC`, [fm.id]),
      query(
        `SELECT p.id, p.kind, p.prompt, p.risk_level, json_agg(json_build_object('answer', e.answer_value, 'lr', e.likelihood_ratio)) AS effects
           FROM probe_effects e JOIN diagnostic_probes p ON p.id = e.probe_id WHERE e.failure_mode_id = $1 GROUP BY p.id`,
        [fm.id],
      ),
      query(`SELECT id, slug, title, difficulty, risk_level, provenance, verification_status FROM repair_procedures WHERE failure_mode_id = $1 AND verification_status <> 'rejected'`, [fm.id]),
      sourcesFor([{ type: 'failure_mode', id: fm.id }]),
    ]);
    res.json({ failureMode: fm, symptoms, probes, procedures, sources, confirmedCases: fm.verified_case_count });
  }),
);

// ─── Curation (moderators/admins) ───
knowledgeRouter.post(
  '/failure-modes',
  staffOnly,
  ah(async (req, res) => {
    const i = parse(FailureModeInput, req.body);
    const id = await tx(async (db) => {
      const fid = await createFailureMode(i, { createdBy: req.user!.id, verification: i.sourceIds.length ? 'verified' : 'unverified', isPublic: true }, db);
      await audit(req, 'failure_mode.created', 'failure_mode', fid, {}, db);
      return fid;
    });
    res.status(201).json({ id });
  }),
);

knowledgeRouter.post(
  '/failure-modes/:id/probes',
  staffOnly,
  ah(async (req, res) => {
    const kind = req.body?.kind === 'test' ? 'test' : 'question';
    const prompt = String(req.body?.prompt ?? '').trim();
    const effects = req.body?.effects as Record<string, number> | undefined; // answer -> LR for this failure mode
    if (!prompt || !effects || !Object.keys(effects).length) throw badRequest('prompt and effects required');
    const risk = ['low', 'medium', 'high'].includes(req.body?.riskLevel) ? req.body.riskLevel : 'low';
    const fm = await one('SELECT id, category_id FROM failure_modes WHERE id = $1', [req.params.id]);
    if (!fm) throw notFound('Failure mode');
    const id = await tx(async (db) => {
      const existing = isUuid(req.body?.probeId) ? await one('SELECT id FROM diagnostic_probes WHERE id = $1', [req.body.probeId], db) : null;
      const pid =
        existing?.id ??
        (
          await one(`INSERT INTO diagnostic_probes(slug, kind, prompt, help, category_id, options, risk_level) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [
            `probe-${Date.now().toString(36)}`,
            kind,
            prompt,
            req.body?.help ?? null,
            fm.category_id,
            JSON.stringify(Object.keys(effects).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))),
            risk,
          ], db)
        )!.id;
      for (const [answer, lr] of Object.entries(effects)) {
        if (!(Number(lr) > 0)) throw badRequest('Likelihood ratios must be positive');
        await db.query(`INSERT INTO probe_effects VALUES ($1,$2,$3,$4) ON CONFLICT (probe_id, answer_value, failure_mode_id) DO UPDATE SET likelihood_ratio = EXCLUDED.likelihood_ratio`, [pid, answer, fm.id, Number(lr)]);
      }
      await audit(req, 'probe.linked', 'failure_mode', fm.id, { probeId: pid }, db);
      return pid;
    });
    res.status(201).json({ id });
  }),
);

knowledgeRouter.patch(
  '/failure-modes/:id',
  staffOnly,
  ah(async (req, res) => {
    const status = req.body?.verificationStatus;
    if (status && !['unverified', 'pending_review', 'verified', 'rejected'].includes(status)) throw badRequest('Invalid status');
    await query(
      `UPDATE failure_modes SET verification_status = coalesce($2, verification_status), is_public = coalesce($3, is_public), description = coalesce($4, description),
              base_prior = coalesce($5, base_prior) WHERE id = $1`,
      [req.params.id, status ?? null, typeof req.body?.isPublic === 'boolean' ? req.body.isPublic : null, req.body?.description ?? null, req.body?.basePrior ?? null],
    );
    await recomputeFailureModeStats(req.params.id);
    await audit(req, 'failure_mode.updated', 'failure_mode', req.params.id, req.body ?? {});
    res.json({ ok: true });
  }),
);

knowledgeRouter.post(
  '/component-types',
  staffOnly,
  ah(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2) throw badRequest('Name required');
    const risk = ['low', 'medium', 'high'].includes(req.body?.defaultRisk) ? req.body.defaultRisk : 'medium';
    const attrs = Array.isArray(req.body?.compatAttributes)
      ? [...new Set((req.body.compatAttributes as unknown[]).map((a) => String(a).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')).filter(Boolean))].slice(0, 20)
      : [];
    const slug = String(req.body?.slug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const ct = await one(`INSERT INTO component_types(slug, name, description, default_risk, compat_attributes) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [slug, name, req.body?.description ?? null, risk, attrs]);
    await audit(req, 'component_type.created', 'component_type', ct!.id, { slug, attrs });
    res.status(201).json({ id: ct!.id });
  }),
);

knowledgeRouter.post(
  '/procedures',
  staffOnly,
  ah(async (req, res) => {
    const i = parse(ProcedureInput, req.body);
    if (i.provenance === 'manufacturer_documentation' && !i.sourceIds.length) throw badRequest('Manufacturer-documentation procedures must cite their source document');
    const id = await tx(async (db) => {
      const pid = await createProcedure(i, { createdBy: req.user!.id, verification: 'verified', isPublic: true }, db);
      await audit(req, 'procedure.created', 'repair_procedure', pid, {}, db);
      return pid;
    });
    res.status(201).json({ id });
  }),
);

knowledgeRouter.get(
  '/sources',
  requireAuth,
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const rows = await query(
      `SELECT s.*, (SELECT count(*) FROM knowledge_citations c WHERE c.source_id = s.id)::int AS citation_count,
              (SELECT count(*) FROM documents d WHERE d.source_id = s.id)::int AS document_count, count(*) OVER()::int AS total
         FROM knowledge_sources s ORDER BY s.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json({ sources: rows, total: rows[0]?.total ?? 0 });
  }),
);

knowledgeRouter.post(
  '/sources',
  requireRole('technician', 'moderator', 'admin'),
  ah(async (req, res) => {
    const i = parse(SourceInput, req.body);
    if (i.kind === 'demo') throw badRequest('Demonstration sources cannot be created');
    if (i.fileId) await assertFileAccess(i.fileId, req.user);
    const staff = isStaff(req.user);
    const s = await one(
      `INSERT INTO knowledge_sources(kind, title, url, publisher, published_at, license, access_restrictions, reliability_tier, file_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [i.kind, i.title, i.url ?? null, i.publisher ?? null, i.publishedAt ?? null, i.license ?? null, i.accessRestrictions ?? null, SOURCE_RELIABILITY[i.kind], i.fileId ?? null, staff ? 'active' : 'pending_review', req.user!.id],
    );
    await audit(req, 'source.created', 'knowledge_source', s!.id, { kind: i.kind });
    res.status(201).json({ id: s!.id });
  }),
);

knowledgeRouter.patch(
  '/sources/:id',
  staffOnly,
  ah(async (req, res) => {
    const status = req.body?.status;
    if (!['active', 'retracted', 'pending_review'].includes(status)) throw badRequest('Invalid status');
    await query('UPDATE knowledge_sources SET status = $2 WHERE id = $1', [req.params.id, status]);
    await audit(req, `source.${status}`, 'knowledge_source', req.params.id);
    res.json({ ok: true });
  }),
);

knowledgeRouter.post(
  '/citations',
  staffOnly,
  ah(async (req, res) => {
    const i = parse(CitationInput, req.body);
    const c = await one(
      `INSERT INTO knowledge_citations(entity_type, entity_id, source_id, locator, excerpt, verification_status, confidence, created_by)
       VALUES ($1,$2,$3,$4,$5,'verified',(SELECT CASE reliability_tier WHEN 5 THEN 0.85 WHEN 4 THEN 0.72 WHEN 3 THEN 0.6 ELSE 0.45 END FROM knowledge_sources WHERE id = $3),$6)
       ON CONFLICT (entity_type, entity_id, source_id, locator) DO UPDATE SET excerpt = EXCLUDED.excerpt, version = knowledge_citations.version + 1 RETURNING id`,
      [i.entityType, i.entityId, i.sourceId, i.locator ?? null, i.excerpt ?? null, req.user!.id],
    );
    if (i.entityType === 'failure_mode') await recomputeFailureModeStats(i.entityId);
    await audit(req, 'citation.added', i.entityType, i.entityId, { sourceId: i.sourceId });
    res.status(201).json({ id: c!.id });
  }),
);

// ─── Ingestion ───
knowledgeRouter.post(
  '/documents',
  staffOnly,
  ah(async (req, res) => {
    const sourceId = String(req.body?.sourceId ?? '');
    const fileId = req.body?.fileId ? String(req.body.fileId) : null;
    const text = typeof req.body?.text === 'string' ? req.body.text : null;
    if (!isUuid(sourceId)) throw badRequest('sourceId required');
    if (!fileId && !text) throw badRequest('Provide a fileId (PDF/text) or text');
    if (fileId) await assertFileAccess(fileId, req.user);
    const src = await one('SELECT id, access_restrictions, license FROM knowledge_sources WHERE id = $1', [sourceId]);
    if (!src) throw notFound('Source');
    if (req.body?.confirmRights !== true) throw badRequest('Confirm that REPAIRVERSE may process this document under its licence and access restrictions (confirmRights: true)');
    const d = await one(`INSERT INTO documents(source_id, file_id, raw_text, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [sourceId, fileId, text ? text.slice(0, 2_000_000) : null, req.user!.id]);
    const job = await enqueue('ingest_document', { documentId: d!.id }, { idempotencyKey: `ingest:${d!.id}`, createdBy: req.user!.id });
    await audit(req, 'document.ingestion_queued', 'document', d!.id, { jobId: job.id });
    res.status(202).json({ documentId: d!.id, jobId: job.id });
  }),
);

knowledgeRouter.get(
  '/documents',
  staffOnly,
  ah(async (_req, res) => {
    res.json({
      documents: await query(
        `SELECT d.id, d.status, d.page_count, d.error, d.injection_flags, d.created_at, s.title AS source_title, s.kind AS source_kind,
                (SELECT count(*) FROM document_chunks c WHERE c.document_id = d.id)::int AS chunk_count,
                (SELECT count(*) FROM document_chunks c WHERE c.document_id = d.id AND c.approved)::int AS approved_chunks,
                (SELECT count(*) FROM extracted_items e WHERE e.document_id = d.id AND e.status = 'pending')::int AS pending_items
           FROM documents d JOIN knowledge_sources s ON s.id = d.source_id ORDER BY d.created_at DESC LIMIT 100`,
      ),
    });
  }),
);

knowledgeRouter.get(
  '/documents/:id',
  staffOnly,
  ah(async (req, res) => {
    const d = await one(`SELECT d.id, d.status, d.page_count, d.error, d.injection_flags, d.created_at, d.source_id, s.title AS source_title, s.kind AS source_kind, s.url, s.license FROM documents d JOIN knowledge_sources s ON s.id = d.source_id WHERE d.id = $1`, [req.params.id]);
    if (!d) throw notFound('Document');
    const chunks = await query('SELECT id, ordinal, page, section, content, approved, embedding IS NOT NULL AS embedded FROM document_chunks WHERE document_id = $1 ORDER BY ordinal', [d.id]);
    const items = await query('SELECT * FROM extracted_items WHERE document_id = $1 ORDER BY status, created_at', [d.id]);
    const job = await one(`SELECT id, status, attempts, progress, result, last_error FROM background_jobs WHERE idempotency_key = $1`, [`ingest:${d.id}`]);
    res.json({ document: d, chunks, items, job });
  }),
);

knowledgeRouter.post(
  '/documents/:id/approve',
  staffOnly,
  ah(async (req, res) => {
    const approved = req.body?.approved !== false;
    const r = await query(`UPDATE document_chunks SET approved = $2 WHERE document_id = $1 RETURNING id`, [req.params.id, approved]);
    await audit(req, approved ? 'document.approved_for_retrieval' : 'document.withdrawn_from_retrieval', 'document', req.params.id, { chunks: r.length });
    res.json({ chunks: r.length, approved });
  }),
);

/**
 * Review an extracted item against its source excerpt.
 * approve → applied to the graph with a citation (source + locator + verbatim excerpt).
 */
knowledgeRouter.post(
  '/extracted/:id/review',
  staffOnly,
  ah(async (req, res) => {
    const decision = String(req.body?.decision);
    if (!['approve', 'reject', 'request_evidence'].includes(decision)) throw badRequest('decision must be approve, reject or request_evidence');
    const out = await tx(async (db) => {
      const item = await one(`SELECT e.*, c.page, c.section, d.source_id FROM extracted_items e LEFT JOIN document_chunks c ON c.id = e.chunk_id JOIN documents d ON d.id = e.document_id WHERE e.id = $1 FOR UPDATE OF e`, [req.params.id], db);
      if (!item) throw notFound('Extracted item');
      if (item.status === 'approved' || item.status === 'rejected') throw badRequest('Already reviewed');
      const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_evidence';
      let applied: { type: string; id: string } | null = null;
      const payload = req.body?.payload ?? item.payload;
      if (decision === 'approve') {
        const locator = item.page ? `page ${item.page}` : item.section;
        const fields = Object.fromEntries((payload.fields ?? []).map((f: any) => [f.key, f.value]));
        if (item.item_type === 'product_spec') {
          const productId = req.body?.productId;
          if (!isUuid(productId)) throw badRequest('Select the product this specification belongs to');
          const key = fields.key ?? req.body?.key;
          const value = fields.value ?? req.body?.value;
          if (!key || !value) throw badRequest('Specification needs key and value');
          const s = await one(`INSERT INTO product_specs(product_id, key, value, verification_status) VALUES ($1,$2,$3,'verified') RETURNING id`, [productId, key, value], db);
          applied = { type: 'product_spec', id: s!.id };
        } else if (item.item_type === 'failure_mode') {
          const fm = parse(FailureModeInput, { ...req.body?.failureMode, sourceIds: [item.source_id] });
          applied = { type: 'failure_mode', id: await createFailureMode(fm, { createdBy: req.user!.id, verification: 'verified', isPublic: true }, db) };
        } else if (item.item_type === 'repair_procedure' && req.body?.procedure) {
          const pr = parse(ProcedureInput, { ...req.body.procedure, sourceIds: [item.source_id] });
          applied = { type: 'repair_procedure', id: await createProcedure(pr, { createdBy: req.user!.id, verification: 'verified', isPublic: true }, db) };
        }
        if (applied) {
          await db.query(
            `INSERT INTO knowledge_citations(entity_type, entity_id, source_id, locator, excerpt, verification_status, confidence, created_by) VALUES ($1,$2,$3,$4,$5,'verified',$6,$7) ON CONFLICT DO NOTHING`,
            [applied.type, applied.id, item.source_id, locator, payload.supporting_quote ?? null, item.confidence, req.user!.id],
          );
        }
      }
      await db.query(`UPDATE extracted_items SET status = $2, reviewer_id = $3, review_notes = $4, reviewed_at = now(), payload = $5, applied_entity_type = $6, applied_entity_id = $7 WHERE id = $1`, [
        item.id,
        status,
        req.user!.id,
        req.body?.notes ?? null,
        JSON.stringify(payload),
        applied?.type ?? null,
        applied?.id ?? null,
      ]);
      await audit(req, `extraction.${status}`, 'extracted_item', item.id, { applied }, db);
      return { status, applied };
    });
    res.json(out);
  }),
);

knowledgeRouter.get(
  '/graph/stats',
  ah(async (_req, res) => {
    const r = await one(`SELECT
      (SELECT count(*) FROM products WHERE is_public)::int AS products,
      (SELECT count(*) FROM product_components)::int AS components,
      (SELECT count(*) FROM failure_modes WHERE is_public)::int AS failure_modes,
      (SELECT count(*) FROM symptoms)::int AS symptoms,
      (SELECT count(*) FROM diagnostic_probes)::int AS diagnostic_probes,
      (SELECT count(*) FROM repair_procedures WHERE is_public)::int AS procedures,
      (SELECT count(*) FROM parts)::int AS parts,
      (SELECT count(*) FROM part_compatibility)::int AS compatibility_relations,
      (SELECT count(*) FROM knowledge_sources WHERE status = 'active')::int AS sources,
      (SELECT count(*) FROM repair_outcomes WHERE verification_status = 'verified')::int AS verified_outcomes`);
    res.json(r);
  }),
);
