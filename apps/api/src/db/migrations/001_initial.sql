-- REPAIRVERSE initial schema.
-- The repair knowledge graph is represented as normalized relational tables
-- (see docs/DATABASE_DESIGN.md). Every knowledge-bearing row carries provenance
-- and verification status; demonstration rows carry is_demo = true.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ───────────────────────── Files ─────────────────────────
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  storage_key text NOT NULL UNIQUE,
  original_name text,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','video','document','other')),
  width int, height int,
  purpose text NOT NULL DEFAULT 'general',
  derived_from uuid REFERENCES files(id) ON DELETE CASCADE,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files(owner_id);

-- ───────────────────────── Identity & access ─────────────────────────
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'consumer' CHECK (role IN ('consumer','technician','moderator','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  reputation numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
ALTER TABLE files ADD CONSTRAINT files_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  user_agent text, ip text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'repair_shop' CHECK (kind IN ('repair_shop','manufacturer','enterprise','community')),
  phone text, website text, address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','technician','staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE technician_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline text, bio text,
  specialties text[] NOT NULL DEFAULT '{}',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  years_experience int,
  service_area text,
  location geography(Point, 4326),
  business_name text, business_phone text, business_website text,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX technician_profiles_location_idx ON technician_profiles USING gist(location);

CREATE TABLE verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','needs_evidence')),
  reviewer_id uuid REFERENCES users(id),
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE technician_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  job_id uuid,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Catalog / taxonomy ─────────────────────────
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES categories(id),
  description text,
  icon text,
  default_risk text NOT NULL DEFAULT 'medium' CHECK (default_risk IN ('low','medium','high')),
  position int NOT NULL DEFAULT 0
);

CREATE TABLE manufacturers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  country text, website text,
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  manufacturer_id uuid REFERENCES manufacturers(id),
  is_demo boolean NOT NULL DEFAULT false
);

-- ───────────────────────── Knowledge sources & provenance ─────────────────────────
CREATE TABLE knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('manufacturer_manual','technical_documentation','repair_guide','component_specification','expert_submission','repair_report','public_dataset','demo')),
  title text NOT NULL,
  url text,
  publisher text,
  published_at date,
  license text,
  access_restrictions text,
  reliability_tier int NOT NULL DEFAULT 1 CHECK (reliability_tier BETWEEN 0 AND 5),
  file_id uuid REFERENCES files(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retracted','pending_review')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- KnowledgeSource SUPPORTS Claim. A claim is any knowledge row identified by (entity_type, entity_id).
CREATE TABLE knowledge_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  locator text,               -- page / section
  excerpt text,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  UNIQUE (entity_type, entity_id, source_id, locator)
);
CREATE INDEX knowledge_citations_entity_idx ON knowledge_citations(entity_type, entity_id);

-- ───────────────────────── Products ─────────────────────────
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  category_id uuid NOT NULL REFERENCES categories(id),
  brand_id uuid REFERENCES brands(id),
  name text NOT NULL,
  model_number text,
  release_year int,
  description text,
  image_file_id uuid REFERENCES files(id),
  is_public boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(model_number,''))) STORED
);
CREATE INDEX products_search_idx ON products USING gin(search);
CREATE INDEX products_name_trgm_idx ON products USING gin(name gin_trgm_ops);
CREATE INDEX products_model_trgm_idx ON products USING gin(model_number gin_trgm_ops);
CREATE INDEX products_category_idx ON products(category_id);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  variant_code text,
  hardware_revision text,
  notes text
);
CREATE INDEX product_variants_product_idx ON product_variants(product_id);

CREATE TABLE product_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('gtin','upc','ean','mpn','model_number')),
  value text NOT NULL,
  UNIQUE (kind, value)
);
CREATE INDEX product_identifiers_value_idx ON product_identifiers(lower(value));

CREATE TABLE product_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  unit text,
  is_estimate boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_specs_product_idx ON product_specs(product_id);

-- Generic component taxonomy (category-independent).
CREATE TABLE component_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  default_risk text NOT NULL DEFAULT 'medium' CHECK (default_risk IN ('low','medium','high')),
  compat_attributes text[] NOT NULL DEFAULT '{}'   -- attributes the compatibility engine must compare
);

-- Product HAS_COMPONENT Component (a tree via parent_id).
CREATE TABLE product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  component_type_id uuid NOT NULL REFERENCES component_types(id),
  parent_id uuid REFERENCES product_components(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  attributes jsonb NOT NULL DEFAULT '{}',   -- connector_type, voltage, dimensions … with provenance in citations
  position int NOT NULL DEFAULT 0,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo'))
);
CREATE INDEX product_components_product_idx ON product_components(product_id);

-- Category-level component templates: the default breakdown for a category.
CREATE TABLE category_component_templates (
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  component_type_id uuid NOT NULL REFERENCES component_types(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, component_type_id)
);

CREATE TABLE component_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_component_id uuid NOT NULL REFERENCES product_components(id) ON DELETE CASCADE,
  to_component_id uuid NOT NULL REFERENCES product_components(id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('connects_to','powers','cools','mounted_on','controls','signals')),
  notes text
);

-- ───────────────────────── Failure intelligence ─────────────────────────
CREATE TABLE symptoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  synonyms text[] NOT NULL DEFAULT '{}',
  category_id uuid REFERENCES categories(id),
  search tsvector
);
CREATE INDEX symptoms_search_idx ON symptoms USING gin(search);

CREATE TABLE failure_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  component_type_id uuid NOT NULL REFERENCES component_types(id),
  category_id uuid REFERENCES categories(id),      -- generic scope
  product_id uuid REFERENCES products(id) ON DELETE CASCADE, -- specialization scope
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  base_prior numeric(8,3) NOT NULL DEFAULT 1,       -- curated relative prior
  prior_weight numeric(8,3) NOT NULL DEFAULT 1,     -- effective prior = base_prior adjusted by verified, corroborated outcomes
  confidence numeric(4,3) NOT NULL DEFAULT 0.3,
  verified_case_count int NOT NULL DEFAULT 0,
  verified_success_count int NOT NULL DEFAULT 0,
  independent_reporter_count int NOT NULL DEFAULT 0,
  is_public boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX failure_modes_category_idx ON failure_modes(category_id);
CREATE INDEX failure_modes_product_idx ON failure_modes(product_id);

-- FailureMode CAUSES_SYMPTOM Symptom with P(symptom | failure).
CREATE TABLE failure_mode_symptoms (
  failure_mode_id uuid NOT NULL REFERENCES failure_modes(id) ON DELETE CASCADE,
  symptom_id uuid NOT NULL REFERENCES symptoms(id) ON DELETE CASCADE,
  base_likelihood numeric(4,3) NOT NULL CHECK (base_likelihood > 0 AND base_likelihood < 1),
  likelihood numeric(4,3) NOT NULL CHECK (likelihood > 0 AND likelihood < 1),  -- updated from verified outcomes
  PRIMARY KEY (failure_mode_id, symptom_id)
);

-- Diagnostic questions and tests ("probes"). DiagnosticTest INVESTIGATES FailureMode via probe_effects.
CREATE TABLE diagnostic_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('question','test')),
  prompt text NOT NULL,
  help text,
  instructions text[] NOT NULL DEFAULT '{}',
  category_id uuid REFERENCES categories(id),
  options jsonb NOT NULL,       -- [{value,label}]
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high')),
  tool_ids uuid[] NOT NULL DEFAULT '{}',
  is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE probe_effects (
  probe_id uuid NOT NULL REFERENCES diagnostic_probes(id) ON DELETE CASCADE,
  answer_value text NOT NULL,
  failure_mode_id uuid NOT NULL REFERENCES failure_modes(id) ON DELETE CASCADE,
  likelihood_ratio numeric(8,4) NOT NULL CHECK (likelihood_ratio > 0),
  PRIMARY KEY (probe_id, answer_value, failure_mode_id)
);
CREATE INDEX probe_effects_fm_idx ON probe_effects(failure_mode_id);

CREATE TABLE tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);

-- ───────────────────────── Repair procedures ─────────────────────────
CREATE TABLE repair_procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  objective text NOT NULL,
  failure_mode_id uuid NOT NULL REFERENCES failure_modes(id) ON DELETE CASCADE, -- RepairProcedure RESOLVES FailureMode
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  difficulty int NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  estimated_minutes_min int, estimated_minutes_max int,
  risk_level text NOT NULL CHECK (risk_level IN ('low','medium','high')),
  provenance text NOT NULL CHECK (provenance IN ('manufacturer_documentation','expert_reviewed','verified_repair_record','community_contribution','ai_generated','demo')),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  preparation text[] NOT NULL DEFAULT '{}',
  safety_notes text[] NOT NULL DEFAULT '{}',
  verification text[] NOT NULL DEFAULT '{}',
  reassembly text[] NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  is_public boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  ai_operation_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_procedures_fm_idx ON repair_procedures(failure_mode_id);

CREATE TABLE procedure_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id uuid NOT NULL REFERENCES repair_procedures(id) ON DELETE CASCADE,
  position int NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  expected_observation text,
  caution text,
  provenance text NOT NULL CHECK (provenance IN ('manufacturer_documentation','expert_reviewed','verified_repair_record','community_contribution','ai_generated','demo')),
  source_id uuid REFERENCES knowledge_sources(id),
  image_file_id uuid REFERENCES files(id),
  UNIQUE (procedure_id, position)
);

CREATE TABLE procedure_tools (
  procedure_id uuid NOT NULL REFERENCES repair_procedures(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tools(id),
  PRIMARY KEY (procedure_id, tool_id)
);
CREATE TABLE procedure_materials (
  procedure_id uuid NOT NULL REFERENCES repair_procedures(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES materials(id),
  PRIMARY KEY (procedure_id, material_id)
);
-- RepairProcedure REQUIRES_PART (expressed as a component type; concrete parts resolved via compatibility).
CREATE TABLE procedure_component_types (
  procedure_id uuid NOT NULL REFERENCES repair_procedures(id) ON DELETE CASCADE,
  component_type_id uuid NOT NULL REFERENCES component_types(id),
  PRIMARY KEY (procedure_id, component_type_id)
);

-- ───────────────────────── Parts & compatibility ─────────────────────────
CREATE TABLE parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  part_number text,
  manufacturer_id uuid REFERENCES manufacturers(id),
  component_type_id uuid NOT NULL REFERENCES component_types(id),
  classification text NOT NULL CHECK (classification IN ('oem','genuine_refurbished','aftermarket','salvaged','unknown')),
  attributes jsonb NOT NULL DEFAULT '{}',
  description text,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parts_pn_idx ON parts(lower(part_number));
CREATE INDEX parts_name_trgm_idx ON parts USING gin(name gin_trgm_ops);
CREATE INDEX parts_component_type_idx ON parts(component_type_id);

-- Part COMPATIBLE_WITH Product
CREATE TABLE part_compatibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('confirmed','potential','incompatible')),
  notes text,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX part_compat_unique ON part_compatibility(part_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE compatibility_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compatibility_id uuid NOT NULL REFERENCES part_compatibility(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('manufacturer_documentation','verified_repair','technician_report','attribute_match','community')),
  description text NOT NULL,
  source_id uuid REFERENCES knowledge_sources(id),
  repair_outcome_id uuid,
  contributor_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Offers come only from configured providers or verified manual entry. Never fabricated.
CREATE TABLE part_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  provider text NOT NULL,            -- 'manual' or a provider key
  seller text NOT NULL,
  url text,
  price_cents int,
  currency text NOT NULL DEFAULT 'USD',
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('in_stock','limited','out_of_stock','unknown')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES users(id),
  is_demo boolean NOT NULL DEFAULT false
);
CREATE INDEX part_offers_part_idx ON part_offers(part_id);

-- ───────────────────────── Document ingestion & retrieval ─────────────────────────
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  file_id uuid REFERENCES files(id),
  raw_text text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','extracting','chunked','extracted','failed')),
  page_count int,
  error text,
  injection_flags jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  ordinal int NOT NULL,
  page int,
  section text,
  content text NOT NULL,
  content_hash text NOT NULL,
  approved boolean NOT NULL DEFAULT false,   -- only approved chunks are used for grounding
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding vector(1536),
  UNIQUE (document_id, ordinal)
);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin(tsv);

CREATE TABLE extracted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (item_type IN ('failure_mode','symptom_link','repair_procedure','product_spec','component','compatibility')),
  payload jsonb NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','needs_evidence')),
  extractor text NOT NULL,             -- 'llm:<model>' or 'rule:<name>'
  reviewer_id uuid REFERENCES users(id),
  review_notes text,
  applied_entity_type text, applied_entity_id uuid,
  ai_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

-- ───────────────────────── Personal library ─────────────────────────
CREATE TABLE identifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  input jsonb NOT NULL,
  file_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','candidates','needs_more_info','confirmed','failed')),
  result jsonb,
  confirmed_product_id uuid REFERENCES products(id),
  confirmed_variant_id uuid REFERENCES product_variants(id),
  corrected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE identification_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identification_id uuid NOT NULL REFERENCES identifications(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  suggested_product_id uuid REFERENCES products(id),
  confirmed_product_id uuid NOT NULL REFERENCES products(id),
  evidence jsonb NOT NULL DEFAULT '{}',   -- observed text/model/barcode that maps to the confirmed product
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  variant_id uuid REFERENCES product_variants(id),
  nickname text NOT NULL,
  serial_number text,
  purchase_date date,
  warranty_expires date,
  purchase_price_cents int,
  currency text NOT NULL DEFAULT 'USD',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_user_id IS NOT NULL OR organization_id IS NOT NULL)
);
CREATE INDEX devices_owner_idx ON devices(owner_user_id);
CREATE INDEX devices_org_idx ON devices(organization_id);

CREATE TABLE device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('registered','diagnosis','repair_attempt','repair_completed','component_replaced','maintenance','warranty','receipt','note')),
  title text NOT NULL,
  details text,
  cost_cents int,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  file_id uuid REFERENCES files(id),
  diagnosis_id uuid,
  job_id uuid,
  component_type_id uuid REFERENCES component_types(id),
  created_by uuid REFERENCES users(id)
);
CREATE INDEX device_events_device_idx ON device_events(device_id, occurred_at);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  done boolean NOT NULL DEFAULT false
);

CREATE TABLE saved_knowledge (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('product','failure_mode','repair_procedure','part')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

-- ───────────────────────── Diagnosis ─────────────────────────
CREATE TABLE diagnosis_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id),
  category_id uuid REFERENCES categories(id),
  description text NOT NULL,
  file_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  interpretation jsonb,             -- symptom-extraction output (AI or lexical), with provenance
  result jsonb,                     -- latest computed hypothesis snapshot
  confirmed_failure_mode_id uuid REFERENCES failure_modes(id),
  saved boolean NOT NULL DEFAULT false,
  api_client_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX diagnosis_sessions_user_idx ON diagnosis_sessions(user_id);

CREATE TABLE diagnosis_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES diagnosis_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('symptom','probe_answer')),
  symptom_id uuid REFERENCES symptoms(id),
  probe_id uuid REFERENCES diagnostic_probes(id),
  answer text,
  note text,
  origin text NOT NULL CHECK (origin IN ('user','ai_extracted','lexical_match','technician')),
  position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE INDEX diagnosis_observations_session_idx ON diagnosis_observations(session_id);
CREATE UNIQUE INDEX diagnosis_obs_probe_active ON diagnosis_observations(session_id, probe_id) WHERE probe_id IS NOT NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX diagnosis_obs_symptom_active ON diagnosis_observations(session_id, symptom_id) WHERE symptom_id IS NOT NULL AND superseded_at IS NULL;

-- ───────────────────────── Professional workspace ─────────────────────────
CREATE TABLE repair_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number int NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  customer_name text NOT NULL,
  customer_contact text,
  complaint text NOT NULL,
  intake_condition text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','inspecting','diagnosing','waiting_for_approval','waiting_for_parts','in_repair','testing','completed','delivered','cancelled')),
  diagnosis_session_id uuid REFERENCES diagnosis_sessions(id),
  confirmed_failure_mode_id uuid REFERENCES failure_modes(id),
  created_by uuid NOT NULL REFERENCES users(id),
  assigned_to uuid REFERENCES users(id),
  quote_approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);
CREATE INDEX repair_jobs_org_status_idx ON repair_jobs(organization_id, status);

CREATE TABLE job_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL,
  note text,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ai_suggestion','technician_finding','confirmed_diagnosis')),
  failure_mode_id uuid REFERENCES failure_modes(id),
  text text NOT NULL,
  probability numeric(5,4),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('part','labor','other')),
  description text NOT NULL,
  part_id uuid REFERENCES parts(id),
  quantity int NOT NULL DEFAULT 1,
  unit_price_cents int NOT NULL
);

CREATE TABLE job_work_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  text text NOT NULL,
  minutes int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_replaced_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  component_type_id uuid NOT NULL REFERENCES component_types(id),
  part_id uuid REFERENCES parts(id),
  old_part_number text, new_part_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  result text NOT NULL CHECK (result IN ('pass','fail')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_attachments (
  job_id uuid NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  label text,
  stage text NOT NULL DEFAULT 'intake',
  PRIMARY KEY (job_id, file_id)
);

-- ───────────────────────── Outcomes & contributions ─────────────────────────
CREATE TABLE repair_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES repair_jobs(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id),
  reporter_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  symptom_ids uuid[] NOT NULL DEFAULT '{}',
  original_symptoms text,
  initial_hypotheses jsonb NOT NULL DEFAULT '[]',
  diagnosis_session_id uuid REFERENCES diagnosis_sessions(id),
  tests_performed jsonb NOT NULL DEFAULT '[]',
  actual_failure_mode_id uuid REFERENCES failure_modes(id),
  actual_failure_text text,
  components_replaced jsonb NOT NULL DEFAULT '[]',
  procedure_id uuid REFERENCES repair_procedures(id),
  cost_cents int,
  currency text NOT NULL DEFAULT 'USD',
  duration_minutes int,
  succeeded boolean NOT NULL,
  follow_up_status text NOT NULL DEFAULT 'none' CHECK (follow_up_status IN ('none','pending','holding','recurred')),
  verification_status text NOT NULL DEFAULT 'pending_review' CHECK (verification_status IN ('unverified','pending_review','verified','rejected','demo')),
  top_hypothesis_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_outcomes_fm_idx ON repair_outcomes(actual_failure_mode_id);
CREATE INDEX repair_outcomes_product_idx ON repair_outcomes(product_id);

CREATE TABLE contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id),
  type text NOT NULL CHECK (type IN ('repair_outcome','failure_report','repair_procedure','compatibility','correction','new_product','observation','inaccuracy_report')),
  title text NOT NULL,
  target_entity_type text,
  target_entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','needs_evidence','approved','rejected')),
  quality_score numeric(4,3),
  reviewer_id uuid REFERENCES users(id),
  review_notes text,
  applied jsonb,
  repair_outcome_id uuid REFERENCES repair_outcomes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX contributions_status_idx ON contributions(status, created_at);

CREATE TABLE reputation_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contribution_id uuid REFERENCES contributions(id) ON DELETE SET NULL,
  delta numeric(8,2) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Developer API ─────────────────────────
CREATE TABLE api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id),
  name text NOT NULL,
  key_prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  scopes text[] NOT NULL,
  rate_limit_per_minute int NOT NULL DEFAULT 60,
  monthly_quota int NOT NULL DEFAULT 10000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE api_usage (
  id bigserial PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  method text NOT NULL, path text NOT NULL,
  status int NOT NULL, latency_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_usage_client_time_idx ON api_usage(client_id, created_at);

-- ───────────────────────── AI operations ─────────────────────────
CREATE TABLE ai_model_config (
  capability text PRIMARY KEY CHECK (capability IN ('multimodal','reasoning','embedding','transcription')),
  provider text NOT NULL,
  model text NOT NULL,
  input_cost_per_mtok numeric(10,4) NOT NULL DEFAULT 0,
  output_cost_per_mtok numeric(10,4) NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  capability text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','rejected_by_validation','not_configured')),
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  prompt_hash text,
  validation_errors jsonb,
  error text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text, entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_operations_time_idx ON ai_operations(created_at);

-- ───────────────────────── Platform ─────────────────────────
CREATE TABLE background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz, locked_by text,
  idempotency_key text UNIQUE,
  progress jsonb,
  result jsonb,
  last_error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX background_jobs_ready_idx ON background_jobs(status, run_at);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind text NOT NULL DEFAULT 'user',
  action text NOT NULL,
  entity_type text, entity_id text,
  details jsonb NOT NULL DEFAULT '{}',
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_time_idx ON audit_logs(created_at DESC);

CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_id uuid,
  properties jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_time_idx ON analytics_events(name, created_at);

CREATE TABLE content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
