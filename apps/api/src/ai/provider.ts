/**
 * Model-provider abstraction. Application code never calls a vendor SDK directly;
 * it goes through `runAI` (orchestrator.ts), which resolves the configured provider/model
 * per capability, enforces budgets, validates output and records an auditable operation.
 */
import { config } from '../config.js';

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ImageInput {
  mime: string;
  data: Buffer;
}

export interface StructuredRequest {
  model: string;
  system: string;
  user: string;
  images?: ImageInput[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  temperature?: number;
}

export interface AIProvider {
  readonly name: string;
  isConfigured(): boolean;
  structured(req: StructuredRequest): Promise<{ data: unknown; usage: AIUsage }>;
  embed(req: { model: string; input: string[] }): Promise<{ vectors: number[][]; usage: AIUsage }>;
  transcribe(req: { model: string; audio: Buffer; mime: string; filename: string }): Promise<{ text: string; usage: AIUsage }>;
}

export class ProviderError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  constructor(private apiKey = config.OPENAI_API_KEY, private baseUrl = config.OPENAI_BASE_URL) {}

  isConfigured() {
    return !!this.apiKey;
  }

  private async call(path: string, init: RequestInit): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError(`OpenAI ${path} failed: ${res.status} ${body.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    }
    return res.json();
  }

  async structured(req: StructuredRequest) {
    const content: any[] = [{ type: 'text', text: req.user }];
    for (const img of req.images ?? []) {
      content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data.toString('base64')}`, detail: 'high' } });
    }
    const json = await this.call('/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature ?? 0.2,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content },
        ],
        response_format: { type: 'json_schema', json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema } },
      }),
    });
    const text = json.choices?.[0]?.message?.content;
    if (json.choices?.[0]?.message?.refusal) throw new ProviderError(`Model refused: ${json.choices[0].message.refusal}`);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderError('Model returned non-JSON output');
    }
    return { data, usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 } };
  }

  async embed(req: { model: string; input: string[] }) {
    const json = await this.call('/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, input: req.input, dimensions: 1536 }),
    });
    return { vectors: json.data.map((d: any) => d.embedding), usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: 0 } };
  }

  async transcribe(req: { model: string; audio: Buffer; mime: string; filename: string }) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(req.audio)], { type: req.mime }), req.filename);
    form.append('model', req.model);
    const json = await this.call('/audio/transcriptions', { method: 'POST', body: form });
    // Transcription is billed per minute; token usage is not reported. Cost is tracked via config.
    return { text: String(json.text ?? ''), usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

const providers = new Map<string, AIProvider>([['openai', new OpenAIProvider()]]);
let override: AIProvider | null = null;

export function getProvider(name: string): AIProvider | null {
  if (override) return override;
  return providers.get(name) ?? null;
}

export function registerProvider(p: AIProvider) {
  providers.set(p.name, p);
}

/** Test hook: route all AI calls to a scripted provider. */
export function setProviderOverride(p: AIProvider | null) {
  override = p;
}
