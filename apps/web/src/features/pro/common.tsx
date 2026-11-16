import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, BookOpen, CheckCircle2, HelpCircle, Microscope, Plus, Search, Send, Trash2 } from 'lucide-react';
import { JOB_STATUS_LABELS, type JobStatus } from '@repairverse/shared';
import { api, errorMessage, qs } from '../../lib/api';
import { Badge, Button, Card, ConfidenceMeter, cx, DemoBadge, ErrorNote, Input, Notice, RiskBadge, Segmented, Spinner, Textarea } from '../../ui';

const statusTone: Record<string, any> = {
  received: 'neutral',
  inspecting: 'neutral',
  diagnosing: 'signal',
  waiting_for_approval: 'warn',
  waiting_for_parts: 'warn',
  in_repair: 'accent',
  testing: 'accent',
  completed: 'ok',
  delivered: 'ok',
  cancelled: 'danger',
};
export function JobStatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? 'neutral'}>{JOB_STATUS_LABELS[status as JobStatus] ?? status}</Badge>;
}

/** Product search picker. */
export function ProductPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (p: { id: string; name: string; category_id?: string } | null) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({ queryKey: ['pro-product-search', q], queryFn: () => api.get(`/products${qs({ q, limit: 8 })}`), enabled: q.trim().length > 1 });
  if (value)
    return (
      <div className="flex items-center justify-between rounded-xl bg-paper-sunken px-3.5 py-2.5 text-sm">
        <span className="font-medium">{value.name}</span>
        <button className="text-ink-muted hover:text-ink" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-10" placeholder="Search product name or model" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isFetching && <Spinner className="h-4 w-4" />}
      {data?.products?.length > 0 && (
        <div className="surface divide-y divide-line">
          {data.products.map((p: any) => (
            <button key={p.id} type="button" className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-ink/[.03]" onClick={() => onChange({ id: p.id, name: `${p.brand_name ?? ''} ${p.name} ${p.model_number ?? ''}`.trim() })}>
              <span>
                {p.brand_name} {p.name} <span className="text-ink-muted">{p.model_number}</span>
              </span>
              {p.is_demo && <DemoBadge />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Key/value attribute editor. */
export function AttributesEditor({ value, onChange, suggestions = [] }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; suggestions?: string[] }) {
  const entries = Object.entries(value);
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span className="rounded-lg bg-paper-sunken px-2 py-1 font-mono text-xs">{key}</span>
          <span className="flex-1">{val}</span>
          <button
            type="button"
            className="text-ink-faint hover:text-danger"
            onClick={() => {
              const n = { ...value };
              delete n[key];
              onChange(n);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input list="attr-suggestions" placeholder="attribute (e.g. connector_type)" value={k} onChange={(e) => setK(e.target.value)} />
        <Input placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
        <Button
          type="button"
          variant="secondary"
          disabled={!k.trim() || !v.trim()}
          onClick={() => {
            onChange({ ...value, [k.trim()]: v.trim() });
            setK('');
            setV('');
          }}
          icon={<Plus className="h-4 w-4" />}
        />
      </div>
      <datalist id="attr-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

/** Hypotheses + inline diagnostic questions for an existing diagnosis session. */
export function DiagnosisWorkbench({ diagnosis, onUpdate }: { diagnosis: any; onUpdate: (d: any) => void }) {
  const answer = useMutation({ mutationFn: (v: { probeId: string; answer: string }) => api.post(`/diagnoses/${diagnosis.id}/answers`, v), onSuccess: onUpdate });
  const d = diagnosis;
  return (
    <div className="space-y-5">
      {d.safetyNotice && <Notice tone="danger" title="Safety">{d.safetyNotice.message}</Notice>}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-signal" />
          <span className="text-sm font-semibold">AI suggestions — not confirmed</span>
          <span className="text-xs text-ink-muted">· {d.evidenceCount} evidence</span>
        </div>
        {d.hypotheses.length === 0 && <Notice tone="warn">No matching failure knowledge for these symptoms. Record your own findings below.</Notice>}
        {d.hypotheses.slice(0, 4).map((h: any) => (
          <div key={h.failureModeId} className="rounded-2xl border border-dashed border-signal/40 bg-signal-soft/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{h.name}</span>
              <RiskBadge level={h.safety.level} />
              {h.knowledge.isDemo && <DemoBadge />}
            </div>
            <div className="text-xs text-ink-muted">Component: {h.component.name}</div>
            <div className="mt-2 max-w-md">
              <ConfidenceMeter value={h.probability} label="AI relative likelihood" compact />
            </div>
            {h.supportingEvidence.length > 0 && <div className="mt-2 text-xs text-ink-muted">Evidence: {h.supportingEvidence.map((e: any) => e.label).join('; ')}</div>}
          </div>
        ))}
        {d.unknownProbability >= 0.01 && <div className="text-xs text-ink-muted">Unrepresented causes: {Math.round(d.unknownProbability * 100)}%</div>}
      </div>
      {d.nextQuestions.length > 0 && (
        <div className="space-y-3">
          <div className="eyebrow">Suggested checks</div>
          {d.nextQuestions.map((q: any) => (
            <div key={q.probeId} className="surface space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={q.kind === 'test' ? 'accent' : 'neutral'} icon={q.kind === 'test' ? <Microscope className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}>
                  {q.kind === 'test' ? 'Test' : 'Question'}
                </Badge>
                {q.kind === 'test' && <RiskBadge level={q.riskLevel} />}
              </div>
              <div className="text-sm font-medium">{q.prompt}</div>
              {q.instructions?.length > 0 && (
                <ol className="list-decimal pl-5 text-xs text-ink-muted">
                  {q.instructions.map((i: string) => (
                    <li key={i}>{i}</li>
                  ))}
                </ol>
              )}
              <Segmented options={q.options} value={null} onChange={(v) => answer.mutate({ probeId: q.probeId, answer: v })} size="sm" />
              <div className="text-xs text-ink-faint">{q.why}</div>
            </div>
          ))}
        </div>
      )}
      {d.journey.filter((j: any) => j.type === 'question' || j.type === 'test').length > 0 && (
        <div className="space-y-1 text-sm">
          <div className="eyebrow">Recorded results</div>
          {d.journey
            .filter((j: any) => j.type === 'question' || j.type === 'test')
            .map((j: any) => (
              <div key={j.observationId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5">
                <span className="text-ink-soft">{j.label}</span>
                <Segmented options={j.options} value={j.answer} onChange={(v) => answer.mutate({ probeId: j.probeId, answer: v })} size="sm" />
              </div>
            ))}
        </div>
      )}
      <ErrorNote error={answer.error ? new Error(errorMessage(answer.error)) : null} />
    </div>
  );
}

/** Retrieval-grounded copilot. Without an AI provider it still returns references. */
export function CopilotPanel({ jobId }: { jobId?: string }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; r: any }[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api.post('/pro/copilot', { question: q, jobId }),
    onSuccess: (r, q) => {
      setHistory((h) => [{ q, r }, ...h]);
      setQuestion('');
    },
  });
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-signal" />
        <h3 className="font-semibold">Diagnostic copilot</h3>
        <Badge tone="signal">AI · grounded in approved knowledge</Badge>
      </div>
      <div className="flex gap-2">
        <Textarea rows={2} className="min-h-[52px]" placeholder="e.g. What should I check before replacing the display panel?" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <Button variant="primary" loading={ask.isPending} disabled={question.trim().length < 3} onClick={() => ask.mutate(question)} icon={<Send className="h-4 w-4" />} />
      </div>
      <ErrorNote error={ask.error ? new Error(errorMessage(ask.error)) : null} />
      {history.map(({ q, r }, i) => (
        <div key={i} className="space-y-3 border-t border-line pt-4">
          <div className="text-sm font-medium">{q}</div>
          {r.status === 'answered' ? (
            <>
              <Badge tone="signal" icon={<Bot className="h-3 w-3" />}>AI-generated</Badge>
              {!r.knowledgeAvailable && <Notice tone="warn">The knowledge network doesn't cover this well — treat the answer as reasoning, not reference.</Notice>}
              <p className="whitespace-pre-line text-sm leading-relaxed">{r.answer}</p>
              {r.suggestedChecks?.length > 0 && (
                <div className="text-sm">
                  <div className="eyebrow mb-1">Suggested checks</div>
                  <ul className="space-y-0.5 text-ink-soft">{r.suggestedChecks.map((c: string) => <li key={c}>• {c}</li>)}</ul>
                </div>
              )}
              {r.alternativeExplanations?.length > 0 && (
                <div className="text-sm">
                  <div className="eyebrow mb-1">Alternative explanations</div>
                  <ul className="space-y-0.5 text-ink-soft">{r.alternativeExplanations.map((c: string) => <li key={c}>• {c}</li>)}</ul>
                </div>
              )}
            </>
          ) : (
            <Notice tone="info">{r.message} Relevant approved knowledge is shown below.</Notice>
          )}
          <div className="space-y-2">
            {(r.citedReferences?.length ? r.citedReferences : r.references ?? []).map((ref: any) => (
              <div key={ref.id} className="rounded-xl bg-paper-sunken p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold">
                  <BookOpen className="h-3 w-3" /> {ref.url ? <a className="link" href={ref.url} target="_blank" rel="noreferrer">{ref.title}</a> : ref.title}
                  {ref.sourceKind === 'demo' && <DemoBadge />}
                </div>
                {ref.excerpt && <p className="mt-1 text-ink-muted">{ref.excerpt}</p>}
              </div>
            ))}
            {!r.references?.length && <p className="text-xs text-ink-muted">No approved references matched.</p>}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function FindingKindBadge({ kind }: { kind: string }) {
  if (kind === 'confirmed_diagnosis') return <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>Technician-confirmed</Badge>;
  if (kind === 'ai_suggestion') return <Badge tone="signal" icon={<Bot className="h-3 w-3" />}>AI suggestion · unconfirmed</Badge>;
  return <Badge>Technician finding</Badge>;
}

export const findingStyle = (kind: string) =>
  cx('rounded-2xl p-4', kind === 'confirmed_diagnosis' ? 'bg-ok-soft ring-2 ring-ok' : kind === 'ai_suggestion' ? 'border border-dashed border-signal/40 bg-signal-soft/40' : 'surface');
