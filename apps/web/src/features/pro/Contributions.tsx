import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { date } from '../../lib/format';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, FullPageSpinner, Input, Notice, PageHeader, Segmented, Select, Stat, Textarea, useToast } from '../../ui';

const TYPES = [
  { value: 'failure_report', label: 'Failure pattern' },
  { value: 'repair_procedure', label: 'Repair procedure' },
  { value: 'observation', label: 'Technical observation' },
  { value: 'correction', label: 'Correction' },
  { value: 'compatibility', label: 'Compatibility discovery' },
] as const;
const statusTone: Record<string, any> = { pending: 'warn', needs_evidence: 'accent', approved: 'ok', rejected: 'danger' };

type Ev = { kind: 'url' | 'text'; value: string };
function EvidenceEditor({ value, onChange }: { value: Ev[]; onChange: (v: Ev[]) => void }) {
  const [e, setE] = useState<Ev>({ kind: 'url', value: '' });
  return (
    <div className="space-y-2">
      {value.map((x, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate"><Badge>{x.kind}</Badge> {x.value}</span>
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-ink-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[100px_1fr_auto]">
        <Select value={e.kind} onChange={(ev) => setE((x) => ({ ...x, kind: ev.target.value as any }))}>
          <option value="url">Link</option>
          <option value="text">Note</option>
        </Select>
        <Input placeholder={e.kind === 'url' ? 'https://… (manual, datasheet, photo)' : 'Measurement, observation…'} value={e.value} onChange={(ev) => setE((x) => ({ ...x, value: ev.target.value }))} />
        <Button variant="secondary" disabled={!e.value.trim()} onClick={() => { onChange([...value, e]); setE({ kind: e.kind, value: '' }); }} icon={<Plus className="h-4 w-4" />} />
      </div>
    </div>
  );
}

function SubmitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<string>('failure_report');
  const [title, setTitle] = useState('');
  const [p, setP] = useState<Record<string, string>>({ riskLevel: 'medium', difficulty: '2' });
  const [evidence, setEvidence] = useState<Ev[]>([]);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const fms = useQuery({ queryKey: ['fm-all'], queryFn: () => api.get('/knowledge/failure-modes?limit=100'), enabled: type === 'repair_procedure' });
  const set = (k: string) => (e: any) => setP((x) => ({ ...x, [k]: e.target.value }));
  const buildPayload = () => {
    if (type === 'failure_report') return { name: p.name, description: p.description ?? '', componentTypeId: p.componentTypeId, categoryId: p.categoryId, riskLevel: p.riskLevel, symptoms: [] };
    if (type === 'repair_procedure')
      return {
        title: title,
        objective: p.objective,
        failureModeId: p.failureModeId,
        difficulty: Number(p.difficulty),
        riskLevel: p.riskLevel,
        steps: (p.steps ?? '').split('\n').map((s) => s.trim()).filter(Boolean).map((s, i) => ({ title: `Step ${i + 1}`, body: s, provenance: 'community_contribution' })),
        safetyNotes: (p.safety ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
      };
    return { details: p.details };
  };
  const submit = useMutation({
    mutationFn: () => api.post('/contributions', { type, title, payload: buildPayload(), evidence }),
    onSuccess: () => {
      toast('Submitted for moderation');
      qc.invalidateQueries({ queryKey: ['my-contributions'] });
      setTitle('');
      setP({ riskLevel: 'medium', difficulty: '2' });
      setEvidence([]);
      onClose();
    },
  });
  const valid =
    title.trim().length >= 3 &&
    (type === 'failure_report' ? p.name && p.componentTypeId && p.categoryId : type === 'repair_procedure' ? p.objective && p.failureModeId && (p.steps ?? '').trim() : (p.details ?? '').trim());
  return (
    <Dialog open={open} onClose={onClose} title="Submit knowledge" wide footer={<Button disabled={!valid} loading={submit.isPending} onClick={() => submit.mutate()}>Submit for review</Button>}>
      <Segmented size="sm" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" /></Field>
      {type === 'failure_report' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Failure name"><Input value={p.name ?? ''} onChange={set('name')} /></Field>
          <Field label="Risk level">
            <Select value={p.riskLevel} onChange={set('riskLevel')}>{['low', 'medium', 'high'].map((r) => <option key={r}>{r}</option>)}</Select>
          </Field>
          <Field label="Component type">
            <Select value={p.componentTypeId ?? ''} onChange={set('componentTypeId')}>
              <option value="">Choose…</option>
              {types.data?.componentTypes?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={p.categoryId ?? ''} onChange={set('categoryId')}>
              <option value="">Choose…</option>
              {cats.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Description"><Textarea rows={3} value={p.description ?? ''} onChange={set('description')} placeholder="Mechanism, symptoms, how you confirmed it" /></Field></div>
        </div>
      )}
      {type === 'repair_procedure' && (
        <div className="space-y-4">
          <Field label="Resolves failure mode">
            <Select value={p.failureModeId ?? ''} onChange={set('failureModeId')}>
              <option value="">Choose…</option>
              {fms.data?.failureModes?.map((f: any) => <option key={f.id} value={f.id}>{f.name} · {f.category_name}</option>)}
            </Select>
          </Field>
          <Field label="Objective"><Input value={p.objective ?? ''} onChange={set('objective')} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Difficulty (1–5)"><Select value={p.difficulty} onChange={set('difficulty')}>{[1, 2, 3, 4, 5].map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Risk level"><Select value={p.riskLevel} onChange={set('riskLevel')}>{['low', 'medium', 'high'].map((r) => <option key={r}>{r}</option>)}</Select></Field>
          </div>
          <Field label="Steps" hint="One step per line. Don't state screw positions or specifications you haven't verified."><Textarea rows={5} value={p.steps ?? ''} onChange={set('steps')} /></Field>
          <Field label="Safety notes" optional hint="One per line"><Textarea rows={2} value={p.safety ?? ''} onChange={set('safety')} /></Field>
        </div>
      )}
      {!['failure_report', 'repair_procedure'].includes(type) && (
        <Field label="Details"><Textarea rows={4} value={p.details ?? ''} onChange={set('details')} placeholder={type === 'correction' ? 'What is wrong, where, and what is correct' : 'Describe what you observed'} /></Field>
      )}
      <Field label="Evidence" hint="Contributions with good evidence are approved faster and earn more reputation."><EvidenceEditor value={evidence} onChange={setEvidence} /></Field>
      <ErrorNote error={submit.error ? new Error(errorMessage(submit.error)) : null} />
    </Dialog>
  );
}

function AddEvidence({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [ev, setEv] = useState<Ev[]>([]);
  const save = useMutation({ mutationFn: () => api.post(`/contributions/${id}/evidence`, { evidence: ev }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-contributions'] }); onClose(); } });
  return (
    <Dialog open onClose={onClose} title="Add evidence" footer={<Button disabled={!ev.length} loading={save.isPending} onClick={() => save.mutate()}>Resubmit</Button>}>
      <EvidenceEditor value={ev} onChange={setEv} />
      <ErrorNote error={save.error ? new Error(errorMessage(save.error)) : null} />
    </Dialog>
  );
}

export default function ProContributionsPage() {
  const [open, setOpen] = useState(false);
  const [evFor, setEvFor] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['my-contributions'], queryFn: () => api.get('/contributions/mine') });
  if (isLoading) return <FullPageSpinner />;
  const list = data?.contributions ?? [];
  const n = (s: string) => list.filter((c: any) => c.status === s).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Knowledge contributions" description="Confirmed failures, procedures and outcomes you share make every future repair smarter." actions={<Button variant="accent" onClick={() => setOpen(true)} icon={<Sparkles className="h-4 w-4" />}>Submit knowledge</Button>} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Reputation" value={Number(data?.reputation ?? 0).toFixed(1)} tone="accent" />
        <Stat label="Approved" value={n('approved')} tone="ok" />
        <Stat label="Pending review" value={n('pending')} />
        <Stat label="Needs evidence" value={n('needs_evidence')} tone="warn" />
      </div>
      <Notice tone="info" title="How reputation works">Reputation reflects accuracy, evidence quality and independent corroboration of your contributions — not how many you submit. Rejected contributions reduce it; documented failed repairs are valued too.</Notice>
      {!list.length ? (
        <EmptyState title="No contributions yet" description="Close a repair job with “contribute” checked, or submit knowledge directly." />
      ) : (
        <div className="space-y-3">
          {list.map((c: any) => (
            <Card key={c.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone[c.status]}>{c.status.replace('_', ' ')}</Badge>
                  <span className="text-xs text-ink-muted">{c.type.replace('_', ' ')} · {date(c.created_at)}</span>
                </div>
                {Number(c.reputation_delta) !== 0 && <span className={`text-sm font-semibold tabular-nums ${Number(c.reputation_delta) > 0 ? 'text-ok' : 'text-danger'}`}>{Number(c.reputation_delta) > 0 ? '+' : ''}{Number(c.reputation_delta).toFixed(1)}</span>}
              </div>
              <div className="font-medium">{c.title}</div>
              {c.review_notes && <p className="text-sm text-ink-muted">Reviewer: {c.review_notes}</p>}
              {c.status === 'needs_evidence' && <Button size="sm" variant="secondary" onClick={() => setEvFor(c.id)}>Add evidence</Button>}
            </Card>
          ))}
        </div>
      )}
      <SubmitDialog open={open} onClose={() => setOpen(false)} />
      {evFor && <AddEvidence id={evFor} onClose={() => setEvFor(null)} />}
    </div>
  );
}
