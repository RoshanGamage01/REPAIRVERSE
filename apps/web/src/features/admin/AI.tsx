import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, KeyRound } from 'lucide-react';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorNote, Field, Input, Notice, PageHeader, Section, Skeleton, Stat, Table, Tabs, Td } from '../../ui';
import { Bars, STATUS_TONE, useAction } from './common';

const CAP_LABEL: Record<string, string> = {
  multimodal: 'Multimodal analysis (photos, labels)',
  reasoning: 'Reasoning (symptom interpretation, guides, extraction, copilot)',
  embedding: 'Embeddings (semantic retrieval)',
  transcription: 'Speech transcription (voice input)',
};

function CapabilityCard({ row, availability }: { row: any; availability: any }) {
  const [f, setF] = useState({ provider: row.provider, model: row.model, inputCostPerMTok: String(row.input_cost_per_mtok), outputCostPerMTok: String(row.output_cost_per_mtok), enabled: row.enabled });
  useEffect(() => setF({ provider: row.provider, model: row.model, inputCostPerMTok: String(row.input_cost_per_mtok), outputCostPerMTok: String(row.output_cost_per_mtok), enabled: row.enabled }), [row]);
  const save = useAction(() => api.put(`/admin/ai/config/${row.capability}`, { ...f, inputCostPerMTok: Number(f.inputCostPerMTok), outputCostPerMTok: Number(f.outputCostPerMTok) }), { success: 'Configuration saved', invalidate: [['admin-ai-config']] });
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="eyebrow">{row.capability}</div>
          <div className="font-semibold">{CAP_LABEL[row.capability]}</div>
        </div>
        {availability?.configured ? <Badge tone={f.enabled ? 'ok' : 'neutral'}>{f.enabled ? 'Active' : 'Disabled'}</Badge> : <Badge tone="warn" icon={<KeyRound className="h-3 w-3" />}>Not configured</Badge>}
      </div>
      {!availability?.configured && (
        <Notice tone="warn">Provider "{row.provider}" has no credentials. Set <code className="font-mono">OPENAI_API_KEY</code> in the API environment to enable this capability. Until then REPAIRVERSE uses its deterministic knowledge engine and labels AI features as unavailable — it never fabricates AI output.</Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider"><Input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="Model"><Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
        <Field label="Input cost / 1M tokens (USD)"><Input inputMode="decimal" value={f.inputCostPerMTok} onChange={(e) => setF({ ...f, inputCostPerMTok: e.target.value })} /></Field>
        <Field label="Output cost / 1M tokens (USD)"><Input inputMode="decimal" value={f.outputCostPerMTok} onChange={(e) => setF({ ...f, outputCostPerMTok: e.target.value })} /></Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Checkbox label="Enabled" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
      </div>
    </Card>
  );
}

export default function AdminAI() {
  const [tab, setTab] = useState<'config' | 'usage' | 'content'>('config');
  const cfg = useQuery({ queryKey: ['admin-ai-config'], queryFn: () => api.get('/admin/ai/config') });
  const usage = useQuery({ queryKey: ['admin-ai-usage'], queryFn: () => api.get('/admin/ai/usage?days=30'), enabled: tab === 'usage' });
  const content = useQuery({ queryKey: ['admin-ai-content'], queryFn: () => api.get('/admin/ai/content'), enabled: tab === 'content' });
  const daily = Object.values(
    (usage.data?.daily ?? []).reduce((acc: any, d: any) => {
      const k = String(d.day).slice(0, 10);
      acc[k] = { label: k, value: (acc[k]?.value ?? 0) + Number(d.cost_usd ?? 0) };
      return acc;
    }, {}),
  ).sort((a: any, b: any) => a.label.localeCompare(b.label)) as { label: string; value: number }[];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="AI governance" title="AI configuration" description="Provider-independent models per capability. Every AI operation is schema-validated, budgeted and recorded with its cost." />
      <Tabs tabs={[{ value: 'config', label: 'Models' }, { value: 'usage', label: 'Usage & cost' }, { value: 'content', label: 'AI-generated content' }]} value={tab} onChange={setTab} />
      <ErrorNote error={cfg.error ?? usage.error ?? content.error} />
      {tab === 'config' && (
        <>
          {cfg.isLoading && <Skeleton className="h-64" />}
          {cfg.data && (
            <Card className="space-y-2">
              <div className="text-sm font-medium">Monthly AI budget: ${cfg.data.monthlyBudgetUsd}</div>
              <p className="text-xs text-ink-muted">Set with AI_MONTHLY_BUDGET_USD. When reached, AI calls are refused and the deterministic engine continues to work.</p>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-2">{cfg.data?.config.map((r: any) => <CapabilityCard key={r.capability} row={r} availability={cfg.data.availability[r.capability]} />)}</div>
        </>
      )}
      {tab === 'usage' && usage.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Calls (30d)" value={usage.data.totals.calls} />
            <Stat label="Cost (30d)" value={`$${usage.data.totals.cost.toFixed(4)}`} />
            <Stat label="Tokens in/out" value={`${usage.data.totals.input_tokens}/${usage.data.totals.output_tokens}`} />
            <Stat label="Rejected by validation" value={usage.data.totals.rejected} tone={usage.data.totals.rejected ? 'warn' : undefined} />
            <Stat label="Failed" value={usage.data.totals.failed} tone={usage.data.totals.failed ? 'warn' : undefined} />
          </div>
          <Card className="space-y-3">
            <h3 className="font-semibold">Daily cost</h3>
            <Bars data={daily} format={(n) => `$${n.toFixed(4)}`} />
          </Card>
          <Section title="Recent operations">
            {usage.data.recent.length === 0 ? (
              <EmptyState icon={<Bot className="h-8 w-8" />} title="No AI operations yet" />
            ) : (
              <Table head={['Operation', 'Status', 'Model', 'Tokens', 'Cost', 'Latency', 'When']}>
                {usage.data.recent.map((o: any) => (
                  <tr key={o.id}>
                    <Td><div className="font-medium">{o.operation}</div><div className="text-xs text-ink-muted">{o.entity_type}</div>{o.error && <div className="max-w-xs text-xs text-danger">{o.error}</div>}</Td>
                    <Td><Badge tone={STATUS_TONE[o.status]}>{o.status.replace(/_/g, ' ')}</Badge></Td>
                    <Td className="font-mono text-xs">{o.model}</Td>
                    <Td className="tabular-nums">{o.input_tokens}/{o.output_tokens}</Td>
                    <Td className="tabular-nums">${Number(o.cost_usd).toFixed(5)}</Td>
                    <Td className="tabular-nums">{o.latency_ms} ms</Td>
                    <Td className="text-ink-muted">{relative(o.created_at)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </div>
      )}
      {tab === 'content' && content.data && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Extracted knowledge awaiting review ({content.data.extracted.length})</h3>
              <Link to="/admin/knowledge?tab=review"><Button size="sm" variant="secondary">Open review</Button></Link>
            </div>
            {content.data.extracted.slice(0, 20).map((e: any) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm">
                <span>{e.payload.summary ?? e.item_type} <span className="text-ink-muted">· {e.source_title}</span></span>
                <span className="flex gap-1.5"><Badge>{e.item_type}</Badge><Badge tone={e.extractor.startsWith('llm') ? 'signal' : 'neutral'}>{e.extractor}</Badge></span>
              </div>
            ))}
            {content.data.extracted.length === 0 && <p className="text-sm text-ink-muted">Nothing awaiting review.</p>}
          </Card>
          <Card className="space-y-2">
            <h3 className="font-semibold">Stored AI-generated procedures</h3>
            {content.data.procedures.map((p: any) => <div key={p.id} className="text-sm">{p.title} · <Badge tone={STATUS_TONE[p.verification_status]}>{p.verification_status}</Badge></div>)}
            {content.data.procedures.length === 0 && <p className="text-sm text-ink-muted">None. AI-generated guides are shown to users as labelled, unpersisted guidance and are not added to the knowledge graph without review.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
