# AI architecture

## Philosophy

LLMs **interpret** (free text, photos, documents) and **generate language** (guides, copilot answers). They do not decide what is safe, what is compatible, what something costs, who may do what, or what is true. Those decisions are deterministic code over the knowledge graph. With no AI provider configured, REPAIRVERSE still identifies (by identifiers, fuzzy model match and learned corrections), diagnoses (lexical symptom matching plus the Bayesian engine), checks compatibility, decides repair-vs-replace, ingests documents (rule-based extraction) and retrieves knowledge (full-text). Each AI feature reports `not_configured` instead of pretending.

## Provider abstraction (`src/ai/provider.ts`)

```ts
interface AIProvider {
  structured(req: { model, system, user, images?, schemaName, jsonSchema }): Promise<{ data, usage }>;
  embed(req: { model, input[] }): Promise<{ vectors, usage }>;
  transcribe(req: { model, audio, mime }): Promise<{ text, usage }>;
}
```

`OpenAIProvider` implements this over plain `fetch` (Chat Completions with strict JSON-schema structured output, Embeddings at 1536 dimensions, Audio Transcriptions). Other providers register with `registerProvider()`. The capability-to-provider/model mapping lives in `ai_model_config` and is editable in **Admin → AI Configuration**:

| Capability | Default model | Used for |
|---|---|---|
| `multimodal` | gpt-4o | Product identification from photos and video keyframes |
| `reasoning` | gpt-4o | Symptom extraction, guide generation, knowledge extraction, copilot |
| `embedding` | text-embedding-3-small | Semantic retrieval |
| `transcription` | whisper-1 | Voice input |

## Orchestrator (`src/ai/orchestrator.ts`)

`runAI({ operation, capability, schema, execute })`:

1. Resolve the provider and model; return `not_configured` or `disabled` if needed.
2. Enforce `AI_MONTHLY_BUDGET_USD` against `ai_operations` spend.
3. Execute, retrying a retryable `ProviderError` once.
4. **Validate with zod**; on failure the output is discarded and recorded as `rejected_by_validation`.
5. Compute cost from configured per-MTok prices.
6. Persist an `ai_operations` row: operation, model, tokens, cost, latency, prompt hash (not the prompt), linked entity, status and error.

## Operations (`src/ai/operations.ts`)

| Operation | Output contract | Post-validation |
|---|---|---|
| `product_identification` | category, brand, product, model (null if unreadable), verbatim label text, visible components, condition, damage, confidence, what's needed | Label text goes through deterministic `modelTokens()` and exact identifier lookup. AI never "confirms" — the user does |
| `symptom_extraction` | symptom slugs from a fixed vocabulary + verbatim evidence quotes + safety flags | Unknown slugs dropped; quotes must be substrings of the input |
| `repair_guide_generation` | grounded steps with `reference_ids`, knowledge-sufficiency flag | Invented reference IDs stripped; output re-run through the safety classifier and withheld if it escalates to high risk for this viewer |
| `knowledge_extraction` | typed items with verbatim supporting quotes | Quote must appear in the chunk; items go to human review only |
| `technician_copilot` | answer, cited reference IDs, checks, alternatives | Citations restricted to retrieved references |
| `embedding`, `speech_transcription` | vectors / text | Dimension and length checks |

## Diagnosis flow

```
description ──► lexical matcher ─┐
            └─► AI extraction ───┴─► symptom observations ─► Bayesian engine ◄─ probe answers
                                                                │
                         ranked hypotheses + next best probe (information gain) + evidence trail
                                                                │
                       guide: stored procedures ► (optional) grounded AI guide ► safety gate
```

## Retrieval (RAG) (`modules/knowledge/retrieval.ts`)

Sources ranked by relevance:

1. **Citations** attached directly to the graph entities in question.
2. **Approved document chunks**, scored by PostgreSQL full-text rank.
3. **pgvector cosine similarity**, when embeddings exist.

Scores are blended and weighted by source reliability tier. Only chunks a reviewer has **approved** are eligible, and retracted sources are excluded. References carry stable IDs (`chunk:<uuid>`, `cite:<uuid>`) that models must cite. If nothing relevant is retrieved, the model is told so and must set `knowledge_sufficient=false` / `knowledge_available=false`.

## Prompt-injection defences (`src/ai/guard.ts`)

1. **Detection:** pattern scan of documents and inputs (instruction overrides, role changes, exfiltration, fake delimiters, "mark as verified"). Flags are stored on `documents.injection_flags` and shown to reviewers.
2. **Isolation:** untrusted text is wrapped in `<untrusted source="…">` blocks with delimiter look-alikes and bidi/control characters removed. System prompts state that block content is data only.
3. **Containment:** strict JSON schemas; post-validation (quotes, slugs, citation IDs); extracted knowledge is never applied without human approval; chunks are not used for grounding until approved.

## Evaluation

- `test/integration/ai.test.ts` exercises the governance layer with a scripted provider: hallucinated slugs and quotes filtered, invented citations stripped, schema-invalid output rejected and audited, cost recorded, photo identification via label text.
- `repair_outcomes.top_hypothesis_correct` measures diagnostic accuracy against technician-confirmed failures (Admin → Metrics). It is the primary signal for tuning priors, probes and prompts.
