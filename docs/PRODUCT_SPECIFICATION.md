# Product specification — REPAIRVERSE v1

**Mission:** make physical objects understandable, diagnosable and repairable, and get measurably smarter with every real repair.

**North-star metric:** successful repairs supported by trustworthy knowledge. We do **not** optimise for chatbot engagement.

## Personas

| Persona | Needs | Surface |
|---|---|---|
| **Consumer** ("my laptop's screen is black") | Understand what's wrong, whether it's safe/worth fixing, which part fits | Consumer app |
| **Repair technician / shop** | Fast diagnosis, job tracking, quotes, reports, credit for knowledge | Professional workspace |
| **Moderator / knowledge curator** | Review contributions and AI extractions against sources | Admin |
| **Administrator** | Users, verification, AI cost and configuration, system health | Admin |
| **Developer / partner** | Programmatic product, failure, compatibility and diagnosis data | Developer API |

## Experience map (v1, all implemented)

### Consumer
1. **Home**: the primary action "What's broken? Let's figure it out." with camera capture, upload (photos/video), barcode/QR scan (BarcodeDetector), text and model number.
2. **Identify**: candidate products with identification confidence and the evidence behind each match. Asks for more information instead of guessing. Correction search, stored as structured knowledge. Variant selection. Save to My Devices. Category-only fallback.
3. **Describe**: free text, voice (transcription), symptom chips, photos/video, device link.
4. **Diagnose (wizard)**: journey strip (Symptoms → Questions → Tests → Observations → Diagnosis); next-best question or safe test with "why we ask"; editable past answers; removable symptoms; ranked hypotheses with relative likelihood, supporting and contradicting evidence, missing information, recommended tests, tools, safety, complexity and sources; the residual "unknown cause" share; a printable structured diagnostic report; save to history.
5. **Repair guide**: stored procedures with per-step provenance (manufacturer / expert / verified record / community / AI / demo), tools, parts (linked to compatibility), safety, preparation, step checklist with expected observations, verification and reassembly. An optional grounded AI guide. A **stop-and-seek-professional** mechanism, and high-risk steps withheld.
6. **Repair vs replace**: four-way recommendation with transparent factors, cost origins, missing information and caveats.
7. **Parts**: search by name, part number or product + component; confirmed / potential / unknown / incompatible groups with evidence and attribute checks; sourced offers only.
8. **Product intelligence profiles**: public, with the component explorer, specs with sources, failure patterns, procedures, statistics only when the sample is sufficient, compatible parts and sources.
9. **My Devices**: device timeline, maintenance, receipts, warranty, reminders, costs, export (JSON/CSV). **History** and **Saved knowledge**.
10. **Technician directory**: geographic search; verification shown only when verified.

### Professional
Overview pipeline; job lifecycle with an enforced state machine (Received → Inspecting → Diagnosing → Waiting for approval → Waiting for parts → In repair → Testing → Completed → Delivered / Cancelled); intake and photos; AI-assisted diagnosis recorded as **AI suggestions**, distinct from technician findings and **confirmed diagnoses**; quotes with customer quotation; parts; work log; replaced components; final tests; close with outcome and anonymised contribution; repair report; retrieval-grounded copilot; product, part and compatibility registration; contributions and reputation; business settings, technician profile and verification requests.

### Admin
Overview with work queues and success metrics; knowledge network (failure modes, probes, procedures, sources, citations, ingestion, side-by-side extraction review); products; components and parts; repair outcomes and diagnostic accuracy; contribution moderation and reports; technician verification; users and organizations; AI configuration, usage and cost; API clients; system health, background jobs and dead-letter retry, audit logs.

### Developer
Self-serve API keys with scopes, usage, revocation; OpenAPI 3.1 document; see [API_SPECIFICATION.md](API_SPECIFICATION.md).

## Acceptance scenarios

All four are automated as integration tests in `apps/api/test/integration/`:

| Scenario | Test |
|---|---|
| A — Consumer repair (register → photo → identify/request info → black screen → hypotheses → answers update → safe recommendation → parts → saved) | `scenarioA_consumer.test.ts` |
| B — Technician repair (register → job → device → symptoms → AI assist → confirm → repair → replaced → testing → outcome contribution) | `scenarioB_technician.test.ts` |
| C — Knowledge network (product → components → failure → procedure → sources → contribution → review → public → API) | `scenarioC_D_knowledge.test.ts` |
| D — Part compatibility (identify → component → search → check → confirmed vs unverified → evidence) | `scenarioC_D_knowledge.test.ts` |

## Success metrics (instrumented, Admin → Overview)

Identification success rate, identification correction rate, diagnostic completion rate, diagnostic accuracy vs confirmed outcomes, repair success rate, repair guide → completed repair, parts compatibility confidence, technician contribution rate, knowledge approval rate, repeat repair incidents, AI cost per diagnosis, AI cost per completed repair workflow, and the share of recommendations with supporting sources. Each metric is reported with its numerator, denominator and definition, and shows "—" when there is no data rather than a fabricated number.

## Non-goals for v1

Marketplace transactions, payments and billing, native mobile apps, real manufacturer integrations (provider interfaces exist), predictive failure analytics.
