import { Router } from 'express';
import { CompatibilityInput, PartInput, PartOfferInput } from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { isStaff, requireAuth, requireRole } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, isUuid, pageParams, parse } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { checkCompatibility, offersFor, partsForProduct, partsProviders, refreshOffersFromProviders } from './service.js';

export const partsRouter = Router();

partsRouter.get('/providers', (_req, res) => res.json({ providers: partsProviders() }));

partsRouter.get(
  '/',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const q = String(req.query.q ?? '').trim();
    const pn = String(req.query.partNumber ?? '').trim();
    const ct = isUuid(req.query.componentTypeId) ? req.query.componentTypeId : null;
    const productId = isUuid(req.query.productId) ? req.query.productId : null;
    const rows = await query(
      `SELECT pa.id, pa.name, pa.part_number, pa.classification, pa.attributes, pa.verification_status, pa.is_demo, ct.name AS component_type, ct.id AS component_type_id, m.name AS manufacturer,
              count(*) OVER()::int AS total
         FROM parts pa JOIN component_types ct ON ct.id = pa.component_type_id LEFT JOIN manufacturers m ON m.id = pa.manufacturer_id
        WHERE pa.verification_status <> 'rejected'
          AND ($3 = '' OR pa.name ILIKE '%' || $3 || '%' OR pa.part_number ILIKE '%' || $3 || '%' OR ct.name ILIKE '%' || $3 || '%' OR similarity(pa.name, $3) > 0.25)
          AND ($4 = '' OR lower(pa.part_number) = lower($4))
          AND ($5::uuid IS NULL OR pa.component_type_id = $5)
          AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.part_id = pa.id AND pc.product_id = $6))
        ORDER BY pa.name LIMIT $1 OFFSET $2`,
      [limit, offset, q, pn, ct, productId],
    );
    res.json({ parts: rows, total: rows[0]?.total ?? 0 });
  }),
);

partsRouter.get(
  '/:id',
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Part');
    const part = await one(
      `SELECT pa.*, ct.name AS component_type, ct.compat_attributes, m.name AS manufacturer FROM parts pa JOIN component_types ct ON ct.id = pa.component_type_id LEFT JOIN manufacturers m ON m.id = pa.manufacturer_id WHERE pa.id = $1`,
      [req.params.id],
    );
    if (!part) throw notFound('Part');
    const compatibility = await query(
      `SELECT pc.id, pc.state, pc.verification_status, pc.notes, p.id AS product_id, p.name AS product_name, p.slug AS product_slug, p.model_number, v.name AS variant_name,
              coalesce(json_agg(json_build_object('kind', e.kind, 'description', e.description, 'sourceTitle', s.title, 'sourceUrl', s.url)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
         FROM part_compatibility pc JOIN products p ON p.id = pc.product_id LEFT JOIN product_variants v ON v.id = pc.variant_id
         LEFT JOIN compatibility_evidence e ON e.compatibility_id = pc.id LEFT JOIN knowledge_sources s ON s.id = e.source_id
        WHERE pc.part_id = $1 AND (p.is_public OR $2) GROUP BY pc.id, p.id, v.name ORDER BY pc.state`,
      [req.params.id, isStaff(req.user)],
    );
    res.json({ part, compatibility, offers: await offersFor([req.params.id]) });
  }),
);

partsRouter.post(
  '/',
  requireRole('technician', 'moderator', 'admin'),
  ah(async (req, res) => {
    const i = parse(PartInput, req.body);
    const p = await one(
      `INSERT INTO parts(name, part_number, manufacturer_id, component_type_id, classification, attributes, description, verification_status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [i.name, i.partNumber ?? null, i.manufacturerId ?? null, i.componentTypeId, i.classification, JSON.stringify(i.attributes), i.description ?? null, isStaff(req.user) ? 'verified' : 'pending_review', req.user!.id],
    );
    await audit(req, 'part.created', 'part', p!.id);
    res.status(201).json({ id: p!.id });
  }),
);

partsRouter.get(
  '/compatibility/check',
  ah(async (req, res) => {
    const { partId, productId, variantId } = req.query;
    if (!isUuid(partId) || !isUuid(productId)) throw badRequest('partId and productId are required');
    const r = await checkCompatibility(partId, productId, isUuid(variantId) ? variantId : null);
    await track('compatibility_checked', req.user?.id, partId, { state: r.state, basis: r.basis });
    res.json(r);
  }),
);

partsRouter.get(
  '/for-product/:productId',
  ah(async (req, res) => {
    if (!isUuid(req.params.productId)) throw notFound('Product');
    const variantId = isUuid(req.query.variantId) ? req.query.variantId : null;
    const ct = isUuid(req.query.componentTypeId) ? req.query.componentTypeId : null;
    res.json(await partsForProduct(req.params.productId, variantId, ct));
  }),
);

/**
 * Record a compatibility relationship with evidence. Technician submissions are pending review;
 * moderator/admin submissions are verified. Every relationship requires at least one piece of evidence.
 */
partsRouter.post(
  '/compatibility',
  requireRole('technician', 'moderator', 'admin'),
  ah(async (req, res) => {
    const i = parse(CompatibilityInput, req.body);
    const staff = isStaff(req.user);
    const id = await tx(async (db) => {
      const existing = await one(`SELECT id FROM part_compatibility WHERE part_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3`, [i.partId, i.productId, i.variantId ?? null], db);
      let cid: string;
      if (existing) {
        cid = existing.id;
        if (staff) await db.query(`UPDATE part_compatibility SET state = $2, notes = coalesce($3, notes), verification_status = 'verified', updated_at = now() WHERE id = $1`, [cid, i.state, i.notes ?? null]);
      } else {
        cid = (
          await one(`INSERT INTO part_compatibility(part_id, product_id, variant_id, state, notes, verification_status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [
            i.partId,
            i.productId,
            i.variantId ?? null,
            i.state,
            i.notes ?? null,
            staff ? 'verified' : 'pending_review',
            req.user!.id,
          ], db)
        )!.id;
      }
      for (const e of i.evidence) await db.query(`INSERT INTO compatibility_evidence(compatibility_id, kind, description, source_id, contributor_id) VALUES ($1,$2,$3,$4,$5)`, [cid, e.kind, e.description, e.sourceId ?? null, req.user!.id]);
      if (!staff) {
        await db.query(`INSERT INTO contributions(contributor_id, type, title, target_entity_type, target_entity_id, payload, evidence) VALUES ($1,'compatibility',$2,'part_compatibility',$3,$4,$5)`, [
          req.user!.id,
          `Compatibility: part ${i.state} with product`,
          cid,
          JSON.stringify(i),
          JSON.stringify(i.evidence.map((e) => ({ kind: 'text', value: e.description }))),
        ]);
      }
      await audit(req, 'compatibility.recorded', 'part_compatibility', cid, { state: i.state, staff }, db);
      return cid;
    });
    res.status(201).json({ id, verificationStatus: staff ? 'verified' : 'pending_review' });
  }),
);

partsRouter.post(
  '/:id/offers',
  requireRole('technician', 'moderator', 'admin'),
  ah(async (req, res) => {
    const i = parse(PartOfferInput, { ...req.body, partId: req.params.id });
    if (i.priceCents == null && !i.url) throw badRequest('An offer needs a price or a link to its source');
    const o = await one(`INSERT INTO part_offers(part_id, provider, seller, url, price_cents, currency, availability, verified_by) VALUES ($1,'manual',$2,$3,$4,$5,$6,$7) RETURNING id`, [
      i.partId,
      i.seller,
      i.url ?? null,
      i.priceCents ?? null,
      i.currency,
      i.availability,
      req.user!.id,
    ]);
    await audit(req, 'part.offer_added', 'part', req.params.id, { offerId: o!.id });
    res.status(201).json({ id: o!.id });
  }),
);

partsRouter.post(
  '/:id/refresh-offers',
  requireAuth,
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Part');
    if (!req.user) throw forbidden();
    res.json(await refreshOffersFromProviders(req.params.id));
  }),
);
