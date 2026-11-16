# Database design

PostgreSQL 16 with `pgcrypto`, `citext`, `pg_trgm`, `vector` (pgvector) and `postgis`. The schema lives in `apps/api/src/db/migrations/*.sql`, applied in order by `src/db/migrate.ts` (transactional per file, advisory-locked, tracked in `schema_migrations`).

## Principles

1. **The knowledge graph is relational.** Entities are tables; edges are typed join tables with attributes, such as likelihoods, likelihood ratios, states and evidence. Every traversal the product needs is 1–3 indexed joins.
2. **Every claim carries provenance.** Knowledge rows have `verification_status` (`unverified | pending_review | verified | rejected | demo`); claims link to `knowledge_sources` through `knowledge_citations` (locator, verbatim excerpt, confidence, version).
3. **Learned values never overwrite curated values.** `base_prior` and `base_likelihood` are curated; `prior_weight` and `likelihood` are recomputed from verified outcomes. Recomputation is idempotent.
4. **Demonstration data is flagged** (`is_demo` and/or `verification_status='demo'`) and cites a tier-0 source.
5. **Private and public data are separated by construction.** Public profiles aggregate only from knowledge tables and *verified* outcomes; customer names, contacts and serials live only in `repair_jobs` and `devices`, scoped to an organization.

## Graph entities and relationships

| Brief relationship | Table(s) |
|---|---|
| Product, Brand, Manufacturer, Model, Variant | `products` (model level), `brands`, `manufacturers`, `product_variants`, `product_identifiers` (GTIN/UPC/EAN/MPN/model) |
| Product HAS_COMPONENT Component | `product_components` (tree via `parent_id`, optional `variant_id`, `attributes` jsonb) + `component_types` (category-independent taxonomy with `compat_attributes`) |
| Component relationships | `component_relationships` (`connects_to`, `powers`, `cools`, `mounted_on`, `controls`, `signals`) |
| Category defaults | `category_component_templates` |
| Component HAS_FAILURE FailureMode | `failure_modes.component_type_id`, scoped by `category_id` (generic) or `product_id` (specialised) |
| FailureMode CAUSES_SYMPTOM Symptom | `failure_mode_symptoms(base_likelihood, likelihood)` |
| DiagnosticTest INVESTIGATES FailureMode | `diagnostic_probes(kind = question|test, risk_level)` + `probe_effects(answer, likelihood_ratio)` |
| RepairProcedure RESOLVES FailureMode | `repair_procedures.failure_mode_id` + `procedure_steps(provenance, source_id)` |
| RepairProcedure REQUIRES_TOOL / REQUIRES_PART | `procedure_tools`, `procedure_materials`, `procedure_component_types` |
| Part COMPATIBLE_WITH Product | `part_compatibility(state, variant_id, verification_status)` + `compatibility_evidence(kind, source, repair_outcome)` |
| RepairEvent REPLACED Component | `job_replaced_components`, `device_events(kind = component_replaced)`, `repair_outcomes.components_replaced` |
| KnowledgeSource SUPPORTS Claim | `knowledge_sources(kind, reliability_tier, licence, access restrictions)` + `knowledge_citations(entity_type, entity_id, locator, excerpt)` |

## Other domains

- **Identity:** `users`, `sessions` (hashed tokens), `organizations`, `memberships`, `technician_profiles` (PostGIS `geography(Point)` location, verification status), `verification_requests`, `technician_reviews`.
- **Personal library:** `devices` (owner *or* organization), `device_events` (timeline), `reminders`, `saved_knowledge`, `identifications`, `identification_corrections` (corrections stored as structured evidence → product mappings).
- **Diagnosis:** `diagnosis_sessions` (interpretation and result snapshot), `diagnosis_observations` (append-only; `superseded_at` for edits; partial unique indexes enforce one active answer per probe).
- **Professional:** `repair_jobs` (per-organization numbering under an advisory lock), `job_status_history`, `job_findings` (`ai_suggestion | technician_finding | confirmed_diagnosis`), `job_quote_items`, `job_work_log`, `job_tests`, `job_attachments`.
- **Learning and community:** `repair_outcomes`, `contributions`, `reputation_ledger`, `content_reports`.
- **Ingestion and retrieval:** `documents`, `document_chunks` (generated `tsvector`, `vector(1536)`, `approved` flag), `extracted_items` (review queue).
- **Platform:** `files`, `api_clients` (hashed keys, scopes, limits), `api_usage`, `ai_model_config`, `ai_operations`, `background_jobs`, `audit_logs`, `analytics_events`, `system_settings`.

## Indexing highlights

- Trigram (`gin_trgm_ops`) on product names and model numbers and on part names, for fuzzy identification and search.
- Generated `tsvector` with GIN indexes on products and document chunks.
- `product_identifiers(kind, value)` is unique, plus an index on `lower(value)` for barcode and model lookup.
- GiST on technician locations (`ST_DWithin` radius search).
- `background_jobs(status, run_at)` for queue polling; time indexes on audit, AI and API-usage logs.
- Unique `part_compatibility(part, product, coalesce(variant, zero-uuid))`, so a product-wide record and a variant record can coexist.

## Seed

`src/db/seed.ts` is idempotent.

- **Every environment:** categories (9 top-level categories plus sub-categories), 34 component types with compatibility attributes, category component templates, tools, AI model defaults, and the admin account.
- **Demo only** (`SEED_DEMO=true`, the default outside production): fictional "Demo Devices" products, symptoms, failure modes, probes, procedures, parts, compatibility records, one clearly-labelled demo offer, an approved demo document, and demo accounts. Barcodes use the GS1 restricted-circulation prefix `2`, which never identifies a real product.
