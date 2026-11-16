/**
 * Developer API: self-serve API keys + the versioned public Repair Intelligence API (/api/public/v1).
 *
 * Keys are shown once, stored as SHA-256 hashes, scoped, rate limited per minute and
 * metered against a monthly quota. Every request is logged to api_usage.
 */
import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ApiClientInput, StartDiagnosisInput, AnswerProbeInput, type ApiScope } from '@repairverse/shared';
import { one, query } from '../../db/pool.js';
import { requireAuth, sha256 } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, isUuid, parse } from '../../lib/http.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { hit } from '../../lib/rateLimit.js';
import { productProfile, componentTree, failureKnowledgeFor, resolveProduct } from '../catalog/service.js';
import { answerProbe, getDiagnosisView, startDiagnosis } from '../diagnosis/service.js';
import { procedureView } from '../diagnosis/guide.js';
import { checkCompatibility } from '../parts/service.js';
import { openApiSpec } from './openapi.js';

// ─── Key management (signed-in users) ───
export const developerRouter = Router();
developerRouter.use(requireAuth);

developerRouter.get(
  '/clients',
  ah(async (req, res) => {
    res.json({
      clients: await query(
        `SELECT c.id, c.name, c.key_prefix, c.scopes, c.rate_limit_per_minute, c.monthly_quota, c.status, c.created_at, c.last_used_at,
                (SELECT count(*) FROM api_usage u WHERE u.client_id = c.id AND u.created_at >= date_trunc('month', now()))::int AS month_requests
           FROM api_clients c WHERE c.owner_user_id = $1 ORDER BY c.created_at DESC`,
        [req.user!.id],
      ),
    });
  }),
);

developerRouter.post(
  '/clients',
  ah(async (req, res) => {
    const i = parse(ApiClientInput, req.body);
    const active = await one(`SELECT count(*)::int AS n FROM api_clients WHERE owner_user_id = $1 AND status = 'active'`, [req.user!.id]);
    if (active!.n >= 5) throw badRequest('Maximum of 5 active API keys');
    // Write scopes for non-staff are limited to sane defaults; quotas above the default need admin approval.
    const quota = req.user!.role === 'admin' ? i.monthlyQuota : Math.min(i.monthlyQuota, 10000);
    const rate = req.user!.role === 'admin' ? i.rateLimitPerMinute : Math.min(i.rateLimitPerMinute, 60);
    const prefix = `rvk_${randomBytes(4).toString('hex')}`;
    const secret = randomBytes(24).toString('base64url');
    const key = `${prefix}_${secret}`;
    const c = await one(
      `INSERT INTO api_clients(owner_user_id, organization_id, name, key_prefix, key_hash, scopes, rate_limit_per_minute, monthly_quota) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user!.id, req.user!.memberships[0]?.organizationId ?? null, i.name, prefix, sha256(key), i.scopes, rate, quota],
    );
    await audit(req, 'api_client.created', 'api_client', c!.id, { scopes: i.scopes });
    res.status(201).json({ id: c!.id, apiKey: key, note: 'Store this key now — it will not be shown again.' });
  }),
);

developerRouter.post(
  '/clients/:id/revoke',
  ah(async (req, res) => {
    const r = await one(`UPDATE api_clients SET status = 'revoked' WHERE id = $1 AND owner_user_id = $2 RETURNING id`, [req.params.id, req.user!.id]);
    if (!r) throw notFound('API client');
    await audit(req, 'api_client.revoked', 'api_client', req.params.id);
    res.json({ ok: true });
  }),
);

developerRouter.get(
  '/clients/:id/usage',
  ah(async (req, res) => {
    const c = await one('SELECT id FROM api_clients WHERE id = $1 AND owner_user_id = $2', [req.params.id, req.user!.id]);
    if (!c) throw notFound('API client');
    res.json({
      daily: await query(
        `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS requests, count(*) FILTER (WHERE status >= 400)::int AS errors, avg(latency_ms)::int AS avg_latency_ms
           FROM api_usage WHERE client_id = $1 AND created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`,
        [c.id],
      ),
    });
  }),
);

// ─── Public API ───
export const publicApiRouter = Router();

async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.get('x-api-key') ?? (req.get('authorization')?.startsWith('Bearer rvk_') ? req.get('authorization')!.slice(7) : null);
    if (!raw) throw unauthorized('Missing API key (X-API-Key header)');
    const prefix = raw.split('_').slice(0, 2).join('_');
    const c = await one('SELECT * FROM api_clients WHERE key_prefix = $1', [prefix]);
    if (!c || c.key_hash !== sha256(raw) || c.status !== 'active') throw unauthorized('Invalid or revoked API key');
    const rl = await hit(`api:${c.id}`, c.rate_limit_per_minute, 60);
    res.setHeader('X-RateLimit-Limit', String(c.rate_limit_per_minute));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.resetSec));
      throw new AppError(429, 'rate_limited', 'Rate limit exceeded');
    }
    const used = await one(`SELECT count(*)::int AS n FROM api_usage WHERE client_id = $1 AND created_at >= date_trunc('month', now())`, [c.id]);
    if (used!.n >= c.monthly_quota) throw new AppError(429, 'quota_exceeded', 'Monthly quota exceeded');
    req.apiClient = { id: c.id, name: c.name, ownerUserId: c.owner_user_id, scopes: c.scopes };
    const started = Date.now();
    res.on('finish', () => {
      void query('INSERT INTO api_usage(client_id, method, path, status, latency_ms) VALUES ($1,$2,$3,$4,$5)', [c.id, req.method, req.route?.path ?? req.path, res.statusCode, Date.now() - started]);
      void query('UPDATE api_clients SET last_used_at = now() WHERE id = $1', [c.id]);
    });
    next();
  } catch (e) {
    next(e);
  }
}

const scope = (s: ApiScope) => (req: Request, _res: Response, next: NextFunction) => (req.apiClient?.scopes.includes(s) ? next() : next(forbidden(`API key lacks scope ${s}`)));

publicApiRouter.get('/openapi.json', (_req, res) => res.json(openApiSpec));
publicApiRouter.use(apiKeyAuth);

/** Only public knowledge is exposed through the API. */
async function publicProduct(idOrSlug: string) {
  const p = await resolveProduct(idOrSlug);
  if (!p.is_public) throw notFound('Product');
  return p;
}

publicApiRouter.post(
  '/identify',
  scope('identify:write'),
  ah(async (req, res) => {
    const barcode = typeof req.body?.barcode === 'string' ? req.body.barcode.trim() : '';
    const model = typeof req.body?.modelNumber === 'string' ? req.body.modelNumber.trim() : '';
    if (!barcode && !model) throw badRequest('barcode or modelNumber required');
    const rows = await query(
      `SELECT DISTINCT p.id, p.slug, p.name, p.model_number, pi.kind AS matched_identifier, p.is_demo FROM product_identifiers pi JOIN products p ON p.id = pi.product_id
        WHERE p.is_public AND ((pi.kind IN ('gtin','upc','ean') AND pi.value = $1) OR (pi.kind IN ('model_number','mpn') AND lower(pi.value) = lower($2)))`,
      [barcode, model],
    );
    res.json({ candidates: rows.map((r) => ({ ...r, confidence: r.matched_identifier === 'model_number' || r.matched_identifier === 'mpn' ? 0.9 : 0.97 })), note: 'Exact identifier matches only. Image identification is available in the REPAIRVERSE app.' });
  }),
);

publicApiRouter.get(
  '/products',
  scope('products:read'),
  ah(async (req, res) => {
    const q = String(req.query.q ?? '');
    res.json({
      products: await query(
        `SELECT p.id, p.slug, p.name, p.model_number, p.release_year, p.is_demo, c.slug AS category FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.is_public AND ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.model_number ILIKE '%' || $1 || '%') ORDER BY p.name LIMIT 50`,
        [q],
      ),
    });
  }),
);

publicApiRouter.get(
  '/products/:idOrSlug',
  scope('products:read'),
  ah(async (req, res) => {
    await publicProduct(req.params.idOrSlug);
    const profile = await productProfile(req.params.idOrSlug);
    const { saved: _saved, ...rest } = profile;
    res.json(rest);
  }),
);

publicApiRouter.get(
  '/products/:idOrSlug/components',
  scope('products:read'),
  ah(async (req, res) => {
    const p = await publicProduct(req.params.idOrSlug);
    res.json(await componentTree(p.id, isUuid(req.query.variantId) ? req.query.variantId : null));
  }),
);

publicApiRouter.get(
  '/products/:idOrSlug/failures',
  scope('knowledge:read'),
  ah(async (req, res) => {
    const p = await publicProduct(req.params.idOrSlug);
    res.json({ failureModes: await failureKnowledgeFor(p.id, p.category_id) });
  }),
);

publicApiRouter.get(
  '/procedures/:id',
  scope('knowledge:read'),
  ah(async (req, res) => {
    const v = await procedureView(req.params.id, undefined); // API callers are treated as the public: high-risk steps withheld.
    res.json(v);
  }),
);

publicApiRouter.get(
  '/knowledge/verified',
  scope('knowledge:read'),
  ah(async (req, res) => {
    const since = typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since)) ? req.query.since : '1970-01-01';
    res.json({
      failureModes: await query(
        `SELECT fm.id, fm.slug, fm.name, fm.description, fm.risk_level, fm.confidence, fm.verified_case_count, ct.slug AS component_type, c.slug AS category, p.slug AS product
           FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id LEFT JOIN categories c ON c.id = fm.category_id LEFT JOIN products p ON p.id = fm.product_id
          WHERE fm.is_public AND fm.verification_status = 'verified' AND fm.created_at >= $1 ORDER BY fm.created_at DESC LIMIT 200`,
        [since],
      ),
      procedures: await query(
        `SELECT id, slug, title, difficulty, risk_level, provenance, failure_mode_id FROM repair_procedures WHERE is_public AND verification_status = 'verified' AND created_at >= $1 ORDER BY created_at DESC LIMIT 200`,
        [since],
      ),
    });
  }),
);

publicApiRouter.get(
  '/compatibility',
  scope('compatibility:read'),
  ah(async (req, res) => {
    const { partId, productId, variantId } = req.query;
    if (!isUuid(partId) || !isUuid(productId)) throw badRequest('partId and productId required');
    await publicProduct(productId);
    res.json(await checkCompatibility(partId, productId, isUuid(variantId) ? variantId : null));
  }),
);

publicApiRouter.post(
  '/diagnoses',
  scope('diagnosis:write'),
  ah(async (req, res) => {
    const i = parse(StartDiagnosisInput, { ...req.body, fileIds: [] });
    res.status(201).json(await startDiagnosis(i, { apiClientId: req.apiClient!.id }));
  }),
);

publicApiRouter.get('/diagnoses/:id', scope('diagnosis:write'), ah(async (req, res) => res.json(await getDiagnosisView(req.params.id, undefined, req.apiClient!.id))));

publicApiRouter.post(
  '/diagnoses/:id/answers',
  scope('diagnosis:write'),
  ah(async (req, res) => res.json(await answerProbe(req.params.id, parse(AnswerProbeInput, req.body), undefined, req.apiClient!.id))),
);

/** External repair systems can submit outcomes; they enter moderation like any other contribution. */
publicApiRouter.post(
  '/outcomes',
  scope('outcomes:write'),
  ah(async (req, res) => {
    const b = req.body ?? {};
    if (typeof b.succeeded !== 'boolean') throw badRequest('succeeded (boolean) is required');
    if (b.productId && !isUuid(b.productId)) throw badRequest('Invalid productId');
    if (b.actualFailureModeId && !isUuid(b.actualFailureModeId)) throw badRequest('Invalid actualFailureModeId');
    const symptomIds = Array.isArray(b.symptomIds) ? b.symptomIds.filter(isUuid).slice(0, 20) : [];
    const o = await one(
      `INSERT INTO repair_outcomes(product_id, reporter_id, symptom_ids, original_symptoms, actual_failure_mode_id, actual_failure_text, cost_cents, duration_minutes, succeeded, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review') RETURNING id`,
      [b.productId ?? null, req.apiClient!.ownerUserId, symptomIds, String(b.symptoms ?? '').slice(0, 4000) || null, b.actualFailureModeId ?? null, String(b.actualFailureText ?? '').slice(0, 2000) || null, Number.isInteger(b.costCents) ? b.costCents : null, Number.isInteger(b.durationMinutes) ? b.durationMinutes : null, b.succeeded],
    );
    const c = await one(
      `INSERT INTO contributions(contributor_id, type, title, target_entity_type, target_entity_id, payload, repair_outcome_id) VALUES ($1,'repair_outcome',$2,'failure_mode',$3,$4,$5) RETURNING id`,
      [req.apiClient!.ownerUserId, `API outcome via ${req.apiClient!.name}`, b.actualFailureModeId ?? null, JSON.stringify({ ...b, symptomIds, source: 'api' }), o!.id],
    );
    await track('api_outcome_submitted', req.apiClient!.ownerUserId, o!.id, { client: req.apiClient!.id });
    res.status(202).json({ outcomeId: o!.id, contributionId: c!.id, status: 'pending_review' });
  }),
);
