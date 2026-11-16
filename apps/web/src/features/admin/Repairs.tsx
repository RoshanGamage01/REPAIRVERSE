import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Wrench, XCircle } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { money, pct, relative } from '../../lib/format';
import { Badge, Card, Disclosure, EmptyState, ErrorNote, PageHeader, Segmented, Skeleton, Stat } from '../../ui';
import { JsonView, STATUS_TONE } from './common';

export default function AdminRepairs() {
  const [status, setStatus] = useState('all');
  const [succ, setSucc] = useState('all');
  const q = useQuery({ queryKey: ['admin-outcomes', status, succ], queryFn: () => api.get(`/admin/repair-outcomes${qs({ status: status === 'all' ? '' : status, succeeded: succ === 'all' ? '' : succ, limit: 100 })}`) });
  const s = q.data?.summary;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Outcome learning" title="Repairs" description="Recorded repair outcomes. Only verified outcomes update failure knowledge — and only conservatively, weighted by independent corroboration." />
      <ErrorNote error={q.error} />
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Outcomes recorded" value={s.total} hint={`${s.verified} verified · ${s.pending} pending`} />
          <Stat label="Repair success" value={s.total ? pct(s.succeeded / s.total) : '—'} hint={`${s.succeeded}/${s.total}`} />
          <Stat label="Diagnostic accuracy" value={s.evaluated ? pct(s.top_correct / s.evaluated) : '—'} hint={s.evaluated ? `Leading hypothesis correct ${s.top_correct}/${s.evaluated}` : 'No evaluated diagnoses yet'} />
          <Stat label="Awaiting verification" value={s.pending} tone={s.pending ? 'warn' : undefined} />
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <Segmented size="sm" options={['all', 'pending_review', 'verified', 'rejected'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} value={status} onChange={setStatus} />
        <Segmented size="sm" options={[{ value: 'all', label: 'Any result' }, { value: 'true', label: 'Succeeded' }, { value: 'false', label: 'Failed' }]} value={succ} onChange={setSucc} />
      </div>
      {q.isLoading && <Skeleton className="h-40" />}
      {q.data?.outcomes.length === 0 && <EmptyState icon={<Wrench className="h-8 w-8" />} title="No repair outcomes" description="Outcomes are recorded when technicians close repair jobs or integrations submit them via the API." />}
      <div className="space-y-3">
        {q.data?.outcomes.map((o: any) => {
          const top = o.initial_hypotheses?.[0];
          return (
            <Card key={o.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {o.succeeded ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-danger" />}
                    {o.actual_failure_mode ?? o.actual_failure_text ?? 'Unspecified failure'}
                  </div>
                  <div className="text-sm text-ink-muted">{o.product_name ? `${o.product_name} ${o.model_number ?? ''}` : 'Unidentified product'} · {o.organization ?? o.reporter} · {relative(o.created_at)}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={STATUS_TONE[o.verification_status]}>{o.verification_status.replace('_', ' ')}</Badge>
                  {o.top_hypothesis_correct === true && <Badge tone="ok">AI leading hypothesis correct</Badge>}
                  {o.top_hypothesis_correct === false && <Badge tone="warn">AI leading hypothesis missed</Badge>}
                </div>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-ink-muted">Symptoms</div>{o.symptoms.join(', ') || '—'}</div>
                <div><div className="text-xs text-ink-muted">Initial leading hypothesis</div>{top ? `${top.name} (${pct(top.probability)})` : '—'}</div>
                <div><div className="text-xs text-ink-muted">Cost</div>{money(o.cost_cents, o.currency)}</div>
                <div><div className="text-xs text-ink-muted">Duration</div>{o.duration_minutes ? `${o.duration_minutes} min` : '—'}</div>
              </div>
              <Disclosure title="Tests, replaced components and hypotheses">
                <JsonView value={{ tests: o.tests_performed, componentsReplaced: o.components_replaced, initialHypotheses: o.initial_hypotheses, followUp: o.follow_up_status }} />
              </Disclosure>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
