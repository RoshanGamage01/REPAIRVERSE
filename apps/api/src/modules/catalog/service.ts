import { one, query } from '../../db/pool.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { isStaff } from '../../lib/auth.js';
import { isUuid } from '../../lib/http.js';
import { MIN_SAMPLE_FOR_STATISTICS, wilsonInterval } from '../../engines/confidence.js';
import { categoryLineage } from '../diagnosis/service.js';
import type { AuthUser } from '../../types.js';

export async function resolveProduct(idOrSlug: string) {
  const p = await one(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, m.name AS manufacturer_name, m.id AS manufacturer_id
       FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN manufacturers m ON m.id = b.manufacturer_id
      WHERE ${isUuid(idOrSlug) ? 'p.id = $1' : 'p.slug = $1'}`,
    [idOrSlug],
  );
  if (!p) throw notFound('Product');
  return p;
}

export function canViewProduct(p: any, user?: AuthUser) {
  return p.is_public || isStaff(user) || (user && p.created_by === user.id);
}

export async function componentTree(productId: string, variantId?: string | null) {
  const rows = await query(
    `SELECT pc.id, pc.parent_id, pc.name, pc.notes, pc.attributes, pc.variant_id, pc.position, pc.verification_status,
            ct.id AS component_type_id, ct.slug AS component_slug, ct.name AS component_type, ct.default_risk, v.name AS variant_name
       FROM product_components pc JOIN component_types ct ON ct.id = pc.component_type_id LEFT JOIN product_variants v ON v.id = pc.variant_id
      WHERE pc.product_id = $1 AND ($2::uuid IS NULL OR pc.variant_id IS NULL OR pc.variant_id = $2)
      ORDER BY pc.position`,
    [productId, variantId ?? null],
  );
  const byParent = new Map<string | null, any[]>();
  for (const r of rows) {
    const k = r.parent_id ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(r);
  }
  const build = (parent: string | null): any[] => (byParent.get(parent) ?? []).map((r) => ({ ...r, children: build(r.id) }));
  const relationships = rows.length
    ? await query(
        `SELECT cr.id, cr.relation, cr.from_component_id, cr.to_component_id, a.name AS from_name, b.name AS to_name
           FROM component_relationships cr JOIN product_components a ON a.id = cr.from_component_id JOIN product_components b ON b.id = cr.to_component_id
          WHERE a.product_id = $1`,
        [productId],
      )
    : [];
  return { tree: build(null), relationships, count: rows.length };
}

/** Category template for products without a recorded breakdown — clearly labelled as typical, not model-specific. */
export async function categoryTemplate(categoryId: string) {
  const cats = await categoryLineage(categoryId);
  return query(
    `SELECT DISTINCT ON (ct.id) ct.id, ct.slug, ct.name, ct.default_risk, t.position FROM category_component_templates t JOIN component_types ct ON ct.id = t.component_type_id
      WHERE t.category_id = ANY($1) ORDER BY ct.id, t.position`,
    [cats],
  ).then((r) => r.sort((a, b) => a.position - b.position));
}

export async function failureKnowledgeFor(productId: string, categoryId: string) {
  const cats = await categoryLineage(categoryId);
  const fms = await query(
    `SELECT fm.id, fm.slug, fm.name, fm.description, fm.risk_level, fm.verification_status, fm.is_demo, fm.confidence, fm.verified_case_count, fm.verified_success_count,
            fm.independent_reporter_count, fm.product_id IS NOT NULL AS model_specific, ct.name AS component_name, ct.id AS component_type_id,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'likelihood', fs.likelihood) ORDER BY fs.likelihood DESC)
                        FROM failure_mode_symptoms fs JOIN symptoms s ON s.id = fs.symptom_id WHERE fs.failure_mode_id = fm.id), '[]') AS symptoms
       FROM failure_modes fm JOIN component_types ct ON ct.id = fm.component_type_id
      WHERE fm.verification_status <> 'rejected' AND fm.is_public
        AND ((fm.product_id = $1) OR (fm.product_id IS NULL AND fm.category_id = ANY($2)))
      ORDER BY fm.product_id IS NOT NULL DESC, fm.prior_weight DESC`,
    [productId, cats],
  );
  return fms.map((f) => ({
    ...f,
    // Frequency/success statistics only when supported by sufficient verified data.
    statistics: wilsonInterval(f.verified_success_count, f.verified_case_count)
      ? { repairSuccess: wilsonInterval(f.verified_success_count, f.verified_case_count), verifiedCases: f.verified_case_count }
      : { insufficientData: true, verifiedCases: f.verified_case_count, minimumSample: MIN_SAMPLE_FOR_STATISTICS },
  }));
}

export async function sourcesFor(entities: { type: string; id: string }[]) {
  if (!entities.length) return [];
  return query(
    `SELECT DISTINCT ON (s.id) s.id, s.kind, s.title, s.url, s.publisher, s.published_at, s.reliability_tier, s.license, c.locator, c.verification_status
       FROM knowledge_citations c JOIN knowledge_sources s ON s.id = c.source_id
      WHERE s.status = 'active' AND (c.entity_type, c.entity_id) IN (SELECT * FROM unnest($1::text[], $2::uuid[]))`,
    [entities.map((e) => e.type), entities.map((e) => e.id)],
  );
}

export async function productProfile(idOrSlug: string, user?: AuthUser) {
  const p = await resolveProduct(idOrSlug);
  if (!canViewProduct(p, user)) throw forbidden('This product profile is not public');
  const [variants, identifiers, specs, components, failures, procedures, outcomes, template] = await Promise.all([
    query('SELECT id, name, variant_code, hardware_revision, notes FROM product_variants WHERE product_id = $1 ORDER BY name', [p.id]),
    query(`SELECT kind, value, variant_id FROM product_identifiers WHERE product_id = $1 AND kind IN ('gtin','upc','ean','model_number','mpn')`, [p.id]),
    query(
      `SELECT s.id, s.key, s.value, s.unit, s.is_estimate, s.verification_status, s.variant_id,
              coalesce((SELECT json_agg(json_build_object('id', ks.id, 'title', ks.title, 'url', ks.url, 'locator', c.locator, 'kind', ks.kind))
                          FROM knowledge_citations c JOIN knowledge_sources ks ON ks.id = c.source_id WHERE c.entity_type = 'product_spec' AND c.entity_id = s.id), '[]') AS sources
         FROM product_specs s WHERE s.product_id = $1 AND s.verification_status <> 'rejected' ORDER BY s.key`,
      [p.id],
    ),
    componentTree(p.id),
    failureKnowledgeFor(p.id, p.category_id),
    query(
      `SELECT rp.id, rp.slug, rp.title, rp.difficulty, rp.risk_level, rp.provenance, rp.verification_status, rp.is_demo, rp.failure_mode_id, fm.name AS failure_mode_name
         FROM repair_procedures rp JOIN failure_modes fm ON fm.id = rp.failure_mode_id
        WHERE rp.is_public AND rp.verification_status <> 'rejected' AND (rp.product_id = $1 OR (rp.product_id IS NULL AND fm.category_id = ANY($2)))
        ORDER BY rp.difficulty`,
      [p.id, await categoryLineage(p.category_id)],
    ),
    // Aggregate, anonymous repair statistics from verified outcomes only. No personal data.
    one(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE succeeded)::int AS succeeded
         FROM repair_outcomes WHERE product_id = $1 AND verification_status = 'verified'`,
      [p.id],
    ),
    categoryTemplate(p.category_id),
  ]);
  const sources = await sourcesFor([{ type: 'product', id: p.id }, ...failures.map((f) => ({ type: 'failure_mode', id: f.id }))]);
  const compatibleParts = await query(
    `SELECT pc.state, pc.verification_status, pa.id, pa.name, pa.part_number, pa.classification, ct.name AS component_type, pc.variant_id
       FROM part_compatibility pc JOIN parts pa ON pa.id = pc.part_id JOIN component_types ct ON ct.id = pa.component_type_id
      WHERE pc.product_id = $1 AND pc.verification_status <> 'rejected' ORDER BY ct.name, pc.state`,
    [p.id],
  );
  const saved = user ? !!(await one(`SELECT 1 FROM saved_knowledge WHERE user_id = $1 AND entity_type = 'product' AND entity_id = $2`, [user.id, p.id])) : false;
  const imageUrl = p.image_file_id ? `/api/v1/files/${p.image_file_id}/public` : null;
  const repairStatistics = wilsonInterval(outcomes!.succeeded, outcomes!.total)
    ? { verifiedRepairs: outcomes!.total, success: wilsonInterval(outcomes!.succeeded, outcomes!.total) }
    : { verifiedRepairs: outcomes!.total, insufficientData: true, minimumSample: MIN_SAMPLE_FOR_STATISTICS };
  return {
    product: {
      id: p.id,
      slug: p.slug,
      name: p.name,
      modelNumber: p.model_number,
      releaseYear: p.release_year,
      description: p.description,
      category: { id: p.category_id, name: p.category_name, slug: p.category_slug },
      brand: p.brand_name,
      manufacturer: p.manufacturer_name,
      isPublic: p.is_public,
      isDemo: p.is_demo,
      verificationStatus: p.verification_status,
      imageUrl,
    },
    variants,
    identifiers,
    specifications: specs,
    components,
    typicalComponents: components.count ? [] : template,
    failureModes: failures,
    procedures,
    repairStatistics,
    compatibleParts,
    sources,
    saved,
  };
}

export async function componentProfile(componentId: string, user?: AuthUser) {
  const c = await one(
    `SELECT pc.*, ct.slug AS component_slug, ct.name AS component_type, ct.description AS type_description, ct.default_risk, ct.compat_attributes,
            p.id AS product_id, p.name AS product_name, p.slug AS product_slug, p.category_id, p.is_public, p.created_by, v.name AS variant_name, par.name AS parent_name
       FROM product_components pc JOIN component_types ct ON ct.id = pc.component_type_id JOIN products p ON p.id = pc.product_id
       LEFT JOIN product_variants v ON v.id = pc.variant_id LEFT JOIN product_components par ON par.id = pc.parent_id
      WHERE pc.id = $1`,
    [componentId],
  );
  if (!c) throw notFound('Component');
  if (!canViewProduct(c, user)) throw forbidden();
  const cats = await categoryLineage(c.category_id);
  const [children, relationships, failureModes, parts, sources] = await Promise.all([
    query('SELECT pc.id, pc.name, ct.name AS component_type FROM product_components pc JOIN component_types ct ON ct.id = pc.component_type_id WHERE pc.parent_id = $1 ORDER BY position', [componentId]),
    query(
      `SELECT cr.relation, cr.from_component_id, cr.to_component_id, a.name AS from_name, b.name AS to_name FROM component_relationships cr
         JOIN product_components a ON a.id = cr.from_component_id JOIN product_components b ON b.id = cr.to_component_id
        WHERE cr.from_component_id = $1 OR cr.to_component_id = $1`,
      [componentId],
    ),
    query(
      `SELECT fm.id, fm.name, fm.description, fm.risk_level, fm.verification_status, fm.is_demo FROM failure_modes fm
        WHERE fm.component_type_id = $1 AND fm.verification_status <> 'rejected' AND (fm.product_id = $2 OR (fm.product_id IS NULL AND fm.category_id = ANY($3)))`,
      [c.component_type_id, c.product_id, cats],
    ),
    query(
      `SELECT pa.id, pa.name, pa.part_number, pa.classification, pc.state, pc.verification_status FROM parts pa
         LEFT JOIN part_compatibility pc ON pc.part_id = pa.id AND pc.product_id = $2 AND (pc.variant_id IS NULL OR pc.variant_id IS NOT DISTINCT FROM $3)
        WHERE pa.component_type_id = $1 ORDER BY pc.state NULLS LAST, pa.name LIMIT 30`,
      [c.component_type_id, c.product_id, c.variant_id],
    ),
    sourcesFor([{ type: 'product_component', id: componentId }]),
  ]);
  return {
    component: {
      id: c.id,
      name: c.name,
      notes: c.notes,
      attributes: c.attributes,
      verificationStatus: c.verification_status,
      type: { id: c.component_type_id, slug: c.component_slug, name: c.component_type, description: c.type_description, defaultRisk: c.default_risk, compatAttributes: c.compat_attributes },
      product: { id: c.product_id, name: c.product_name, slug: c.product_slug },
      variant: c.variant_name,
      parent: c.parent_id ? { id: c.parent_id, name: c.parent_name } : null,
    },
    children,
    relationships,
    failureModes,
    parts,
    sources,
  };
}
