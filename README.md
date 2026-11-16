# REPAIRVERSE

**The Repair Intelligence Platform.** Point a camera at a physical object and start understanding it: what it is, what's inside, what might be broken and why, whether it's safe and worth repairing, which parts fit, and how to fix it. Then every verified repair makes the next diagnosis smarter.

REPAIRVERSE is not a chatbot with a camera. Its core is a **repair knowledge graph** (products → components → failure modes → symptoms → diagnostic tests → procedures → parts → sources → outcomes) and a **deterministic Bayesian diagnosis engine**. Its job is to make the platform honest about what it knows, and to make that knowledge grow from real repair outcomes. LLMs interpret and write; they never decide what is safe, compatible, priced or true.

## What's in v1

| Experience | Highlights |
|---|---|
| **Consumer app** | Camera/photo/video/barcode/model/text identification that asks for more instead of guessing · voice and text problem description · interactive diagnostic wizard (information-gain question selection, editable journey, explainable hypotheses, residual "unknown cause") · repair guides with per-step provenance and a stop-and-seek-professional mechanism · repair-vs-replace · parts discovery with confirmed/potential/incompatible evidence · product profiles with component explorer · device library, timeline, reminders, export |
| **Professional workspace** | Repair jobs with an enforced status workflow · intake photos · AI-assisted diagnosis kept separate from technician-confirmed findings · quotes · work log · replaced components · tests · reports · retrieval-grounded copilot · outcome → anonymised knowledge contribution · reputation · verification |
| **Knowledge network** | Public product profiles · contributions + moderation · confidence from source reliability, independent corroboration and sample size · document ingestion → side-by-side review → cited knowledge · outcome learning |
| **Admin** | Metrics for all success indicators · knowledge curation · moderation · verification · users · AI configuration, usage and cost · API clients · health, queue and audit logs |
| **Developer API** | `/api/public/v1` with scoped API keys, rate limits, quotas, usage logging and an OpenAPI 3.1 document |

## Quick start (local)

Requirements: Node ≥ 20, pnpm 10, PostgreSQL 16 with `postgis`, `vector` and `pg_trgm` available, and optionally Redis and ffmpeg (for video keyframes).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
createdb repairverse
```

```bash
pnpm db:reset
```

```bash
pnpm dev
```

`pnpm db:reset` migrates and seeds the taxonomy plus the labelled demonstration data. `pnpm dev` starts the API on `:4000` (with the background worker in-process) and the web app on `:5173`.

Open http://localhost:5173. Demo accounts (demo data only):

| Role | Email | Password |
|---|---|---|
| Consumer | `demo@repairverse.dev` | `demo-password-123` |
| Technician (unverified until an admin approves) | `tech@repairverse.dev` | `demo-password-123` |
| Admin | `admin@repairverse.dev` | `admin-password-123` (set `ADMIN_PASSWORD`) |

Try the black-screen journey: on Home, choose **I know the model number**, enter `AR14-23`, select **Identify it**, confirm, and describe *"My laptop turns on, but the screen stays black. The keyboard lights are working."* Or enter barcode `2000000000015`.

### AI providers (optional)

Set `OPENAI_API_KEY` to enable photo identification, AI symptom interpretation, grounded guide generation, document knowledge extraction, embeddings, the copilot and voice transcription. Models are configurable per capability in **Admin → AI Configuration**. Without a key every workflow still works through the deterministic engines, and AI features say they need configuration; they never fake output.

## Production (Docker)

Copy the environment template:

```bash
cp .env.example .env
```

Then set `APP_SECRET` and `ADMIN_PASSWORD` in `.env` (and `OPENAI_API_KEY` if wanted). Build and start the stack:

```bash
docker compose up -d --build
```

Seed the taxonomy and admin account (add `SEED_DEMO=true` for demo data):

```bash
docker compose run --rm api node dist/seed.js
```

The stack runs PostgreSQL (pgvector + PostGIS), Redis, MinIO (S3-compatible storage), the API (which also serves the web app), a separate worker, and daily database backups with retention. Migrations run automatically on start.

## Tests

```bash
pnpm test
```

Tests run against PostgreSQL; set `TEST_DATABASE_URL`, which defaults to `postgres://postgres:postgres@localhost:5432/repairverse_test`.

- `packages/shared`: the safety classifier and job state machine.
- `apps/api/test/unit`: the diagnosis, compatibility, repair-decision, confidence/reputation, symptom-matching and injection-guard engines.
- `apps/api/test/integration`: **acceptance scenarios A–D** end to end, an all-endpoint smoke test across four roles, and AI-governance tests with a scripted provider.

## Repository layout

```
packages/shared   Domain vocabulary, safety classifier, job state machine, zod contracts
apps/api          Express + TypeScript modular monolith, engines, AI layer, queue, migrations, tests
apps/web          React + Vite + Tailwind + React Query (consumer, pro, admin)
docs/             Design documentation
infra/            Database init and backup scripts
```

## Documentation

- [Product specification](docs/PRODUCT_SPECIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [API specification](docs/API_SPECIFICATION.md)
- [AI architecture](docs/AI_ARCHITECTURE.md)
- [Security and safety](docs/SECURITY_AND_SAFETY.md)
- [Implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md)

## About the demonstration data

Every product in the demo dataset ("Demo Devices" Aurora 14, Nimbus X5, Lumen 55, BrewMate) is **fictional**. The demo failure knowledge encodes general, widely taught repair heuristics so workflows can be exercised, but it is **not verified**. It is flagged in the database, in the API (`isDemo`) and in the UI. Production deployments seed no demo data unless `SEED_DEMO=true`. REPAIRVERSE never fabricates prices, specifications, compatibility or statistics: offers come only from configured providers or verified manual entry, and statistics are withheld below the minimum sample size.
