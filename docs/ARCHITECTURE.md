# REPAIRVERSE — Architecture

## 1. Assessment of the starting point

The repository was empty (no commits, no code, no schema). There was no existing stack, no technical debt and nothing to preserve, so the architecture below was established from scratch, following the brief's preferred stack. The development environment provided PostgreSQL 16 (with pgvector, PostGIS and pg_trgm available), Redis, ffmpeg and Node 22. **No AI provider key was available**, and that shaped one core decision: every capability must work honestly without an LLM, and LLM capabilities must report "requires configuration" instead of faking output.

## 2. System shape: a modular monolith

```
repairverse/
├── packages/shared        Domain vocabulary, safety classifier, job state machine, zod request contracts
├── apps/api               Express + TypeScript modular monolith (REST, SSE), background worker
│   ├── src/engines        Pure deterministic engines (diagnosis, compatibility, decision, confidence, matching)
│   ├── src/ai             Provider abstraction, orchestrator (budget, validation, audit), typed operations, injection guard
│   ├── src/modules/*      Domain modules: auth, catalog, files, identify, diagnosis, parts, library,
│   │                      pro, outcomes, contributions, knowledge, admin, developer
│   ├── src/queue          Durable PostgreSQL job queue
│   ├── src/storage        S3-compatible object storage (local + S3 drivers), signed URLs, media processing
│   └── src/db             SQL migrations, migration runner, seed (taxonomy + labelled demo data)
└── apps/web               React + Vite + Tailwind + React Query; consumer, professional and admin experiences
```

One deployable unit (API + worker + static web) keeps operations simple. Module boundaries are folders with explicit service functions; modules call each other's services, never each other's routes. We considered and **rejected** microservices, a separate graph database, and a separate vector store: none has a demonstrated need yet (see §6).

## 3. The intelligence core

The brief asked for "a structured intelligence system, not a collection of disconnected LLM prompts". The design separates responsibilities strictly:

| Concern | Implementation | Why |
|---|---|---|
| What can fail, what it causes, how to test, how to fix | **Knowledge graph** in PostgreSQL | Auditable, versioned, sourced, queryable |
| Ranking causes, choosing the next question | **Deterministic Bayesian engine** (`engines/diagnosis.ts`) | Reproducible, explainable, testable |
| Compatibility, pricing, repair-vs-replace, workflow, permissions | **Deterministic rules** | Must never hallucinate |
| Interpreting free text and photos, generating language, extracting knowledge from documents | **LLM operations** behind a provider abstraction | Where LLMs genuinely add value |
| Safety | **Deterministic classifier** that LLM output can only escalate, never lower | Safety is not delegated to a model |

### 3.1 Diagnosis engine

Posterior over candidate failure modes *F* plus an explicit residual hypothesis *U* ("a cause not in the knowledge base"):

```
score(f) = log prior(f) + Σ_symptoms log P(s|f) + Σ_answers log P(answer|f)
```

- `P(s|f)` comes from `failure_mode_symptoms`. Unlinked symptoms get a small background rate, so one odd symptom doesn't eliminate a hypothesis.
- Probe (question/test) likelihood ratios are normalised into proper conditional distributions over the probe's options.
- `U` produces symptoms at their prior-weighted marginal rate, so it keeps a share of probability unless evidence *specifically* favours a known failure. The engine therefore cannot become confident merely because the knowledge base is small.
- **Next question** = maximum expected information gain (entropy reduction), with a cost penalty for physical tests. Probes above the viewer's permitted risk are never suggested.
- Output is always *ranked hypotheses*; the API labels every one `status: "hypothesis"`.

Sessions store observations append-only. Changing an earlier answer supersedes it, which preserves the full journey for audit while recomputation stays a pure function of the active observations.

### 3.2 Outcome learning

Repair outcomes enter as `pending_review`. Only verified outcomes update knowledge:

- `prior_weight = base_prior × (1 + 0.15 × min(cases, 3 × independent_reporters))`, which caps the influence of any single reporter.
- `P(s|f)` is updated as a Beta posterior, with the curated likelihood acting as 10 pseudo-observations.
- Knowledge confidence combines source reliability tier, independent reporters and case count. It saturates below certainty and is capped for demo data.
- Frequency and success statistics are withheld below 20 verified cases (Wilson intervals above that).
- Successful verified repairs that used a specific part add `verified_repair` evidence to compatibility. They create a *potential* relation if none exists, never a confirmed one.

### 3.3 AI orchestration

`runAI()` is the only path to a model: it resolves the provider and model per capability (`ai_model_config`), checks enablement and the monthly budget, calls the provider (retrying transient errors once), **validates output with zod**, computes cost, and writes an `ai_operations` audit row whatever the result (`succeeded`, `failed`, `rejected_by_validation`, `not_configured`). Every operation adds post-validation of its own: symptom slugs must exist and evidence quotes must appear in the input; cited reference IDs must be among those actually retrieved; extracted knowledge must quote its chunk verbatim. See [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md).

## 4. Cross-cutting concerns

- **Auth:** argon2id passwords; opaque session tokens stored as SHA-256 hashes; httpOnly SameSite=Lax cookie; anti-CSRF custom header on cookie-authenticated mutations.
- **Authorization:** global roles (`consumer`, `technician`, `moderator`, `admin`) plus organization roles (`owner`, `manager`, `technician`, `staff`). Repair jobs, customer devices and job files are scoped to an organization; consumer data to its owner.
- **Audit:** `audit_logs` for every privileged or state-changing action; `ai_operations` for every model call; `api_usage` for every developer-API request.
- **Instrumentation:** `analytics_events` drive the success metrics in `/admin/metrics`.
- **Rate limiting:** fixed-window counters in Redis (shared across instances), falling back to in-memory. Applied globally, per sensitive route, and per API key.
- **Files:** magic-byte sniffing (the declared MIME type is never trusted); images re-encoded through sharp, which strips EXIF/GPS; video keyframes extracted with ffmpeg; HMAC-signed, expiring download URLs (local driver) or S3 presigned URLs.
- **Background work:** a durable queue in PostgreSQL with `FOR UPDATE SKIP LOCKED`, exponential backoff, idempotency keys, a dead-letter state with admin retry, and stale-lock recovery. Progress streams to the browser over SSE.
- **Errors and logs:** a typed `AppError` mapped to JSON (`{error:{code,message,details}, requestId}`); structured pino logs with secret redaction and a request ID on every response.

## 5. Experiences on one data model

Consumer, professional, admin and developer surfaces all read and write the same graph tables. One example of the flywheel:

1. A consumer diagnosis selects questions using `probe_effects`.
2. A technician closes a job, which creates a `repair_outcomes` row and an anonymised contribution.
3. A moderator approves it, which updates `failure_modes.prior_weight` and `failure_mode_symptoms.likelihood`.
4. The next consumer's diagnosis, and the public API, reflect the change.

## 6. Decisions deliberately deferred

| Deferred | Revisit when |
|---|---|
| Dedicated graph DB | Multi-hop traversals beyond 3–4 joins dominate query time |
| Separate vector DB | Corpus exceeds what pgvector + HNSW handles within latency budget |
| Message broker (Kafka/SQS) | Queue throughput exceeds what Postgres SKIP LOCKED sustains (~thousands/s) |
| Microservices | Independent scaling or team ownership requires it |
| Real-time collaboration | Multi-technician concurrent editing of jobs becomes common |

## 7. Deployment

There is one Docker image, running as API (with the static web client) or as the worker (`node dist/worker.js`). `docker-compose.yml` wires PostgreSQL (pgvector + PostGIS), Redis, MinIO (S3) and daily `pg_dump` backups with retention. Migrations run on start, guarded by an advisory lock so concurrent instances are safe. CI runs typecheck, unit and integration tests against a real PostgreSQL, then the production build.
