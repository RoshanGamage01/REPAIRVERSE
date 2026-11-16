# Implementation roadmap

## Delivered in v1 (this repository)

| Milestone | Scope | Verification |
|---|---|---|
| M0 Foundations | Monorepo, shared domain package, config, logging, errors, migrations, seed | Migrations + seed run clean on PostgreSQL 16 |
| M1 Knowledge graph & engines | Full schema; diagnosis, compatibility, repair-decision, confidence/reputation, symptom matching, safety classifier | 28 unit tests |
| M2 Intelligence services | AI provider abstraction + orchestrator + operations + injection guard; retrieval; identification; diagnosis service; guides; decisions | AI-governance tests with a scripted provider |
| M3 Workflows | Library, professional jobs, outcomes & learning, contributions & moderation, ingestion pipeline, admin, developer API | Scenarios A–D integration tests; all-endpoint smoke test across 4 roles |
| M4 Web experiences | Design system; consumer, professional and admin applications | Typecheck, production build, Playwright walkthroughs at desktop and mobile widths |
| M5 Operations | Dockerfile, docker-compose (PostGIS/pgvector, Redis, MinIO, worker, backups), CI | Production bundle boots, migrates, seeds and serves the web app |

## Risks and dependencies

| Risk | Mitigation in v1 | Next step |
|---|---|---|
| Thin knowledge at launch | Category-level generic failure knowledge applies to any product in a category; residual "unknown cause" keeps the engine honest | Curated ingestion of licensed manufacturer and service documentation; partner programmes with repair shops |
| Curated priors / likelihood ratios are subjective | Separated `base_*` vs learned values; outcome learning is conservative and auditable; accuracy metric | Calibrate LRs from verified outcomes at scale; per-category calibration reports |
| AI provider cost/outage | Budget cap, per-call audit, deterministic fallbacks everywhere | Add a second provider (e.g. Anthropic) via `registerProvider` |
| Contribution abuse / poisoning | Moderation, no self-review, reputation with diminishing returns, corroboration requirements | Reviewer sampling, anomaly detection on contributor patterns |
| Licensing of source documents | Rights confirmation, licence/restriction fields, retraction | Legal review workflow per source |
| Safety mis-classification | Conservative pattern rules, category escalation, LLM can't lower risk | Expert-reviewed hazard taxonomy per category; red-team test suite |

## Next (v1.x)

1. **Accounts:** email verification, password reset, MFA for staff (requires a mail provider).
2. **Parts providers:** implement `PartsProvider` adapters for real distributors (interface and offer storage exist).
3. **Embeddings at ingest** with HNSW indexing once a provider is configured; a re-embedding job.
4. **Moderation tooling:** two-reviewer approval for high-risk procedures; diff view for corrections.
5. **Calibration dashboard:** per-failure-mode predicted vs confirmed rates; LR suggestions from outcome data.
6. **Follow-ups:** scheduled outcome follow-up (did the repair hold?) feeding `follow_up_status` and repeat-repair metrics.
7. **Notifications:** reminders and job status updates by email or push.
8. **Upload scanning:** antivirus for documents.

## Later (v2+) — toward the global network

Manufacturer integrations and verified documentation feeds; repair-shop networks and job hand-off; a public compatibility database with partner write access; repairability scoring derived from verified outcomes (difficulty, part availability, success rates); environmental-impact analysis once credible lifecycle data sources are integrated; predictive failure analysis from fleet and device-management integrations; industrial maintenance (work orders, asset hierarchies, lockout/tagout procedures); and new categories (vehicles, machinery, furniture, tools), which the schema already supports through categories, component types and templates.
