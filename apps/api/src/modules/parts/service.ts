import { one, query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { evaluateCompatibility, type CompatVerdict } from '../../engines/compatibility.js';

/** Provider integration architecture for part offers. Offers are only ever sourced, never generated. */
export interface PartsProvider {
  key: string;
  name: string;
  isConfigured(): boolean;
  search(input: { partNumber?: string | null; name: string }): Promise<{ seller: string; url: string | null; priceCents: number | null; currency: string; availability: string }[]>;
}

const providers: PartsProvider[] = [];
export function registerPartsProvider(p: PartsProvider) {
  providers.push(p);
}
export function partsProviders() {
  return [
    { key: 'manual', name: 'Verified manual entry', configured: true, description: 'Offers entered and verified by technicians or moderators.' },
    ...providers.map((p) => ({ key: p.key, name: p.name, configured: p.isConfigured(), description: 'External provider' })),
  ];
}

export async function refreshOffersFromProviders(partId: string) {
  const part = await one('SELECT id, name, part_number FROM parts WHERE id = $1', [partId]);
  if (!part) throw notFound('Part');
  let added = 0;
  for (const p of providers.filter((x) => x.isConfigured())) {
    for (const o of await p.search({ partNumber: part.part_number, name: part.name })) {
      await query(`INSERT INTO part_offers(part_id, provider, seller, url, price_cents, currency, availability) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [partId, p.key, o.seller, o.url, o.priceCents, o.currency, o.availability]);
      added++;
    }
  }
  return { added, configuredProviders: providers.filter((x) => x.isConfigured()).length };
}

export async function offersFor(partIds: string[]) {
  if (!partIds.length) return [];
  return query(
    `SELECT DISTINCT ON (part_id, provider, seller) id, part_id, provider, seller, url, price_cents, currency, availability, observed_at, is_demo, verified_by IS NOT NULL AS verified
       FROM part_offers WHERE part_id = ANY($1) AND observed_at > now() - interval '90 days'
      ORDER BY part_id, provider, seller, observed_at DESC`,
    [partIds],
  );
}

/** Find the product's slot attributes for a component type (variant-specific first). */
async function slotAttributes(productId: string, variantId: string | null, componentTypeId: string): Promise<Record<string, string>> {
  const rows = await query(
    `SELECT attributes, variant_id FROM product_components WHERE product_id = $1 AND component_type_id = $2 AND (variant_id IS NULL OR variant_id IS NOT DISTINCT FROM $3)
      ORDER BY variant_id NULLS LAST`,
    [productId, componentTypeId, variantId],
  );
  // If there is no variant chosen and multiple variant-specific slots disagree, we cannot know the slot.
  if (!variantId) {
    const generic = rows.filter((r) => !r.variant_id);
    if (generic.length) return generic[0].attributes;
    const variantRows = await query(`SELECT attributes FROM product_components WHERE product_id = $1 AND component_type_id = $2 AND variant_id IS NOT NULL`, [productId, componentTypeId]);
    if (variantRows.length === 1) return variantRows[0].attributes;
    if (variantRows.length > 1) {
      // Keep only attributes common to all variants.
      const common: Record<string, string> = {};
      for (const [k, v] of Object.entries(variantRows[0].attributes as Record<string, string>)) if (variantRows.every((r) => r.attributes[k] === v)) common[k] = v;
      return common;
    }
    return {};
  }
  return rows[0]?.attributes ?? {};
}

export async function checkCompatibility(partId: string, productId: string, variantId: string | null): Promise<CompatVerdict & { part: any; product: any; variant: any; isDemo: boolean }> {
  const part = await one(
    `SELECT pa.*, ct.compat_attributes, ct.name AS component_type, m.name AS manufacturer FROM parts pa JOIN component_types ct ON ct.id = pa.component_type_id LEFT JOIN manufacturers m ON m.id = pa.manufacturer_id WHERE pa.id = $1`,
    [partId],
  );
  if (!part) throw notFound('Part');
  const product = await one('SELECT id, name, model_number, slug FROM products WHERE id = $1', [productId]);
  if (!product) throw notFound('Product');
  const variant = variantId ? await one('SELECT id, name, variant_code, hardware_revision FROM product_variants WHERE id = $1 AND product_id = $2', [variantId, productId]) : null;
  const explicitRows = await query(
    `SELECT pc.id, pc.state, pc.variant_id, pc.verification_status,
            coalesce(json_agg(json_build_object('kind', e.kind, 'description', e.description, 'sourceId', e.source_id, 'sourceTitle', s.title, 'sourceUrl', s.url)) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
       FROM part_compatibility pc LEFT JOIN compatibility_evidence e ON e.compatibility_id = pc.id LEFT JOIN knowledge_sources s ON s.id = e.source_id
      WHERE pc.part_id = $1 AND pc.product_id = $2 GROUP BY pc.id`,
    [partId, productId],
  );
  const verdict = evaluateCompatibility({
    variantId,
    // Demonstration records behave as reviewed records inside the demo dataset, and are labelled as demo everywhere they appear.
    explicit: explicitRows.map((r) => ({ state: r.state, variantId: r.variant_id, verificationStatus: r.verification_status === 'demo' ? 'verified' : r.verification_status, evidence: r.evidence })),
    requiredAttributes: part.compat_attributes,
    slotAttributes: await slotAttributes(productId, variantId, part.component_type_id),
    partAttributes: part.attributes,
  });
  return {
    ...verdict,
    isDemo: part.is_demo || explicitRows.some((r) => r.verification_status === 'demo'),
    part: { id: part.id, name: part.name, partNumber: part.part_number, classification: part.classification, componentType: part.component_type, manufacturer: part.manufacturer, attributes: part.attributes, verificationStatus: part.verification_status },
    product,
    variant,
  };
}

/** All candidate parts for a product's component type, grouped by compatibility state. */
export async function partsForProduct(productId: string, variantId: string | null, componentTypeId: string | null) {
  const candidates = await query(
    `SELECT DISTINCT pa.id FROM parts pa
      WHERE ($2::uuid IS NULL OR pa.component_type_id = $2)
        AND (EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.part_id = pa.id AND pc.product_id = $1)
             OR pa.component_type_id IN (SELECT component_type_id FROM product_components WHERE product_id = $1))
        AND pa.verification_status <> 'rejected'
      LIMIT 200`,
    [productId, componentTypeId],
  );
  const results = await Promise.all(candidates.map((c) => checkCompatibility(c.id, productId, variantId)));
  const offers = await offersFor(results.map((r) => r.part.id));
  const withOffers = results.map((r) => ({ ...r, offers: offers.filter((o) => o.part_id === r.part.id) }));
  return {
    confirmed: withOffers.filter((r) => r.state === 'confirmed'),
    potential: withOffers.filter((r) => r.state === 'potential'),
    unknown: withOffers.filter((r) => r.state === 'unknown'),
    incompatible: withOffers.filter((r) => r.state === 'incompatible'),
    variantRequired: !variantId && !!(await one('SELECT 1 FROM product_variants WHERE product_id = $1', [productId])),
  };
}
