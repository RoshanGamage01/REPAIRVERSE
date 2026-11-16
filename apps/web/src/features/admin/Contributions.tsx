import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2, Flag } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { relative } from '../../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, KeyValue, Notice, PageHeader, Segmented, Skeleton, Tabs, Textarea, VerificationBadge } from '../../ui';
import { JsonView, PayloadView, STATUS_TONE, useAction } from './common';

function Detail({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ['moderation-contribution', id], queryFn: () => api.get(`/moderation/contributions/${id}`) });
  const [notes, setNotes] = useState('');
  const [editJson, setEditJson] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  useEffect(() => (setNotes(''), setEditJson(null), setResult(null)), [id]);
  const review = useAction(
    (decision: string) => {
      let editedPayload: unknown;
      if (editJson !== null) editedPayload = JSON.parse(editJson);
      return api.post(`/moderation/contributions/${id}/review`, { decision, notes: notes || undefined, editedPayload });
    },
    { success: (r: any) => `Contribution ${r.status.replace('_', ' ')}`, invalidate: [['moderation-queue'], ['moderation-contribution', id], ['admin-overview']], onSuccess: setResult },
  );
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorNote error={q.error} />;
  const { contribution: c, contributorHistory: h, outcome, corroboration, symptomNames } = q.data;
  const names = Object.fromEntries(symptomNames.map((s: any) => [s.id, s.name]));
  const open = c.status === 'pending' || c.status === 'needs_evidence';
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="eyebrow">{c.type.replace(/_/g, ' ')}</div>
            <h2 className="text-lg font-semibold">{c.title}</h2>
          </div>
          <Badge tone={STATUS_TONE[c.status]}>{c.status.replace('_', ' ')}</Badge>
        </div>
        <KeyValue
          items={[
            { label: 'Contributor', value: `${c.contributor} (${c.contributor_role})` },
            { label: 'Technician credentials', value: c.contributor_verification ? <VerificationBadge status={c.contributor_verification === 'pending' ? 'pending' : c.contributor_verification} /> : '—' },
            { label: 'Reputation', value: Number(c.contributor_reputation).toFixed(1) },
            { label: 'History', value: `${h.approved} approved · ${h.rejected} rejected` },
            { label: 'Submitted', value: relative(c.created_at) },
          ]}
        />
      </Card>
      {outcome && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Repair outcome</h3>
          <KeyValue
            items={[
              { label: 'Product', value: outcome.product_name ?? '—' },
              { label: 'Confirmed failure', value: outcome.failure_mode_name ?? outcome.actual_failure_text ?? '—' },
              { label: 'Result', value: outcome.succeeded ? <Badge tone="ok">Succeeded</Badge> : <Badge tone="danger">Did not succeed</Badge> },
              { label: 'AI leading hypothesis', value: outcome.top_hypothesis_correct == null ? 'Not evaluated' : outcome.top_hypothesis_correct ? 'Correct' : 'Missed' },
              { label: 'Duration', value: outcome.duration_minutes ? `${outcome.duration_minutes} min` : '—' },
            ]}
          />
          {corroboration && (
            <Notice tone={corroboration.other_reporters > 0 ? 'ok' : 'info'} title="Corroboration">
              {corroboration.verified_cases} verified case(s) of this failure so far, from {corroboration.other_reporters} other independent reporter(s). A single report is never treated as established truth — approval updates knowledge conservatively.
            </Notice>
          )}
        </Card>
      )}
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Submitted knowledge</h3>
          {open && <Button size="sm" variant="ghost" onClick={() => setEditJson(editJson === null ? JSON.stringify(c.payload, null, 2) : null)}>{editJson === null ? 'Edit payload' : 'Discard edits'}</Button>}
        </div>
        {editJson !== null ? <Textarea rows={12} className="font-mono text-xs" value={editJson} onChange={(e) => setEditJson(e.target.value)} /> : <PayloadView payload={c.payload} names={names} />}
      </Card>
      <Card className="space-y-2">
        <h3 className="font-semibold">Evidence ({c.evidence.length})</h3>
        <ul className="space-y-1 text-sm">
          {c.evidence.map((e: any, i: number) => (
            <li key={i}>
              {e.label && <span className="text-ink-muted">{e.label}: </span>}
              {e.kind === 'url' ? <a className="link" href={e.value} target="_blank" rel="noreferrer">{e.value}</a> : e.kind === 'file' ? <a className="link" href={`/api/v1/files/${e.value}/raw`} target="_blank" rel="noreferrer">Attached file</a> : e.value}
            </li>
          ))}
          {!c.evidence.length && <li className="text-ink-muted">No evidence provided.</li>}
        </ul>
      </Card>
      {c.review_notes && <Notice tone="info" title="Review notes">{c.review_notes}</Notice>}
      {(result || c.applied) && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Applied to the knowledge graph</h3>
          {result?.reputationDelta != null && <p className="text-sm">Contributor reputation {result.reputationDelta >= 0 ? '+' : ''}{result.reputationDelta}</p>}
          <JsonView value={result?.applied ?? c.applied} />
        </Card>
      )}
      {open && (
        <Card className="space-y-3">
          <Textarea rows={2} placeholder="Notes for the contributor (required context for rejections or evidence requests)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button loading={review.isPending} onClick={() => review.mutate('approve')}>Approve</Button>
            <Button variant="secondary" onClick={() => review.mutate('request_evidence')}>Request more evidence</Button>
            <Button variant="ghost" onClick={() => review.mutate('reject')}>Reject</Button>
            <Button variant="ghost" onClick={onDone}>Close</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Reports() {
  const q = useQuery({ queryKey: ['moderation-reports'], queryFn: () => api.get('/moderation/reports') });
  const act = useAction((v: { id: string; status: string }) => api.post(`/moderation/reports/${v.id}`, { status: v.status }), { success: 'Report updated', invalidate: [['moderation-reports'], ['admin-overview']] });
  if (q.data?.reports.length === 0) return <EmptyState icon={<Flag className="h-8 w-8" />} title="No open reports" />;
  return (
    <div className="space-y-2">
      <ErrorNote error={q.error} />
      {q.data?.reports.map((r: any) => (
        <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">{r.reason}</div>
            <div className="text-xs text-ink-muted">{r.entity_type} · {r.entity_id.slice(0, 8)} · by {r.reporter ?? 'unknown'} · {relative(r.created_at)}</div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => act.mutate({ id: r.id, status: 'resolved' })}>Resolved</Button>
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function AdminContributions() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'queue' | 'reports') ?? 'queue';
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['moderation-queue', status], queryFn: () => api.get(`/moderation/contributions${qs({ status, limit: 100 })}`), enabled: tab === 'queue' });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Moderation" title="Contributions" description="Community and technician knowledge becomes trusted only after review. Reputation reflects quality and corroboration, not volume." />
      <Tabs tabs={[{ value: 'queue', label: 'Moderation queue' }, { value: 'reports', label: 'Content reports' }]} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'reports' ? (
        <Reports />
      ) : (
        <>
          <Segmented size="sm" options={['pending', 'needs_evidence', 'approved', 'rejected', 'all'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} value={status} onChange={(v) => (setStatus(v), setSelected(null))} />
          <ErrorNote error={q.error} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
            <div className="min-w-0 space-y-2">
              {q.isLoading && <Skeleton className="h-40" />}
              {q.data?.contributions.length === 0 && <EmptyState icon={<FileCheck2 className="h-8 w-8" />} title="Queue is clear" description="No contributions with this status." />}
              {q.data?.contributions.map((c: any) => (
                <button key={c.id} onClick={() => (setSelected(c.id), window.innerWidth < 1024 && setTimeout(() => document.getElementById('contribution-detail')?.scrollIntoView({ behavior: 'smooth' }), 50))} className={`surface w-full p-4 text-left transition ${selected === c.id ? 'ring-2 ring-ink' : 'hover:shadow-soft'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="eyebrow">{c.type.replace(/_/g, ' ')}</div>
                      <div className="truncate font-medium">{c.title}</div>
                      <div className="text-xs text-ink-muted">{c.contributor} · rep {Number(c.contributor_reputation).toFixed(0)} · {c.evidence_count} evidence · {relative(c.created_at)}</div>
                    </div>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status.replace('_', ' ')}</Badge>
                  </div>
                </button>
              ))}
            </div>
            <div id="contribution-detail" className="min-w-0 scroll-mt-28">{selected ? <Detail id={selected} onDone={() => setSelected(null)} /> : <EmptyState title="Select a contribution" description="Review its payload, evidence and contributor history side by side." />}</div>
          </div>
        </>
      )}
    </div>
  );
}
