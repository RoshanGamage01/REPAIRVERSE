/**
 * Specialised AI operations. Each is a narrow, schema-constrained task — not a general chat prompt.
 * LLMs interpret and generate language; deterministic code decides permissions, safety,
 * compatibility, pricing and workflow.
 */
import { z } from 'zod';
import { runAI, type AIResult } from './orchestrator.js';
import { SAFETY_POLICY, UNTRUSTED_POLICY, wrapUntrusted } from './guard.js';
import type { ImageInput } from './provider.js';

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });

// ───────────── Product identification (multimodal) ─────────────
export const IdentificationSchema = z.object({
  category_slug: z.string().nullable(),
  brand: z.string().nullable(),
  manufacturer: z.string().nullable(),
  product_name: z.string().nullable(),
  model: z.string().nullable(),
  model_variants: z.array(z.string()),
  label_text: z.array(z.string()),
  visible_components: z.array(z.string()),
  physical_condition: z.string(),
  possible_damage: z.array(z.string()),
  observations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needs: z.array(z.string()),
});
export type AIIdentification = z.infer<typeof IdentificationSchema>;

export function identifyProduct(args: { images: ImageInput[]; text?: string; categorySlugs: string[]; userId?: string | null; identificationId: string }): Promise<AIResult<AIIdentification>> {
  const system = `You identify physical products for a repair platform from photos and text.
${UNTRUSTED_POLICY}
Rules: Report only what is visible or legible. Transcribe any label, model or serial text exactly into label_text.
If the model cannot be read, set model to null — do not guess from appearance. Confidence must reflect real uncertainty.
List in "needs" what extra input would make identification certain (e.g. "photo of the rating label").
category_slug must be one of: ${args.categorySlugs.join(', ')} or null.`;
  const user = `Identify this object.${args.text ? `\nUser description:\n${wrapUntrusted('user', args.text, 1000)}` : ''}`;
  return runAI({
    operation: 'product_identification',
    capability: 'multimodal',
    schema: IdentificationSchema,
    userId: args.userId,
    entity: { type: 'identification', id: args.identificationId },
    promptForHash: system + user,
    execute: (p, model) =>
      p.structured({
        model,
        system,
        user,
        images: args.images,
        schemaName: 'identification',
        jsonSchema: obj({
          category_slug: nullable(str),
          brand: nullable(str),
          manufacturer: nullable(str),
          product_name: nullable(str),
          model: nullable(str),
          model_variants: strArr,
          label_text: strArr,
          visible_components: strArr,
          physical_condition: str,
          possible_damage: strArr,
          observations: strArr,
          confidence: num,
          needs: strArr,
        }),
      }),
  });
}

// ───────────── Symptom extraction (reasoning) ─────────────
export const SymptomExtractionSchema = z.object({
  symptoms: z.array(z.object({ slug: z.string(), evidence_quote: z.string() })),
  unmatched_observations: z.array(z.string()),
  safety_flags: z.array(z.string()),
});

export async function extractSymptoms(args: { description: string; vocabulary: { slug: string; name: string }[]; userId?: string | null; sessionId: string }) {
  const system = `You map a user's description of a device problem onto a fixed symptom vocabulary.
${UNTRUSTED_POLICY}
Only use slugs from the vocabulary. Include a symptom only if the description affirmatively states it (respect negations).
evidence_quote must be an exact substring of the description. Put anything relevant that does not map into unmatched_observations.
safety_flags: note any hazard signals (burning smell, smoke, swollen battery, sparks, liquid damage while powered).`;
  const user = `Vocabulary:\n${args.vocabulary.map((v) => `- ${v.slug}: ${v.name}`).join('\n')}\n\nDescription:\n${wrapUntrusted('user', args.description, 4000)}`;
  const res = await runAI({
    operation: 'symptom_extraction',
    capability: 'reasoning',
    schema: SymptomExtractionSchema,
    userId: args.userId,
    entity: { type: 'diagnosis_session', id: args.sessionId },
    promptForHash: system + user,
    execute: (p, model) =>
      p.structured({
        model,
        system,
        user,
        schemaName: 'symptom_extraction',
        jsonSchema: obj({ symptoms: { type: 'array', items: obj({ slug: str, evidence_quote: str }) }, unmatched_observations: strArr, safety_flags: strArr }),
      }),
  });
  if (!res.ok) return res;
  // Post-validation: drop unknown slugs and quotes that do not appear in the input (hallucination guard).
  const allowed = new Set(args.vocabulary.map((v) => v.slug));
  const lower = args.description.toLowerCase();
  res.data.symptoms = res.data.symptoms.filter((s) => allowed.has(s.slug) && lower.includes(s.evidence_quote.toLowerCase().trim()));
  return res;
}

// ───────────── Grounded repair guide generation (reasoning) ─────────────
export const GuideSchema = z.object({
  knowledge_sufficient: z.boolean(),
  insufficiency_reason: z.string().nullable(),
  objective: z.string(),
  difficulty: z.number().int().min(1).max(5),
  estimated_minutes_min: z.number().int().nullable(),
  estimated_minutes_max: z.number().int().nullable(),
  tools: z.array(z.string()),
  safety_requirements: z.array(z.string()),
  preparation: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      expected_observation: z.string().nullable(),
      caution: z.string().nullable(),
      reference_ids: z.array(z.string()),
    }),
  ),
  verification: z.array(z.string()),
  reassembly: z.array(z.string()),
  alternatives: z.array(z.string()),
});
export type AIGuide = z.infer<typeof GuideSchema>;

export async function generateRepairGuide(args: {
  productName: string;
  failureModeName: string;
  failureModeDescription: string;
  references: { id: string; title: string; text: string }[];
  userId?: string | null;
  entityId: string;
}): Promise<AIResult<AIGuide>> {
  const system = `You write repair guides for REPAIRVERSE, grounded ONLY in the provided reference excerpts plus widely-known generic safe practice.
${SAFETY_POLICY}
${UNTRUSTED_POLICY}
For each step, reference_ids must list the IDs of excerpts that directly support it; use an empty list for generic practice not taken from a reference.
If the references are insufficient to write a trustworthy guide, set knowledge_sufficient=false, explain why, and keep steps to generic, non-invasive checks.`;
  const refs = args.references.map((r) => wrapUntrusted(`ref ${r.id}: ${r.title}`, r.text, 3000)).join('\n\n');
  const user = `Product: ${args.productName}\nSuspected failure (hypothesis, not confirmed): ${args.failureModeName}\n${args.failureModeDescription}\n\nReference excerpts (IDs in source attribute):\n${refs || '(none available)'}`;
  const res = await runAI({
    operation: 'repair_guide_generation',
    capability: 'reasoning',
    schema: GuideSchema,
    userId: args.userId,
    entity: { type: 'failure_mode', id: args.entityId },
    promptForHash: system + user,
    execute: (p, model) =>
      p.structured({
        model,
        system,
        user,
        schemaName: 'repair_guide',
        jsonSchema: obj({
          knowledge_sufficient: { type: 'boolean' },
          insufficiency_reason: nullable(str),
          objective: str,
          difficulty: { type: 'integer' },
          estimated_minutes_min: nullable({ type: 'integer' }),
          estimated_minutes_max: nullable({ type: 'integer' }),
          tools: strArr,
          safety_requirements: strArr,
          preparation: strArr,
          steps: { type: 'array', items: obj({ title: str, body: str, expected_observation: nullable(str), caution: nullable(str), reference_ids: strArr }) },
          verification: strArr,
          reassembly: strArr,
          alternatives: strArr,
        }),
      }),
  });
  if (!res.ok) return res;
  // Citation integrity: strip any reference id the model invented.
  const valid = new Set(args.references.map((r) => r.id));
  for (const s of res.data.steps) s.reference_ids = s.reference_ids.filter((id) => valid.has(id));
  return res;
}

// ───────────── Knowledge extraction from documents (reasoning) ─────────────
export const ExtractionSchema = z.object({
  items: z.array(
    z.object({
      item_type: z.enum(['failure_mode', 'symptom_link', 'repair_procedure', 'product_spec', 'component', 'compatibility']),
      summary: z.string(),
      fields: z.array(z.object({ key: z.string(), value: z.string() })),
      supporting_quote: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export async function extractKnowledge(args: { chunkText: string; sourceTitle: string; chunkId: string; userId?: string | null }) {
  const system = `You extract structured repair knowledge from a technical document excerpt for human review.
${UNTRUSTED_POLICY}
Extract only facts explicitly stated in the excerpt. supporting_quote must be copied verbatim from the excerpt.
Do not infer values that are not written. Output an empty items list if nothing qualifies.`;
  const user = `Source: ${args.sourceTitle}\n${wrapUntrusted('document', args.chunkText, 8000)}`;
  const res = await runAI({
    operation: 'knowledge_extraction',
    capability: 'reasoning',
    schema: ExtractionSchema,
    userId: args.userId,
    entity: { type: 'document_chunk', id: args.chunkId },
    promptForHash: system + user,
    execute: (p, model) =>
      p.structured({
        model,
        system,
        user,
        schemaName: 'knowledge_extraction',
        jsonSchema: obj({
          items: {
            type: 'array',
            items: obj({
              item_type: { type: 'string', enum: ['failure_mode', 'symptom_link', 'repair_procedure', 'product_spec', 'component', 'compatibility'] },
              summary: str,
              fields: { type: 'array', items: obj({ key: str, value: str }) },
              supporting_quote: str,
              confidence: num,
            }),
          },
        }),
      }),
  });
  if (!res.ok) return res;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = norm(args.chunkText);
  res.data.items = res.data.items.filter((i) => i.supporting_quote.length > 8 && hay.includes(norm(i.supporting_quote)));
  return res;
}

// ───────────── Technician copilot (reasoning, retrieval-grounded) ─────────────
export const CopilotSchema = z.object({
  answer: z.string(),
  knowledge_available: z.boolean(),
  cited_reference_ids: z.array(z.string()),
  suggested_checks: z.array(z.string()),
  alternative_explanations: z.array(z.string()),
});

export async function copilotAnswer(args: { question: string; context: string; references: { id: string; title: string; text: string }[]; userId?: string | null; entityId: string | null }) {
  const system = `You are the REPAIRVERSE professional diagnostic copilot for qualified repair technicians.
${SAFETY_POLICY}
${UNTRUSTED_POLICY}
Ground claims in the reference excerpts and cite their IDs. Mark anything not supported by references as your own reasoning.
Distinguish hypotheses from confirmed findings. If references do not cover the question, set knowledge_available=false.`;
  const refs = args.references.map((r) => wrapUntrusted(`ref ${r.id}: ${r.title}`, r.text, 2500)).join('\n\n');
  const user = `Job context:\n${wrapUntrusted('job', args.context, 3000)}\n\nQuestion:\n${wrapUntrusted('technician', args.question, 2000)}\n\nReferences:\n${refs || '(none)'}`;
  const res = await runAI({
    operation: 'technician_copilot',
    capability: 'reasoning',
    schema: CopilotSchema,
    userId: args.userId,
    entity: { type: 'repair_job', id: args.entityId },
    promptForHash: system + user,
    execute: (p, model) =>
      p.structured({
        model,
        system,
        user,
        schemaName: 'copilot',
        jsonSchema: obj({ answer: str, knowledge_available: { type: 'boolean' }, cited_reference_ids: strArr, suggested_checks: strArr, alternative_explanations: strArr }),
      }),
  });
  if (!res.ok) return res;
  const valid = new Set(args.references.map((r) => r.id));
  res.data.cited_reference_ids = res.data.cited_reference_ids.filter((id) => valid.has(id));
  return res;
}

// ───────────── Embeddings & transcription ─────────────
export function embedTexts(texts: string[], entity: { type: string; id: string | null }) {
  return runAI({
    operation: 'embedding',
    capability: 'embedding',
    schema: z.object({ vectors: z.array(z.array(z.number()).length(1536)) }),
    entity,
    execute: async (p, model) => {
      const r = await p.embed({ model, input: texts });
      return { data: { vectors: r.vectors }, usage: r.usage };
    },
  });
}

export function transcribeAudio(args: { audio: Buffer; mime: string; userId?: string | null }) {
  return runAI({
    operation: 'speech_transcription',
    capability: 'transcription',
    schema: z.object({ text: z.string().max(20000) }),
    userId: args.userId,
    execute: async (p, model) => {
      const r = await p.transcribe({ model, audio: args.audio, mime: args.mime, filename: 'audio.webm' });
      return { data: { text: r.text }, usage: r.usage };
    },
  });
}
