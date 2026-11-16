import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { date } from '../../lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Notice, PageHeader, Segmented, Skeleton, Textarea } from '../../ui';
import { STATUS_TONE, useAction } from './common';

function RequestCard({ r }: { r: any }) {
  const [notes, setNotes] = useState('');
  const review = useAction((decision: string) => api.post(`/admin/verification-requests/${r.id}/review`, { decision, notes: notes || undefined }), {
    success: (x: any) => `Request ${x.status.replace('_', ' ')}`,
    invalidate: [['admin-verifications'], ['admin-overview']],
  });
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{r.display_name}</div>
          <div className="text-sm text-ink-muted">{r.email}{r.business_name ? ` · ${r.business_name}` : ''}{r.service_area ? ` · ${r.service_area}` : ''}</div>
        </div>
        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <div><div className="text-xs text-ink-muted">Experience</div>{r.years_experience != null ? `${r.years_experience} years` : '—'}</div>
        <div><div className="text-xs text-ink-muted">Reputation</div>{Number(r.reputation).toFixed(1)}</div>
        <div><div className="text-xs text-ink-muted">Approved contributions</div>{r.approved_contributions}</div>
        <div><div className="text-xs text-ink-muted">Verified outcomes</div>{r.verified_outcomes}</div>
      </div>
      {r.specialties?.length > 0 && <div className="flex flex-wrap gap-1.5">{r.specialties.map((s: string) => <Badge key={s}>{s}</Badge>)}</div>}
      <div>
        <div className="eyebrow mb-1">Statement</div>
        <p className="text-sm leading-relaxed">{r.statement}</p>
      </div>
      <div>
        <div className="eyebrow mb-1">Evidence</div>
        <ul className="space-y-1 text-sm">
          {(r.evidence ?? []).map((e: any, i: number) => (
            <li key={i}>
              {e.kind === 'url' ? <a className="link" href={e.value} target="_blank" rel="noreferrer">{e.label ?? e.value}</a> : e.kind === 'file' ? <a className="link" href={`/api/v1/files/${e.value}/raw`} target="_blank" rel="noreferrer">{e.label ?? 'Attached file'}</a> : e.value}
            </li>
          ))}
          {!r.evidence?.length && <li className="text-ink-muted">No evidence attached.</li>}
        </ul>
      </div>
      {r.review_notes && <Notice tone="info" title="Previous review notes">{r.review_notes}</Notice>}
      {['pending', 'needs_evidence'].includes(r.status) && (
        <div className="space-y-3 border-t border-line pt-4">
          <Textarea rows={2} placeholder="Review notes (what you checked, or what's missing)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button loading={review.isPending} onClick={() => confirm('Approving marks this technician as VERIFIED publicly across REPAIRVERSE. Continue?') && review.mutate('approve')} icon={<ShieldCheck className="h-4 w-4" />}>Approve & verify</Button>
            <Button variant="secondary" onClick={() => review.mutate('request_evidence')}>Request evidence</Button>
            <Button variant="ghost" onClick={() => review.mutate('reject')}>Reject</Button>
          </div>
        </div>
      )}
      <div className="text-xs text-ink-faint">Submitted {date(r.created_at)}{r.reviewed_at ? ` · reviewed ${date(r.reviewed_at)}` : ''}</div>
    </Card>
  );
}

export default function AdminVerification() {
  const [status, setStatus] = useState('pending');
  const q = useQuery({ queryKey: ['admin-verifications', status], queryFn: () => api.get(`/admin/verification-requests?status=${status}`) });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Trust" title="Technician verification" description="Credentials are only shown as verified after a review here. Approving publicly marks the technician as verified and unlocks professional-only high-risk procedures." />
      <Segmented size="sm" options={['pending', 'needs_evidence', 'approved', 'rejected', 'all'].map((v) => ({ value: v, label: v.replace('_', ' ') }))} value={status} onChange={setStatus} />
      <ErrorNote error={q.error} />
      {q.isLoading && <Skeleton className="h-48" />}
      {q.data?.requests.length === 0 && <EmptyState icon={<ShieldCheck className="h-8 w-8" />} title="Nothing here" description="No verification requests with this status." />}
      <div className="space-y-4">{q.data?.requests.map((r: any) => <RequestCard key={r.id} r={r} />)}</div>
    </div>
  );
}
