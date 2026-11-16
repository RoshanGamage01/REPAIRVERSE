import { Router } from 'express';
import { ProductComponentInput, ProductInput, ProductSpecInput } from '@repairverse/shared';
import { one, query, tx } from '../../db/pool.js';
import { isStaff, requireAuth, requireRole } from '../../lib/auth.js';
import { audit, track } from '../../lib/audit.js';
import { ah, isUuid, pageParams, parse, uniqueSlug } from '../../lib/http.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { componentProfile, productProfile, resolveProduct } from './service.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/categories',
  ah(async (_req, res) => {
    const rows = await query(
      `SELECT c.id, c.slug, c.name, c.description, c.icon, c.parent_id, c.default_risk,
              (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.is_public)::int AS product_count
         FROM categories c ORDER BY c.parent_id NULLS FIRST, c.position, c.name`,
    );
    res.json({ categories: rows });
  }),
);

catalogRouter.get(
  '/component-types',
  ah(async (_req, res) => res.json({ componentTypes: await query('SELECT id, slug, name, description, default_risk, compat_attributes FROM component_types ORDER BY name') })),
);

catalogRouter.get(
  '/tools',
  ah(async (_req, res) => res.json({ tools: await query('SELECT id, slug, name, description FROM tools ORDER BY name') })),
);

catalogRouter.get(
  '/brands',
  ah(async (_req, res) => res.json({ brands: await query('SELECT b.id, b.name, b.slug, b.is_demo, m.name AS manufacturer FROM brands b LEFT JOIN manufacturers m ON m.id = b.manufacturer_id ORDER BY b.name') })),
);

catalogRouter.get(
  '/manufacturers',
  ah(async (_req, res) => res.json({ manufacturers: await query('SELECT id, name, slug, country, website, is_demo FROM manufacturers ORDER BY name') })),
);

catalogRouter.get(
  '/symptoms',
  ah(async (req, res) => {
    const categoryId = isUuid(req.query.categoryId) ? req.query.categoryId : null;
    const rows = categoryId
      ? await query(
          `WITH RECURSIVE up AS (SELECT id, parent_id FROM categories WHERE id = $1 UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id)
           SELECT s.id, s.slug, s.name, s.category_id FROM symptoms s WHERE s.category_id IS NULL OR s.category_id IN (SELECT id FROM up) ORDER BY s.name`,
          [categoryId],
        )
      : await query('SELECT id, slug, name, category_id FROM symptoms ORDER BY name');
    res.json({ symptoms: rows });
  }),
);

catalogRouter.get(
  '/products',
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const q = String(req.query.q ?? '').trim();
    const categoryId = isUuid(req.query.categoryId) ? req.query.categoryId : null;
    const includePrivate = isStaff(req.user) && req.query.all === 'true';
    const params: unknown[] = [limit, offset];
    const where: string[] = [];
    if (!includePrivate) {
      if (req.user) {
        params.push(req.user.id);
        where.push(`(p.is_public OR p.created_by = $${params.length})`);
      } else where.push('p.is_public');
    }
    if (categoryId) {
      params.push(categoryId);
      where.push(`(p.category_id = $${params.length} OR c.parent_id = $${params.length})`);
    }
    let order = 'p.name';
    if (q) {
      params.push(q);
      const i = params.length;
      where.push(`(p.search @@ plainto_tsquery('simple', $${i}) OR p.name ILIKE '%' || $${i} || '%' OR p.model_number ILIKE '%' || $${i} || '%' OR similarity(p.name || ' ' || coalesce(p.model_number,''), $${i}) > 0.2
                   OR EXISTS (SELECT 1 FROM product_identifiers pi WHERE pi.product_id = p.id AND lower(pi.value) = lower($${i})))`);
      order = `similarity(p.name || ' ' || coalesce(p.model_number,''), $${i}) DESC`;
    }
    const rows = await query(
      `SELECT p.id, p.slug, p.name, p.model_number, p.release_year, p.is_public, p.is_demo, p.verification_status, p.image_file_id,
              c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, count(*) OVER()::int AS total
         FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT $1 OFFSET $2`,
      params,
    );
    res.json({ products: rows, total: rows[0]?.total ?? 0 });
  }),
);

catalogRouter.get(
  '/products/:idOrSlug',
  ah(async (req, res) => {
    res.json(await productProfile(req.params.idOrSlug, req.user));
  }),
);

catalogRouter.get(
  '/components/:id',
  ah(async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Component');
    res.json(await componentProfile(req.params.id, req.user));
  }),
);

/**
 * Register a product. Staff create published records directly; others create a private draft
 * that becomes public only after moderation (via a "new_product" contribution).
 */
catalogRouter.post(
  '/products',
  requireAuth,
  ah(async (req, res) => {
    const i = parse(ProductInput, req.body);
    const staff = isStaff(req.user);
    const id = await tx(async (db) => {
      const p = await one(
        `INSERT INTO products(slug, category_id, brand_id, name, model_number, release_year, description, is_public, verification_status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [uniqueSlug(`${i.name} ${i.modelNumber ?? ''}`), i.categoryId, i.brandId ?? null, i.name, i.modelNumber ?? null, i.releaseYear ?? null, i.description ?? null, staff && i.isPublic, staff ? 'verified' : 'pending_review', req.user!.id],
        db,
      );
      for (const ident of i.identifiers) {
        await db.query(`INSERT INTO product_identifiers(product_id, kind, value) VALUES ($1,$2,$3) ON CONFLICT (kind, value) DO NOTHING`, [p!.id, ident.kind, ident.value]);
      }
      if (i.modelNumber) await db.query(`INSERT INTO product_identifiers(product_id, kind, value) VALUES ($1,'model_number',$2) ON CONFLICT (kind, value) DO NOTHING`, [p!.id, i.modelNumber]);
      if (!staff) {
        await db.query(`INSERT INTO contributions(contributor_id, type, title, target_entity_type, target_entity_id, payload) VALUES ($1,'new_product',$2,'product',$3,$4)`, [
          req.user!.id,
          `New product: ${i.name}`,
          p!.id,
          JSON.stringify(i),
        ]);
      }
      await audit(req, 'product.created', 'product', p!.id, { staff }, db);
      return p!.id as string;
    });
    res.status(201).json({ id, status: staff ? 'published_or_draft' : 'pending_review' });
  }),
);

async function assertCanEditProduct(productId: string, user: Express.Request['user']) {
  const p = await one('SELECT created_by, is_public FROM products WHERE id = $1', [productId]);
  if (!p) throw notFound('Product');
  if (isStaff(user)) return p;
  if (p.created_by === user?.id && !p.is_public) return p;
  throw forbidden('Only moderators can edit published products. Submit a correction instead.');
}

catalogRouter.post(
  '/products/:id/specs',
  requireAuth,
  ah(async (req, res) => {
    await assertCanEditProduct(req.params.id, req.user);
    const i = parse(ProductSpecInput, req.body);
    // A specification must either cite a source or be explicitly marked as an estimate.
    if (!i.sourceId && !i.isEstimate) throw badRequest('Specifications must cite a knowledge source or be marked as an estimate');
    const s = await one(`INSERT INTO product_specs(product_id, key, value, unit, is_estimate, verification_status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [
      req.params.id,
      i.key,
      i.value,
      i.unit ?? null,
      i.isEstimate,
      isStaff(req.user) && i.sourceId ? 'verified' : 'unverified',
    ]);
    if (i.sourceId) await query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, created_by) VALUES ('product_spec',$1,$2,$3)`, [s!.id, i.sourceId, req.user!.id]);
    await audit(req, 'product.spec_added', 'product', req.params.id, { key: i.key });
    res.status(201).json({ id: s!.id });
  }),
);

catalogRouter.post(
  '/products/:id/variants',
  requireAuth,
  ah(async (req, res) => {
    await assertCanEditProduct(req.params.id, req.user);
    const name = String(req.body?.name ?? '').trim();
    if (!name) throw badRequest('Variant name required');
    const v = await one(`INSERT INTO product_variants(product_id, name, variant_code, hardware_revision, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [
      req.params.id,
      name.slice(0, 200),
      req.body.variantCode ?? null,
      req.body.hardwareRevision ?? null,
      req.body.notes ?? null,
    ]);
    res.status(201).json({ id: v!.id });
  }),
);

catalogRouter.post(
  '/products/:id/components',
  requireAuth,
  ah(async (req, res) => {
    await assertCanEditProduct(req.params.id, req.user);
    const i = parse(ProductComponentInput, req.body);
    if (i.parentId) {
      const parent = await one('SELECT 1 FROM product_components WHERE id = $1 AND product_id = $2', [i.parentId, req.params.id]);
      if (!parent) throw badRequest('Parent component does not belong to this product');
    }
    const c = await one(
      `INSERT INTO product_components(product_id, component_type_id, parent_id, name, notes, attributes, position, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT coalesce(max(position),0)+1 FROM product_components WHERE product_id = $1),$7) RETURNING id`,
      [req.params.id, i.componentTypeId, i.parentId ?? null, i.name, i.notes ?? null, JSON.stringify(i.attributes), isStaff(req.user) && i.sourceId ? 'verified' : 'unverified'],
    );
    if (i.sourceId) await query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, created_by) VALUES ('product_component',$1,$2,$3)`, [c!.id, i.sourceId, req.user!.id]);
    await audit(req, 'product.component_added', 'product', req.params.id, { componentId: c!.id });
    res.status(201).json({ id: c!.id });
  }),
);

catalogRouter.post(
  '/products/:id/components/from-template',
  requireAuth,
  ah(async (req, res) => {
    await assertCanEditProduct(req.params.id, req.user);
    const p = await resolveProduct(req.params.id);
    const existing = await one('SELECT count(*)::int AS n FROM product_components WHERE product_id = $1', [p.id]);
    if (existing!.n > 0) throw badRequest('Product already has components');
    const r = await query(
      `INSERT INTO product_components(product_id, component_type_id, name, position, verification_status)
       SELECT $1, t.component_type_id, ct.name, t.position, 'unverified' FROM category_component_templates t JOIN component_types ct ON ct.id = t.component_type_id
        WHERE t.category_id = $2 RETURNING id`,
      [p.id, p.category_id],
    );
    res.status(201).json({ created: r.length });
  }),
);

catalogRouter.post(
  '/products/:id/publish',
  requireRole('admin', 'moderator'),
  ah(async (req, res) => {
    const r = await one(`UPDATE products SET is_public = $2, verification_status = CASE WHEN verification_status = 'demo' THEN 'demo' ELSE 'verified' END, updated_at = now() WHERE id = $1 RETURNING id`, [
      req.params.id,
      req.body?.isPublic !== false,
    ]);
    if (!r) throw notFound('Product');
    await audit(req, req.body?.isPublic === false ? 'product.unpublished' : 'product.published', 'product', req.params.id);
    res.json({ ok: true });
  }),
);

catalogRouter.post(
  '/saved',
  requireAuth,
  ah(async (req, res) => {
    const type = String(req.body?.entityType);
    const id = String(req.body?.entityId);
    if (!['product', 'failure_mode', 'repair_procedure', 'part'].includes(type) || !isUuid(id)) throw badRequest('Invalid saved item');
    if (req.body?.saved === false) await query('DELETE FROM saved_knowledge WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3', [req.user!.id, type, id]);
    else await query('INSERT INTO saved_knowledge VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.user!.id, type, id]);
    await track('knowledge_saved', req.user!.id, id, { type, saved: req.body?.saved !== false });
    res.json({ ok: true });
  }),
);

catalogRouter.get(
  '/saved',
  requireAuth,
  ah(async (req, res) => {
    const rows = await query(
      `SELECT sk.entity_type, sk.entity_id, sk.created_at,
              coalesce(p.name || coalesce(' ' || p.model_number, ''), fm.name, rp.title, pa.name) AS title,
              coalesce(p.slug, rp.slug, fm.slug) AS slug
         FROM saved_knowledge sk
         LEFT JOIN products p ON sk.entity_type = 'product' AND p.id = sk.entity_id
         LEFT JOIN failure_modes fm ON sk.entity_type = 'failure_mode' AND fm.id = sk.entity_id
         LEFT JOIN repair_procedures rp ON sk.entity_type = 'repair_procedure' AND rp.id = sk.entity_id
         LEFT JOIN parts pa ON sk.entity_type = 'part' AND pa.id = sk.entity_id
        WHERE sk.user_id = $1 ORDER BY sk.created_at DESC`,
      [req.user!.id],
    );
    res.json({ saved: rows });
  }),
);
