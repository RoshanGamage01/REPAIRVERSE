import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { hashPassword } from '../lib/auth.js';
import { DEFAULT_MODELS } from '../ai/orchestrator.js';
import { pool, tx } from './pool.js';
import * as D from './seedData.js';

export interface SeedOptions {
  demo: boolean;
  adminEmail: string;
  adminPassword: string;
  quiet?: boolean;
}

async function idMap(db: pg.PoolClient, table: string, key = 'slug'): Promise<Map<string, string>> {
  const r = await db.query(`SELECT id, ${key} AS k FROM ${table}`);
  return new Map(r.rows.map((x) => [x.k, x.id]));
}

export async function seed(opts: SeedOptions) {
  await tx(async (db) => {
    // ─── Taxonomy (all environments) ───
    for (const [i, c] of D.CATEGORIES.entries()) {
      await db.query(`INSERT INTO categories(slug, name, description, icon, default_risk, position) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`, [c.slug, c.name, c.desc, c.icon, c.risk, i]);
    }
    for (const c of D.SUBCATEGORIES) {
      await db.query(`INSERT INTO categories(slug, name, parent_id, default_risk) SELECT $1,$2,id,$4 FROM categories WHERE slug=$3 ON CONFLICT (slug) DO NOTHING`, [c.slug, c.name, c.parent, c.risk]);
    }
    for (const ct of D.COMPONENT_TYPES) {
      await db.query(`INSERT INTO component_types(slug, name, default_risk, compat_attributes) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`, [ct.slug, ct.name, ct.risk, ct.compat]);
    }
    const cats = await idMap(db, 'categories');
    const comps = await idMap(db, 'component_types');
    for (const [cat, list] of Object.entries(D.CATEGORY_TEMPLATES)) {
      for (const [i, c] of list.entries()) {
        await db.query(`INSERT INTO category_component_templates VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [cats.get(cat), comps.get(c), i]);
      }
    }
    for (const [slug, name, desc] of D.TOOLS) {
      await db.query(`INSERT INTO tools(slug, name, description) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`, [slug, name, desc]);
    }
    for (const [cap, m] of Object.entries(DEFAULT_MODELS)) {
      await db.query(`INSERT INTO ai_model_config(capability, provider, model, input_cost_per_mtok, output_cost_per_mtok) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [cap, m.provider, m.model, m.input, m.output]);
    }
    await db.query(
      `INSERT INTO users(email, password_hash, display_name, role) VALUES ($1,$2,'Platform Administrator','admin') ON CONFLICT (email) DO NOTHING`,
      [opts.adminEmail, await hashPassword(opts.adminPassword)],
    );

    if (!opts.demo) return;
    const already = await db.query(`SELECT 1 FROM products WHERE is_demo LIMIT 1`);
    if (already.rowCount) return;

    // ─── Demonstration data ───
    const tools = await idMap(db, 'tools');
    const src = (
      await db.query(
        `INSERT INTO knowledge_sources(kind, title, publisher, license, reliability_tier, access_restrictions)
         VALUES ('demo', 'REPAIRVERSE demonstration knowledge set', 'REPAIRVERSE (demonstration)', 'Demonstration only', 0, 'Not verified. For product demonstration only.') RETURNING id`,
      )
    ).rows[0].id;

    const mfr = (await db.query(`INSERT INTO manufacturers(name, slug, country, is_demo) VALUES ('Demo Devices Manufacturing (fictional)', 'demo-devices-mfg', NULL, true) RETURNING id`)).rows[0].id;
    const brand = (await db.query(`INSERT INTO brands(name, slug, manufacturer_id, is_demo) VALUES ('Demo Devices', 'demo-devices', $1, true) RETURNING id`, [mfr])).rows[0].id;

    for (const s of D.SYMPTOMS) {
      await db.query(
        `INSERT INTO symptoms(slug, name, synonyms, category_id, search) VALUES ($1,$2,$3,$4, to_tsvector('english', $2 || ' ' || array_to_string($3::text[], ' '))) ON CONFLICT (slug) DO NOTHING`,
        [s.slug, s.name, s.syn, s.cat ? cats.get(s.cat) : null],
      );
    }
    const symptoms = await idMap(db, 'symptoms');

    for (const f of D.FAILURE_MODES) {
      const id = (
        await db.query(
          `INSERT INTO failure_modes(slug, name, description, component_type_id, category_id, risk_level, base_prior, prior_weight, confidence, verification_status, is_demo, is_public)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,0.2,'demo',true,true) RETURNING id`,
          [f.slug, f.name, f.desc, comps.get(f.comp), cats.get(f.cat), f.risk, f.prior],
        )
      ).rows[0].id;
      for (const [s, p] of Object.entries(f.symptoms)) {
        await db.query(`INSERT INTO failure_mode_symptoms VALUES ($1,$2,$3,$3)`, [id, symptoms.get(s), p]);
      }
      await db.query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, locator, verification_status, confidence) VALUES ('failure_mode',$1,$2,'Demonstration heuristics','demo',0.2)`, [id, src]);
    }
    const fms = await idMap(db, 'failure_modes');

    for (const p of D.PROBES) {
      const options = p.options ?? [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ];
      const id = (
        await db.query(
          `INSERT INTO diagnostic_probes(slug, kind, prompt, help, instructions, category_id, options, risk_level, tool_ids, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
          [p.slug, p.kind, p.prompt, p.help ?? null, p.instructions ?? [], cats.get(p.cat), JSON.stringify(options), p.risk, (p.tools ?? []).map((t) => tools.get(t))],
        )
      ).rows[0].id;
      for (const [answer, effects] of Object.entries(p.effects)) {
        for (const [fm, lr] of Object.entries(effects)) {
          await db.query(`INSERT INTO probe_effects VALUES ($1,$2,$3,$4)`, [id, answer, fms.get(fm), lr]);
        }
      }
    }

    for (const pr of D.PROCEDURES) {
      const id = (
        await db.query(
          `INSERT INTO repair_procedures(slug, title, objective, failure_mode_id, difficulty, estimated_minutes_min, estimated_minutes_max, risk_level, provenance, verification_status, preparation, safety_notes, verification, reassembly, is_public, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'demo','demo',$9,$10,$11,$12,true,true) RETURNING id`,
          [pr.slug, pr.title, pr.objective, fms.get(pr.fm), pr.difficulty, pr.minutes[0], pr.minutes[1], pr.risk, pr.prep, pr.safety, pr.verify, pr.reassembly],
        )
      ).rows[0].id;
      for (const [i, st] of pr.steps.entries()) {
        await db.query(`INSERT INTO procedure_steps(procedure_id, position, title, body, expected_observation, caution, provenance, source_id) VALUES ($1,$2,$3,$4,$5,$6,'demo',$7)`, [
          id,
          i + 1,
          st.title,
          st.body,
          st.expected ?? null,
          st.caution ?? null,
          src,
        ]);
      }
      for (const t of pr.tools) await db.query(`INSERT INTO procedure_tools VALUES ($1,$2)`, [id, tools.get(t)]);
      for (const c of pr.comps) await db.query(`INSERT INTO procedure_component_types VALUES ($1,$2)`, [id, comps.get(c)]);
      await db.query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, locator, verification_status, confidence) VALUES ('repair_procedure',$1,$2,'Demonstration procedure','demo',0.2)`, [id, src]);
    }

    // Products
    const variantIds = new Map<string, string>();
    for (const p of D.DEMO_PRODUCTS) {
      const pid = (
        await db.query(
          `INSERT INTO products(slug, category_id, brand_id, name, model_number, release_year, description, is_public, verification_status, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,'demo',true) RETURNING id`,
          [p.slug, cats.get(p.category), brand, p.name, p.model, p.year, p.description],
        )
      ).rows[0].id;
      await db.query(`INSERT INTO product_identifiers(product_id, kind, value) VALUES ($1,'gtin',$2), ($1,'model_number',$3)`, [pid, p.barcode, p.model]);
      for (const v of p.variants) {
        const vid = (await db.query(`INSERT INTO product_variants(product_id, name, variant_code, hardware_revision, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [pid, v.name, v.code, v.rev, v.notes])).rows[0].id;
        variantIds.set(v.code, vid);
        await db.query(`INSERT INTO product_identifiers(product_id, variant_id, kind, value) VALUES ($1,$2,'mpn',$3)`, [pid, vid, v.code]);
      }
      for (const [k, v, u] of p.specs) {
        await db.query(`INSERT INTO product_specs(product_id, key, value, unit, verification_status) VALUES ($1,$2,$3,$4,'demo')`, [pid, k, v, u]);
      }
      const insertComp = async (c: any, parent: string | null, pos: number) => {
        const cid = (
          await db.query(
            `INSERT INTO product_components(product_id, variant_id, component_type_id, parent_id, name, attributes, position, verification_status) VALUES ($1,$2,$3,$4,$5,$6,$7,'demo') RETURNING id`,
            [pid, c.variant ? variantIds.get(c.variant) : null, comps.get(c.comp), parent, c.name, JSON.stringify(c.attrs), pos],
          )
        ).rows[0].id;
        for (const [i, ch] of (c.children ?? []).entries()) await insertComp(ch, cid, i);
      };
      for (const [i, c] of p.components.entries()) await insertComp(c, null, i);
      await db.query(`INSERT INTO knowledge_citations(entity_type, entity_id, source_id, locator, verification_status, confidence) VALUES ('product',$1,$2,'Fictional demonstration product','demo',0.2)`, [pid, src]);
    }
    const products = await idMap(db, 'products');

    // Component relationships for the demo laptop
    const laptop = products.get('demo-devices-aurora-14-ar14-23');
    const lc = (await db.query(`SELECT pc.id, ct.slug FROM product_components pc JOIN component_types ct ON ct.id = pc.component_type_id WHERE pc.product_id = $1`, [laptop])).rows;
    const byComp = (slug: string) => lc.find((r) => r.slug === slug)?.id;
    const rels: [string, string, string][] = [
      ['motherboard', 'display-cable', 'connects_to'],
      ['display-cable', 'display-panel', 'signals'],
      ['battery', 'motherboard', 'powers'],
      ['power-connector', 'motherboard', 'powers'],
      ['cooling-system', 'processor', 'cools'],
      ['keyboard', 'motherboard', 'connects_to'],
      ['trackpad', 'motherboard', 'connects_to'],
    ];
    for (const [a, b, r] of rels) if (byComp(a) && byComp(b)) await db.query(`INSERT INTO component_relationships(from_component_id, to_component_id, relation) VALUES ($1,$2,$3)`, [byComp(a), byComp(b), r]);

    // Parts & compatibility
    const partIds = new Map<string, string>();
    for (const p of D.DEMO_PARTS) {
      const id = (
        await db.query(
          `INSERT INTO parts(name, part_number, manufacturer_id, component_type_id, classification, attributes, description, verification_status, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,'Fictional demonstration part.','demo',true) RETURNING id`,
          [p.name, p.pn, p.cls === 'oem' ? mfr : null, comps.get(p.comp), p.cls, JSON.stringify(p.attrs)],
        )
      ).rows[0].id;
      partIds.set(p.key, id);
    }
    for (const c of D.DEMO_COMPAT) {
      const cid = (
        await db.query(`INSERT INTO part_compatibility(part_id, product_id, variant_id, state, verification_status) VALUES ($1,$2,$3,$4,'demo') RETURNING id`, [
          partIds.get(c.part),
          products.get(c.product),
          c.variant ? variantIds.get(c.variant) : null,
          c.state,
        ])
      ).rows[0].id;
      for (const e of c.evidence) await db.query(`INSERT INTO compatibility_evidence(compatibility_id, kind, description, source_id) VALUES ($1,$2,$3,$4)`, [cid, e.kind, e.description, src]);
    }
    // A single clearly-labelled demonstration offer, so the cost pathway can be exercised.
    await db.query(
      `INSERT INTO part_offers(part_id, provider, seller, price_cents, currency, availability, is_demo) VALUES ($1,'manual','Demo Parts Supplier (fictional — not a real listing)',8900,'USD','in_stock',true)`,
      [partIds.get('panel-fhd-oem')],
    );

    // A demonstration document, approved for retrieval grounding.
    const doc = (await db.query(`INSERT INTO documents(source_id, raw_text, status, page_count) VALUES ($1,$2,'chunked',1) RETURNING id`, [src, D.DEMO_DOC_TEXT])).rows[0].id;
    const sections = D.DEMO_DOC_TEXT.split(/\n(?=Section )/);
    for (const [i, sec] of sections.entries()) {
      await db.query(`INSERT INTO document_chunks(document_id, source_id, ordinal, page, section, content, content_hash, approved) VALUES ($1,$2,$3,1,$4,$5,md5($5),true)`, [
        doc,
        src,
        i,
        sec.split('\n')[0].slice(0, 80),
        sec,
      ]);
    }

    // Demo accounts
    const pw = await hashPassword('demo-password-123');
    const consumer = (await db.query(`INSERT INTO users(email, password_hash, display_name, role) VALUES ('demo@repairverse.dev',$1,'Demo Consumer','consumer') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`, [pw])).rows[0].id;
    const tech = (await db.query(`INSERT INTO users(email, password_hash, display_name, role) VALUES ('tech@repairverse.dev',$1,'Demo Technician','technician') ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`, [pw])).rows[0].id;
    const org = (await db.query(`INSERT INTO organizations(name, slug, kind) VALUES ('Demo Repair Studio','demo-repair-studio','repair_shop') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO memberships VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [org, tech]);
    await db.query(
      `INSERT INTO technician_profiles(user_id, headline, specialties, category_ids, years_experience, service_area, business_name, verification_status, location)
       VALUES ($1,'Laptop and phone repair (demo account)',$2,$3,6,'Demo City','Demo Repair Studio','unverified', ST_SetSRID(ST_MakePoint(-0.1276, 51.5072),4326)::geography) ON CONFLICT DO NOTHING`,
      [tech, ['laptop display repair', 'battery replacement', 'board-level diagnostics'], [cats.get('laptops-computers'), cats.get('smartphones')]],
    );
    await db.query(`INSERT INTO verification_requests(user_id, statement, evidence) VALUES ($1,'Demo verification request: 6 years of laptop repair experience.','[{"kind":"text","value":"Demonstration evidence — not a real credential."}]')`, [tech]);
    await db.query(`INSERT INTO devices(owner_user_id, product_id, variant_id, nickname, purchase_date) VALUES ($1,$2,$3,'My work laptop', now()::date - interval '3 years')`, [
      consumer,
      laptop,
      variantIds.get('AR14-23-F'),
    ]);
    const dev = (await db.query(`SELECT id FROM devices WHERE owner_user_id = $1`, [consumer])).rows[0].id;
    await db.query(`INSERT INTO device_events(device_id, kind, title, occurred_at, created_by) VALUES ($1,'registered','Added to My Devices', now() - interval '3 years', $2)`, [dev, consumer]);
  });
  if (!opts.quiet) console.log(`Seed complete${opts.demo ? ' (with demonstration data)' : ''}.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).replace(/\.ts$/, '') === process.argv[1].replace(/\.(ts|js)$/, '');
if (isMain) {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@repairverse.dev';
  const adminPassword = process.env.ADMIN_PASSWORD ?? (process.env.NODE_ENV === 'production' ? '' : 'admin-password-123');
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD is required in production');
    process.exit(1);
  }
  seed({ demo: (process.env.SEED_DEMO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true', adminEmail, adminPassword })
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
