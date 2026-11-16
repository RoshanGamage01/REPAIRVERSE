import { one, query } from '../../db/pool.js';
import { storage } from '../../storage/storage.js';
import { identifyProduct, type AIIdentification } from '../../ai/operations.js';
import { track } from '../../lib/audit.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import type { AuthUser } from '../../types.js';

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(laptop|notebook|macbook|chromebook|ultrabook|desktop|pc|computer)\b/i, 'laptops-computers'],
  [/\b(phone|smartphone|iphone|android|mobile)\b/i, 'smartphones'],
  [/\b(tablet|ipad|e-?reader|kindle)\b/i, 'tablets'],
  [/\b(tv|television|monitor|display screen)\b/i, 'tvs-monitors'],
  [/\b(coffee|espresso|brewer)\b/i, 'coffee-makers'],
  [/\b(microwave)\b/i, 'microwave-ovens'],
  [/\b(fridge|refrigerator|freezer)\b/i, 'refrigerators'],
  [/\b(washing machine|washer)\b/i, 'washing-machines'],
  [/\b(kettle|toaster|blender|mixer)\b/i, 'kitchen-appliances'],
  [/\b(headphones?|earbuds?|speaker|amplifier|soundbar)\b/i, 'audio'],
  [/\b(charger|adapter|cable|controller|keyboard|mouse)\b/i, 'accessories'],
  [/\b(drill|saw|compressor|grinder|generator)\b/i, 'small-industrial-equipment'],
];

/**
 * Pull model-number-like tokens out of label text ("MODEL: AR14-23", "M/N AR14-23 REV B").
 * Serial-number lines are ignored — a serial identifies a unit, not a model.
 */
export function modelTokens(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\n|;/)) {
    if (/\b(s\/n|serial|sn)\b/i.test(line)) continue;
    const cleaned = line.replace(/\b(model|mod|m\/n|p\/n|part|type|no\.?|number|rev\.?|revision)\b[:.#]?/gi, ' ');
    for (const tok of cleaned.split(/[\s,:]+/)) {
      const t = tok.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (t.length >= 3 && t.length <= 40 && /\d/.test(t) && /[A-Za-z0-9]/.test(t)) out.add(t);
    }
  }
  return [...out];
}

export interface Candidate {
  productId: string;
  slug: string;
  name: string;
  modelNumber: string | null;
  category: string;
  isDemo: boolean;
  confidence: number;
  matchedBy: string[];
  variantId?: string | null;
  variantName?: string | null;
}

function upsert(map: Map<string, Candidate>, row: any, confidence: number, reason: string, variant?: { id: string; name: string }) {
  const existing = map.get(row.id);
  if (existing) {
    // Independent signals agreeing raise confidence (noisy-OR), capped below certainty.
    existing.confidence = Math.min(0.98, 1 - (1 - existing.confidence) * (1 - confidence));
    if (!existing.matchedBy.includes(reason)) existing.matchedBy.push(reason);
    if (variant && !existing.variantId) Object.assign(existing, { variantId: variant.id, variantName: variant.name });
    return;
  }
  map.set(row.id, {
    productId: row.id,
    slug: row.slug,
    name: row.name,
    modelNumber: row.model_number,
    category: row.category_name,
    isDemo: row.is_demo,
    confidence,
    matchedBy: [reason],
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? null,
  });
}

const PRODUCT_COLS = `p.id, p.slug, p.name, p.model_number, p.is_demo, c.name AS category_name`;

async function lookupIdentifier(value: string, kinds: string[]) {
  return query(
    `SELECT ${PRODUCT_COLS}, pi.variant_id, v.name AS variant_name FROM product_identifiers pi JOIN products p ON p.id = pi.product_id JOIN categories c ON c.id = p.category_id
       LEFT JOIN product_variants v ON v.id = pi.variant_id
      WHERE lower(pi.value) = lower($1) AND pi.kind = ANY($2) AND (p.is_public OR p.verification_status <> 'rejected')`,
    [value.trim(), kinds],
  );
}

export async function runIdentification(identificationId: string, user: AuthUser | undefined) {
  const ident = await one('SELECT * FROM identifications WHERE id = $1', [identificationId]);
  if (!ident) throw notFound('Identification');
  const input = ident.input as { text?: string; modelNumber?: string; barcode?: string };
  const candidates = new Map<string, Candidate>();
  const observations: string[] = [];
  let ai: (AIIdentification & { status: string; message?: string }) | { status: string; message?: string } = { status: 'not_requested' };

  // 1. Barcode (exact).
  if (input.barcode) {
    for (const r of await lookupIdentifier(input.barcode, ['gtin', 'upc', 'ean'])) upsert(candidates, r, 0.97, `Barcode ${input.barcode} matches a registered identifier`, r.variant_id ? { id: r.variant_id, name: r.variant_name } : undefined);
    if (!candidates.size) observations.push(`Barcode ${input.barcode} is not registered in the knowledge network yet.`);
  }

  // 2. Images → multimodal AI (observations and legible label text).
  const images = ident.file_ids.length
    ? await query(`SELECT id, storage_key, mime_type FROM files WHERE id = ANY($1) AND kind = 'image' UNION SELECT id, storage_key, mime_type FROM files WHERE derived_from = ANY($1) AND kind = 'image'`, [ident.file_ids])
    : [];
  const categories = await query('SELECT slug FROM categories');
  let modelHints: string[] = [];
  if (images.length) {
    const r = await identifyProduct({
      images: await Promise.all(images.slice(0, 6).map(async (f) => ({ mime: f.mime_type, data: await storage.get(f.storage_key) }))),
      text: input.text,
      categorySlugs: categories.map((c) => c.slug),
      userId: user?.id,
      identificationId,
    });
    if (r.ok) {
      ai = { ...r.data, status: 'used' };
      modelHints = [...new Set([r.data.model, ...r.data.model_variants, ...r.data.label_text.flatMap((l) => [l, ...modelTokens(l)])].filter(Boolean) as string[])];
    } else ai = { status: r.reason, message: r.message };
  }

  // 3. Model number / AI-read label text (exact identifier, then fuzzy).
  for (const m of [input.modelNumber, ...modelHints].filter(Boolean) as string[]) {
    const fromUser = m === input.modelNumber;
    for (const r of await lookupIdentifier(m, ['model_number', 'mpn'])) upsert(candidates, r, fromUser ? 0.9 : 0.75, fromUser ? `Model number "${m}" matches` : `Label text "${m}" read from photo matches a model number`, r.variant_id ? { id: r.variant_id, name: r.variant_name } : undefined);
    const fuzzy = await query(
      `SELECT ${PRODUCT_COLS}, similarity(p.model_number, $1) AS sim FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.model_number IS NOT NULL AND p.model_number % $1 AND (p.is_public OR p.verification_status <> 'rejected') ORDER BY sim DESC LIMIT 5`,
      [m],
    );
    for (const r of fuzzy) if (r.sim < 0.99) upsert(candidates, r, Math.min(0.6, r.sim * 0.7), `Model number is similar to "${r.model_number}" (not exact)`);
  }

  // 4. Free text and AI product name.
  const textQueries = [input.text, ai && 'product_name' in ai ? [ai.brand, ai.product_name].filter(Boolean).join(' ') : null].filter(Boolean) as string[];
  for (const t of textQueries) {
    const rows = await query(
      `SELECT ${PRODUCT_COLS}, greatest(similarity(p.name || ' ' || coalesce(p.model_number,''), $1), word_similarity(p.name, $1)) AS sim
         FROM products p JOIN categories c ON c.id = p.category_id
        WHERE (p.is_public OR p.verification_status <> 'rejected') AND (p.search @@ plainto_tsquery('simple', $1) OR word_similarity(p.name, $1) > 0.4)
        ORDER BY sim DESC LIMIT 5`,
      [t],
    );
    for (const r of rows) upsert(candidates, r, Math.min(0.55, 0.25 + r.sim * 0.4), `Name matches your description`);
  }

  // 5. Learned corrections: previously confirmed mappings from the same evidence.
  const evidenceKeys = [input.modelNumber, input.barcode, ...modelHints].filter(Boolean).map((s) => s!.toLowerCase());
  if (evidenceKeys.length) {
    const learned = await query(
      `SELECT ${PRODUCT_COLS}, count(*)::int AS n FROM identification_corrections ic JOIN products p ON p.id = ic.confirmed_product_id JOIN categories c ON c.id = p.category_id
        WHERE lower(ic.evidence->>'modelNumber') = ANY($1) OR lower(ic.evidence->>'barcode') = ANY($1) GROUP BY p.id, c.name`,
      [evidenceKeys],
    );
    for (const r of learned) upsert(candidates, r, Math.min(0.8, 0.4 + 0.1 * r.n), `Confirmed by ${r.n} previous user correction${r.n > 1 ? 's' : ''} for the same identifier`);
  }

  // Category hint (for diagnosis without an exact product).
  let categoryHint: { slug: string; source: string } | null = null;
  if (ai && 'category_slug' in ai && ai.category_slug) categoryHint = { slug: ai.category_slug, source: 'ai_image_analysis' };
  else if (input.text) for (const [re, slug] of CATEGORY_KEYWORDS) if (re.test(input.text)) {
    categoryHint = { slug, source: 'keywords' };
    break;
  }
  const category = categoryHint ? await one('SELECT id, slug, name FROM categories WHERE slug = $1', [categoryHint.slug]) : null;

  const list = [...candidates.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 6);
  const top = list[0];
  const needs: string[] = [];
  if (!top || top.confidence < 0.7) {
    if (!input.modelNumber) needs.push('Enter the model number (usually on a label underneath, behind the battery, or in Settings → About).');
    if (!input.barcode) needs.push('Scan the barcode on the box or rating label.');
    if (!ident.file_ids.length) needs.push('Add a clear photo of the rating/serial label.');
    if (ai && 'needs' in ai) needs.push(...ai.needs);
  }
  if (images.length && ai.status !== 'used') {
    observations.push(ai.status === 'not_configured' ? 'Photo analysis requires an AI provider to be configured; photos were stored but not analysed.' : `Photo analysis unavailable: ${ai.message ?? ai.status}`);
  }
  const status = top && top.confidence >= 0.5 ? 'candidates' : 'needs_more_info';
  const result = {
    candidates: list,
    categoryHint: category ? { ...category, source: categoryHint!.source } : null,
    ai,
    observations,
    needs: [...new Set(needs)],
    note: 'Identification is a suggestion until you confirm it.',
  };
  await query('UPDATE identifications SET status = $2, result = $3 WHERE id = $1', [identificationId, status, JSON.stringify(result)]);
  await track('identification_attempted', user?.id, identificationId, { status, topConfidence: top?.confidence ?? 0, inputs: { text: !!input.text, model: !!input.modelNumber, barcode: !!input.barcode, images: images.length } });
  return { id: identificationId, status, ...result };
}

export async function confirmIdentification(id: string, input: { productId: string; variantId?: string | null; note?: string }, user: AuthUser) {
  const ident = await one('SELECT * FROM identifications WHERE id = $1', [id]);
  if (!ident) throw notFound('Identification');
  if (ident.user_id !== user.id) throw forbidden();
  const p = await one('SELECT id FROM products WHERE id = $1', [input.productId]);
  if (!p) throw badRequest('Unknown product');
  const suggested: string | null = ident.result?.candidates?.[0]?.productId ?? null;
  const corrected = suggested !== input.productId;
  await query(`UPDATE identifications SET status = 'confirmed', confirmed_product_id = $2, confirmed_variant_id = $3, corrected = $4, confirmed_at = now() WHERE id = $1`, [id, input.productId, input.variantId ?? null, corrected]);
  if (corrected) {
    // Store the correction as structured knowledge: this evidence maps to this product.
    await query(`INSERT INTO identification_corrections(identification_id, user_id, suggested_product_id, confirmed_product_id, evidence, note) VALUES ($1,$2,$3,$4,$5,$6)`, [
      id,
      user.id,
      suggested,
      input.productId,
      JSON.stringify({ modelNumber: ident.input.modelNumber ?? null, barcode: ident.input.barcode ?? null, text: ident.input.text ?? null, aiModel: ident.result?.ai?.model ?? null }),
      input.note ?? null,
    ]);
  }
  await track(corrected ? 'identification_corrected' : 'identification_confirmed', user.id, id, { hadSuggestion: !!suggested });
  return { id, status: 'confirmed', productId: input.productId, variantId: input.variantId ?? null, corrected };
}
