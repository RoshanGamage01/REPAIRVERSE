import { createHash } from 'node:crypto';
import type { AICapability } from '@repairverse/shared';
import type { ZodTypeAny, z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { getProvider, ProviderError, type AIProvider, type AIUsage } from './provider.js';

export const DEFAULT_MODELS: Record<AICapability, { provider: string; model: string; input: number; output: number }> = {
  multimodal: { provider: 'openai', model: 'gpt-4o', input: 2.5, output: 10 },
  reasoning: { provider: 'openai', model: 'gpt-4o', input: 2.5, output: 10 },
  embedding: { provider: 'openai', model: 'text-embedding-3-small', input: 0.02, output: 0 },
  transcription: { provider: 'openai', model: 'whisper-1', input: 0, output: 0 },
};

export interface ModelConfig {
  capability: AICapability;
  provider: string;
  model: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  enabled: boolean;
}

export async function getModelConfig(capability: AICapability): Promise<ModelConfig> {
  const row = await one('SELECT * FROM ai_model_config WHERE capability = $1', [capability]);
  const d = DEFAULT_MODELS[capability];
  return row
    ? { capability, provider: row.provider, model: row.model, inputCostPerMTok: row.input_cost_per_mtok, outputCostPerMTok: row.output_cost_per_mtok, enabled: row.enabled }
    : { capability, provider: d.provider, model: d.model, inputCostPerMTok: d.input, outputCostPerMTok: d.output, enabled: true };
}

export async function aiAvailability(): Promise<Record<AICapability, { configured: boolean; enabled: boolean; provider: string; model: string }>> {
  const out: any = {};
  for (const c of Object.keys(DEFAULT_MODELS) as AICapability[]) {
    const cfg = await getModelConfig(c);
    const p = getProvider(cfg.provider);
    out[c] = { configured: !!p?.isConfigured(), enabled: cfg.enabled, provider: cfg.provider, model: cfg.model };
  }
  return out;
}

export type AIResult<T> =
  | { ok: true; data: T; operationId: string; model: string }
  | { ok: false; reason: 'not_configured' | 'disabled' | 'budget_exceeded' | 'validation_failed' | 'provider_error'; message: string; operationId?: string };

async function monthSpend(): Promise<number> {
  const r = await one(`SELECT coalesce(sum(cost_usd),0) AS s FROM ai_operations WHERE created_at >= date_trunc('month', now())`);
  return Number(r?.s ?? 0);
}

async function record(op: {
  operation: string;
  capability: AICapability;
  provider: string;
  model: string;
  status: string;
  usage?: AIUsage;
  cost?: number;
  latencyMs?: number;
  promptHash?: string;
  validationErrors?: unknown;
  error?: string;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<string> {
  const row = await one(
    `INSERT INTO ai_operations(operation, capability, provider, model, status, input_tokens, output_tokens, cost_usd, latency_ms, prompt_hash, validation_errors, error, user_id, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      op.operation,
      op.capability,
      op.provider,
      op.model,
      op.status,
      op.usage?.inputTokens ?? 0,
      op.usage?.outputTokens ?? 0,
      op.cost ?? 0,
      op.latencyMs ?? 0,
      op.promptHash ?? null,
      op.validationErrors ? JSON.stringify(op.validationErrors) : null,
      op.error ?? null,
      op.userId ?? null,
      op.entityType ?? null,
      op.entityId ?? null,
    ],
  );
  return row!.id;
}

/**
 * Execute one AI operation with full governance:
 * provider resolution → enabled/budget checks → call (with one retry on transient errors)
 * → zod validation of the output → cost accounting → ai_operations audit record.
 */
export async function runAI<S extends ZodTypeAny>(opts: {
  operation: string;
  capability: AICapability;
  schema: S;
  userId?: string | null;
  entity?: { type: string; id: string | null };
  promptForHash?: string;
  execute: (provider: AIProvider, model: string) => Promise<{ data: unknown; usage: AIUsage }>;
}): Promise<AIResult<z.infer<S>>> {
  const cfg = await getModelConfig(opts.capability);
  const provider = getProvider(cfg.provider);
  const base = { operation: opts.operation, capability: opts.capability, provider: cfg.provider, model: cfg.model, userId: opts.userId, entityType: opts.entity?.type, entityId: opts.entity?.id };
  if (!provider || !provider.isConfigured()) {
    return { ok: false, reason: 'not_configured', message: `AI ${opts.capability} capability is not configured (provider "${cfg.provider}"). Set the provider API key to enable it.` };
  }
  if (!cfg.enabled) return { ok: false, reason: 'disabled', message: `AI ${opts.capability} capability is disabled by an administrator.` };
  if ((await monthSpend()) >= config.AI_MONTHLY_BUDGET_USD) {
    const id = await record({ ...base, status: 'failed', error: 'monthly AI budget exceeded' });
    return { ok: false, reason: 'budget_exceeded', message: 'The monthly AI budget has been reached.', operationId: id };
  }
  const promptHash = opts.promptForHash ? createHash('sha256').update(opts.promptForHash).digest('hex').slice(0, 32) : undefined;
  const started = Date.now();
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, usage } = await opts.execute(provider, cfg.model);
      const cost = (usage.inputTokens * cfg.inputCostPerMTok + usage.outputTokens * cfg.outputCostPerMTok) / 1_000_000;
      const parsed = opts.schema.safeParse(data);
      if (!parsed.success) {
        const id = await record({ ...base, status: 'rejected_by_validation', usage, cost, latencyMs: Date.now() - started, promptHash, validationErrors: parsed.error.flatten() });
        return { ok: false, reason: 'validation_failed', message: 'AI output failed validation and was discarded.', operationId: id };
      }
      const id = await record({ ...base, status: 'succeeded', usage, cost, latencyMs: Date.now() - started, promptHash });
      return { ok: true, data: parsed.data, operationId: id, model: cfg.model };
    } catch (e) {
      lastErr = e as Error;
      if (!(e instanceof ProviderError && e.retryable) || attempt === 1) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  logger.warn({ op: opts.operation, err: lastErr?.message }, 'AI operation failed');
  const id = await record({ ...base, status: 'failed', latencyMs: Date.now() - started, promptHash, error: lastErr?.message?.slice(0, 1000) });
  return { ok: false, reason: 'provider_error', message: 'The AI provider returned an error. The deterministic knowledge engine was used instead.', operationId: id };
}

export async function aiUsageSummary(days = 30) {
  return query(
    `SELECT date_trunc('day', created_at)::date AS day, operation, status, count(*)::int AS calls,
            sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens, sum(cost_usd)::float AS cost_usd,
            avg(latency_ms)::int AS avg_latency_ms
       FROM ai_operations WHERE created_at >= now() - ($1 || ' days')::interval
      GROUP BY 1,2,3 ORDER BY 1 DESC, 2`,
    [String(days)],
  );
}
