import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, CheckCircle2, FileText, ImagePlus, Plus, Printer, Receipt, Stethoscope, Trash2, XCircle } from 'lucide-react';
import { JOB_STATUS_LABELS, type JobStatus } from '@repairverse/shared';
import { api, errorMessage } from '../../lib/api';
import { date, dateTime, money, toCents } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cx,
  DemoBadge,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  FullPageSpinner,
  Input,
  Notice,
  Segmented,
  Select,
  Tabs,
  Textarea,
  useToast,
  VerificationBadge,
} from '../../ui';
import { CopilotPanel, DiagnosisWorkbench, FindingKindBadge, findingStyle, JobStatusBadge } from './common';

type Tab = 'intake' | 'diagnosis' | 'quote' | 'parts' | 'work' | 'report' | 'copilot';

function useJobMutation(id: string, fn: (body: any) => Promise<any>, msg?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pro-job', id] });
      if (msg) toast(msg);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
}

function Intake({ job, id }: { job: any; id: string }) {
  const [cond, setCond] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useJobMutation(id, (b) => api.patch(`/pro/jobs/${id}`, b), 'Saved');
  const attach = useJobMutation(
    id,
    async (files: File[]) => {
      const up = await api.upload(files, 'job_intake');
      for (const f of up.files) await api.post(`/pro/jobs/${id}/attachments`, { fileId: f.id, stage: 'intake', label: f.original_name });
    },
    'Photos added',
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <div className="eyebrow">Customer complaint</div>
        <p className="text-sm leading-relaxed">{job.job.complaint}</p>
        <div className="eyebrow pt-2">Incoming condition</div>
        {cond === null ? (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-ink-soft">{job.job.intake_condition || 'Not recorded'}</p>
            <Button variant="ghost" size="sm" onClick={() => setCond(job.job.intake_condition ?? '')}>Edit</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea rows={3} value={cond} onChange={(e) => setCond(e.target.value)} />
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ intakeCondition: cond }, { onSuccess: () => setCond(null) })}>Save</Button>
          </div>
        )}
      </Card>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Photos</div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files?.length && attach.mutate(Array.from(e.target.files))} />
          <Button variant="secondary" size="sm" loading={attach.isPending} onClick={() => fileRef.current?.click()} icon={<ImagePlus className="h-3.5 w-3.5" />}>Add</Button>
        </div>
        {job.attachments.length === 0 ? (
          <p className="text-sm text-ink-muted">No photos yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {job.attachments.map((a: any) => (
              <a key={a.file_id} href={`/api/v1/files/${a.file_id}/raw`} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-xl bg-paper-sunken ring-1 ring-line">
                {a.kind === 'image' ? <img src={`/api/v1/files/${a.file_id}/raw`} alt={a.label ?? ''} className="h-full w-full object-cover" /> : <span className="p-2 text-xs">{a.label}</span>}
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Diagnosis({ job, id }: { job: any; id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [symptoms, setSymptoms] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [finding, setFinding] = useState({ kind: 'technician_finding', failureModeId: '', text: '' });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories'), enabled: !job.device?.category_id });
  const fms = useQuery({ queryKey: ['fm-list', job.device?.category_id], queryFn: () => api.get(`/knowledge/failure-modes?limit=100${job.device?.category_id ? `&categoryId=${job.device.category_id}` : ''}`) });
  const run = useMutation({
    mutationFn: () => api.post(`/pro/jobs/${id}/diagnose`, { symptoms, categoryId: categoryId || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pro-job', id] });
      toast('AI-assisted diagnosis complete — suggestions recorded as unconfirmed');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const addFinding = useJobMutation(id, (b) => api.post(`/pro/jobs/${id}/findings`, b), 'Finding recorded');
  const hyps = job.diagnosis?.hypotheses ?? [];
  const fmOptions = [...hyps.map((h: any) => ({ id: h.failureModeId, name: `${h.name} (AI ${Math.round(h.probability * 100)}%)` })), ...(fms.data?.failureModes ?? []).filter((f: any) => !hyps.some((h: any) => h.failureModeId === f.id)).map((f: any) => ({ id: f.id, name: f.name }))];
  const confirmed = job.findings.find((f: any) => f.kind === 'confirmed_diagnosis');

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-4">
        <Card className="space-y-3">
          <h3 className="flex items-center gap-2 font-semibold"><Stethoscope className="h-4 w-4" /> AI-assisted diagnosis</h3>
          <p className="text-sm text-ink-muted">Uses the complaint plus anything you add. Results are suggestions — you confirm the actual failure.</p>
          {!job.device?.category_id && (
            <Field label="Product category (device not linked to a product)">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose…</option>
                {cats.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Textarea rows={2} placeholder="Additional technical symptoms (optional)" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} />
          <Button variant="primary" loading={run.isPending} disabled={!job.device?.category_id && !categoryId} onClick={() => run.mutate()} icon={<Bot className="h-4 w-4" />}>
            {job.diagnosis ? 'Re-run diagnosis' : 'Run AI-assisted diagnosis'}
          </Button>
        </Card>
        {job.diagnosis && (
          <Card>
            <DiagnosisWorkbench diagnosis={job.diagnosis} onUpdate={() => qc.invalidateQueries({ queryKey: ['pro-job', id] })} />
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <h3 className="font-semibold">Findings</h3>
        {confirmed ? (
          <Notice tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} title="Diagnosis confirmed by technician">{confirmed.failure_mode_name ?? confirmed.text}</Notice>
        ) : (
          <Notice tone="info">No technician-confirmed diagnosis yet.</Notice>
        )}
        {job.findings.map((f: any) => (
          <div key={f.id} className={findingStyle(f.kind)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FindingKindBadge kind={f.kind} />
              <span className="text-xs text-ink-muted">{dateTime(f.created_at)}</span>
            </div>
            <div className="mt-2 text-sm font-medium">{f.failure_mode_name && f.kind !== 'ai_suggestion' ? f.failure_mode_name : f.text}</div>
            {f.kind !== 'ai_suggestion' && f.failure_mode_name && <div className="text-sm text-ink-soft">{f.text}</div>}
            {f.probability != null && <div className="text-xs text-ink-muted">AI relative likelihood {Math.round(f.probability * 100)}%</div>}
          </div>
        ))}
        <Card className="space-y-3">
          <h4 className="text-sm font-semibold">Record a finding</h4>
          <Segmented
            size="sm"
            value={finding.kind}
            onChange={(v) => setFinding((x) => ({ ...x, kind: v }))}
            options={[{ value: 'technician_finding', label: 'Observation' }, { value: 'confirmed_diagnosis', label: 'Confirm actual failure' }]}
          />
          <Select value={finding.failureModeId} onChange={(e) => setFinding((x) => ({ ...x, failureModeId: e.target.value }))}>
            <option value="">Failure mode {finding.kind === 'confirmed_diagnosis' ? '(recommended)' : '(optional)'}</option>
            {fmOptions.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <Textarea rows={2} placeholder="What you found and how you confirmed it" value={finding.text} onChange={(e) => setFinding((x) => ({ ...x, text: e.target.value }))} />
          <Button
            size="sm"
            variant={finding.kind === 'confirmed_diagnosis' ? 'accent' : 'secondary'}
            disabled={!finding.text.trim()}
            loading={addFinding.isPending}
            onClick={() => addFinding.mutate({ kind: finding.kind, failureModeId: finding.failureModeId || null, text: finding.text }, { onSuccess: () => setFinding({ kind: 'technician_finding', failureModeId: '', text: '' }) })}
          >
            {finding.kind === 'confirmed_diagnosis' ? 'Confirm diagnosis' : 'Add finding'}
          </Button>
        </Card>
      </div>
    </div>
  );
}

function QuoteDoc({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['pro-quote', id], queryFn: () => api.get(`/pro/jobs/${id}/quote`), enabled: open });
  const d = q.data;
  return (
    <Dialog open={open} onClose={onClose} title="Customer quotation" wide footer={<Button variant="secondary" onClick={() => window.print()} icon={<Printer className="h-4 w-4" />}>Print</Button>}>
      {d && (
        <div className="space-y-4 text-sm">
          <div className="flex justify-between">
            <div>
              <div className="text-lg font-semibold">{d.business?.name}</div>
              <div className="text-ink-muted">{[d.business?.phone, d.business?.website].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="text-right">
              <div className="font-mono">Job #{d.jobNumber}</div>
              <div className="text-ink-muted">For {d.customer}</div>
            </div>
          </div>
          <div><span className="font-medium">Reported issue: </span>{d.issue}</div>
          {d.findings.length > 0 && (
            <div>
              <div className="font-medium">Findings</div>
              <ul>{d.findings.map((f: any, i: number) => <li key={i}>• {f.text}{f.confirmed ? ' (confirmed)' : ''}</li>)}</ul>
            </div>
          )}
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {d.items.map((i: any, k: number) => (
                <tr key={k}><td className="py-2">{i.description} × {i.quantity}</td><td className="py-2 text-right tabular-nums">{money(i.lineTotalCents)}</td></tr>
              ))}
              <tr><td className="py-2 font-semibold">Total</td><td className="py-2 text-right font-semibold tabular-nums">{money(d.totalCents)}</td></tr>
            </tbody>
          </table>
          {d.note && <Notice tone="warn">{d.note}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

function Quote({ job, id }: { job: any; id: string }) {
  const [item, setItem] = useState({ kind: 'labor', description: '', quantity: '1', price: '', partId: '' });
  const [docOpen, setDocOpen] = useState(false);
  const parts = useQuery({ queryKey: ['parts-for-product', job.device?.product_id], queryFn: () => api.get(`/parts/for-product/${job.device.product_id}`), enabled: !!job.device?.product_id });
  const add = useJobMutation(id, (b) => api.post(`/pro/jobs/${id}/quote-items`, b));
  const del = useJobMutation(id, (itemId: string) => api.del(`/pro/jobs/${id}/quote-items/${itemId}`));
  const approve = useJobMutation(id, () => api.post(`/pro/jobs/${id}/quote/approve`, {}), 'Customer approval recorded');
  const approved = !!job.quote.approvedAt;
  const partOptions = parts.data ? [...parts.data.confirmed, ...parts.data.potential] : [];
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Quote</h3>
          <div className="flex gap-2">
            {approved && <Badge tone="ok">Approved {date(job.quote.approvedAt)}</Badge>}
            <Button variant="ghost" size="sm" onClick={() => setDocOpen(true)} icon={<Receipt className="h-3.5 w-3.5" />}>Customer quotation</Button>
          </div>
        </div>
        {job.quote.items.length === 0 ? (
          <p className="text-sm text-ink-muted">No items yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {job.quote.items.map((q: any) => (
              <div key={q.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <Badge className="mr-2">{q.kind}</Badge>
                  {q.description} <span className="text-ink-muted">× {q.quantity}</span>
                  {q.part_number && <span className="ml-1 font-mono text-xs text-ink-muted">{q.part_number}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">{money(q.quantity * q.unit_price_cents)}</span>
                  {!approved && <button className="text-ink-faint hover:text-danger" onClick={() => del.mutate(q.id)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            ))}
            <div className="flex justify-between py-2.5 font-semibold"><span>Total</span><span className="tabular-nums">{money(job.quote.totalCents)}</span></div>
          </div>
        )}
        {!approved && job.quote.items.length > 0 && (
          <Button variant="secondary" size="sm" loading={approve.isPending} onClick={() => approve.mutate(undefined)}>Record customer approval</Button>
        )}
      </Card>
      {!approved && (
        <Card className="space-y-3">
          <h4 className="text-sm font-semibold">Add item</h4>
          <Segmented size="sm" value={item.kind} onChange={(v) => setItem((x) => ({ ...x, kind: v }))} options={[{ value: 'labor', label: 'Labour' }, { value: 'part', label: 'Part' }, { value: 'other', label: 'Other' }]} />
          {item.kind === 'part' && partOptions.length > 0 && (
            <Select
              value={item.partId}
              onChange={(e) => {
                const p = partOptions.find((x: any) => x.part.id === e.target.value);
                setItem((x) => ({ ...x, partId: e.target.value, description: p ? p.part.name : x.description }));
              }}
            >
              <option value="">Compatible part (optional)</option>
              {partOptions.map((p: any) => <option key={p.part.id} value={p.part.id}>{p.part.name} · {p.state}</option>)}
            </Select>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_80px_120px]">
            <Input placeholder="Description" value={item.description} onChange={(e) => setItem((x) => ({ ...x, description: e.target.value }))} />
            <Input inputMode="numeric" placeholder="Qty" value={item.quantity} onChange={(e) => setItem((x) => ({ ...x, quantity: e.target.value }))} />
            <Input inputMode="decimal" placeholder="Unit price" value={item.price} onChange={(e) => setItem((x) => ({ ...x, price: e.target.value }))} />
          </div>
          <Button
            size="sm"
            disabled={!item.description.trim() || toCents(item.price) == null}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { kind: item.kind, description: item.description, partId: item.partId || null, quantity: Math.max(1, parseInt(item.quantity) || 1), unitPriceCents: toCents(item.price) },
                { onSuccess: () => setItem({ kind: item.kind, description: '', quantity: '1', price: '', partId: '' }) },
              )
            }
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add item
          </Button>
        </Card>
      )}
      <QuoteDoc id={id} open={docOpen} onClose={() => setDocOpen(false)} />
    </div>
  );
}

function Parts({ job }: { job: any }) {
  const [ct, setCt] = useState('');
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const parts = useQuery({ queryKey: ['parts-for-product', job.device?.product_id, ct], queryFn: () => api.get(`/parts/for-product/${job.device.product_id}${ct ? `?componentTypeId=${ct}` : ''}`), enabled: !!job.device?.product_id });
  if (!job.device?.product_id) return <EmptyState title="Link the device to a product" description="Compatible parts can only be checked for an identified product." />;
  const group = (title: string, items: any[], tone: string) => (
    <Card className="space-y-2">
      <h4 className={cx('text-sm font-semibold', tone)}>{title} · {items.length}</h4>
      {items.length === 0 && <p className="text-sm text-ink-muted">None</p>}
      {items.map((p: any) => (
        <div key={p.part.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm">
          <Link to={`/parts/${p.part.id}`} className="link">{p.part.name}</Link>
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="font-mono">{p.part.partNumber}</span>
            {p.isDemo && <DemoBadge />}
          </span>
          <div className="w-full text-xs text-ink-muted">{p.reasons[0]}</div>
        </div>
      ))}
    </Card>
  );
  return (
    <div className="space-y-4">
      <Select value={ct} onChange={(e) => setCt(e.target.value)} className="max-w-xs">
        <option value="">All component types</option>
        {types.data?.componentTypes?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
      {parts.data?.variantRequired && <Notice tone="warn">This product has variants; compatibility shown is product-wide. Confirm the variant from the device label.</Notice>}
      {parts.data && (
        <div className="grid gap-4 md:grid-cols-2">
          {group('Confirmed compatible', parts.data.confirmed, 'text-ok')}
          {group('Potentially compatible (unverified)', [...parts.data.potential, ...parts.data.unknown], 'text-warn')}
        </div>
      )}
    </div>
  );
}

function Work({ job, id }: { job: any; id: string }) {
  const [log, setLog] = useState({ text: '', minutes: '' });
  const [rc, setRc] = useState({ componentTypeId: '', partId: '', oldPartNumber: '', newPartNumber: '', notes: '' });
  const [test, setTest] = useState({ name: '', result: 'pass', notes: '' });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const parts = useQuery({ queryKey: ['parts-ct', rc.componentTypeId], queryFn: () => api.get(`/parts?componentTypeId=${rc.componentTypeId}&limit=50`), enabled: !!rc.componentTypeId });
  const addLog = useJobMutation(id, (b) => api.post(`/pro/jobs/${id}/worklog`, b));
  const addRc = useJobMutation(id, (b) => api.post(`/pro/jobs/${id}/replaced-components`, b), 'Component recorded');
  const addTest = useJobMutation(id, (b) => api.post(`/pro/jobs/${id}/tests`, b));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-3">
        <h3 className="font-semibold">Work log</h3>
        {job.worklog.map((w: any) => (
          <div key={w.id} className="border-b border-line pb-2 text-sm">
            <div>{w.text}</div>
            <div className="text-xs text-ink-muted">{w.minutes} min · {w.display_name} · {dateTime(w.created_at)}</div>
          </div>
        ))}
        <Textarea rows={2} placeholder="Work performed" value={log.text} onChange={(e) => setLog((x) => ({ ...x, text: e.target.value }))} />
        <div className="flex gap-2">
          <Input inputMode="numeric" placeholder="Minutes" value={log.minutes} onChange={(e) => setLog((x) => ({ ...x, minutes: e.target.value }))} />
          <Button size="sm" disabled={!log.text.trim()} loading={addLog.isPending} onClick={() => addLog.mutate({ text: log.text, minutes: parseInt(log.minutes) || 0 }, { onSuccess: () => setLog({ text: '', minutes: '' }) })}>Log</Button>
        </div>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">Replaced components</h3>
        {job.replacedComponents.map((r: any) => (
          <div key={r.id} className="border-b border-line pb-2 text-sm">
            <div className="font-medium">{r.component_name}{r.part_name ? ` → ${r.part_name}` : ''}</div>
            <div className="font-mono text-xs text-ink-muted">{[r.old_part_number && `old ${r.old_part_number}`, r.new_part_number && `new ${r.new_part_number}`].filter(Boolean).join(' · ')}</div>
          </div>
        ))}
        <Select value={rc.componentTypeId} onChange={(e) => setRc((x) => ({ ...x, componentTypeId: e.target.value, partId: '' }))}>
          <option value="">Component type</option>
          {types.data?.componentTypes?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        {rc.componentTypeId && (
          <Select value={rc.partId} onChange={(e) => setRc((x) => ({ ...x, partId: e.target.value, newPartNumber: parts.data?.parts?.find((p: any) => p.id === e.target.value)?.part_number ?? x.newPartNumber }))}>
            <option value="">Part used (optional)</option>
            {parts.data?.parts?.map((p: any) => <option key={p.id} value={p.id}>{p.name} {p.part_number ? `(${p.part_number})` : ''}</option>)}
          </Select>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Old part #" value={rc.oldPartNumber} onChange={(e) => setRc((x) => ({ ...x, oldPartNumber: e.target.value }))} />
          <Input placeholder="New part #" value={rc.newPartNumber} onChange={(e) => setRc((x) => ({ ...x, newPartNumber: e.target.value }))} />
        </div>
        <Button
          size="sm"
          disabled={!rc.componentTypeId}
          loading={addRc.isPending}
          onClick={() => addRc.mutate({ componentTypeId: rc.componentTypeId, partId: rc.partId || null, oldPartNumber: rc.oldPartNumber || null, newPartNumber: rc.newPartNumber || null, notes: rc.notes || undefined }, { onSuccess: () => setRc({ componentTypeId: '', partId: '', oldPartNumber: '', newPartNumber: '', notes: '' }) })}
        >
          Record replacement
        </Button>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">Final tests</h3>
        {job.tests.map((t: any) => (
          <div key={t.id} className="flex items-center justify-between border-b border-line pb-2 text-sm">
            <span>{t.name}</span>
            {t.result === 'pass' ? <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>Pass</Badge> : <Badge tone="danger" icon={<XCircle className="h-3 w-3" />}>Fail</Badge>}
          </div>
        ))}
        <Input placeholder="Test performed" value={test.name} onChange={(e) => setTest((x) => ({ ...x, name: e.target.value }))} />
        <Segmented size="sm" value={test.result} onChange={(v) => setTest((x) => ({ ...x, result: v }))} options={[{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }]} />
        <Button size="sm" disabled={!test.name.trim()} loading={addTest.isPending} onClick={() => addTest.mutate({ name: test.name, result: test.result, notes: test.notes || undefined }, { onSuccess: () => setTest({ name: '', result: 'pass', notes: '' }) })}>Record test</Button>
      </Card>
    </div>
  );
}

function Report({ id }: { id: string }) {
  const r = useQuery({ queryKey: ['pro-report', id], queryFn: () => api.get(`/pro/jobs/${id}/report`) });
  if (!r.data) return null;
  const d = r.data;
  const list = (title: string, items: any[], render: (x: any) => React.ReactNode) =>
    items.length > 0 && (
      <div>
        <div className="eyebrow mb-1">{title}</div>
        <ul className="space-y-0.5">{items.map((x, i) => <li key={i}>• {render(x)}</li>)}</ul>
      </div>
    );
  return (
    <Card className="space-y-4 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">Repair report · Job #{d.jobNumber}</div>
          <div className="text-ink-muted">{d.business?.name} · {d.status} · generated {dateTime(d.generatedAt)}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.print()} icon={<Printer className="h-3.5 w-3.5" />}>Print</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><div className="eyebrow mb-1">Customer</div>{d.customer}</div>
        <div><div className="eyebrow mb-1">Device</div>{d.device?.nickname}{d.device?.product ? ` · ${d.device.product} ${d.device.model_number ?? ''}` : ''}{d.device?.serial_number ? ` · S/N ${d.device.serial_number}` : ''}</div>
        <div><div className="eyebrow mb-1">Reported issue</div>{d.reportedIssue}</div>
        <div><div className="eyebrow mb-1">Incoming condition</div>{d.intakeCondition || '—'}</div>
      </div>
      {list('AI suggestions (unconfirmed)', d.aiSuggestions, (x) => x)}
      {list('Technician findings', d.technicianFindings, (x) => x)}
      {list('Confirmed diagnosis', d.confirmedDiagnosis, (x) => <strong>{x}</strong>)}
      {list('Work performed', d.workPerformed, (x) => `${x.text} (${x.minutes} min)`)}
      {list('Replaced components', d.replacedComponents, (x) => `${x.component}${x.new_part_number ? ` — ${x.new_part_number}` : ''}`)}
      {list('Final tests', d.finalTests, (x) => `${x.name}: ${x.result}`)}
      <div className="font-semibold">Total: {money(d.totalCents)}</div>
    </Card>
  );
}

function CloseDialog({ job, id, open, onClose }: { job: any; id: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirmed = job.findings.find((f: any) => f.kind === 'confirmed_diagnosis');
  const [succeeded, setSucceeded] = useState(true);
  const [fmId, setFmId] = useState<string>(confirmed?.failure_mode_id ?? '');
  const [text, setText] = useState(confirmed?.text ?? '');
  const [contribute, setContribute] = useState(true);
  const close = useMutation({
    mutationFn: () => api.post(`/pro/jobs/${id}/close`, { succeeded, actualFailureModeId: fmId || null, actualFailureText: text || undefined, contributeToKnowledge: contribute }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pro-job', id] });
      toast(r.contributionId ? 'Job closed — outcome submitted for review' : 'Job closed');
      onClose();
    },
  });
  const options = [...new Map(job.findings.filter((f: any) => f.failure_mode_id).map((f: any) => [f.failure_mode_id, f])).values()] as any[];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Close repair job"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="accent" loading={close.isPending} onClick={() => close.mutate()}>Close job</Button></>}
    >
      <Field label="Outcome">
        <Segmented value={succeeded ? 'yes' : 'no'} onChange={(v) => setSucceeded(v === 'yes')} options={[{ value: 'yes', label: 'Repair succeeded' }, { value: 'no', label: 'Not successful' }]} />
      </Field>
      <Field label="Actual failure">
        <Select value={fmId} onChange={(e) => setFmId(e.target.value)}>
          <option value="">Not in the knowledge network</option>
          {options.map((f: any) => <option key={f.failure_mode_id} value={f.failure_mode_id}>{f.failure_mode_name}{f.kind === 'confirmed_diagnosis' ? ' (confirmed)' : ' (AI suggestion)'}</option>)}
        </Select>
      </Field>
      <Field label="Description of the actual failure" optional>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Checkbox checked={contribute} onChange={setContribute} label="Contribute this outcome to the knowledge network" description="Anonymised — no customer details or serial numbers — and reviewed before publication." />
      <ErrorNote error={close.error ? new Error(errorMessage(close.error)) : null} />
    </Dialog>
  );
}

export default function JobDetailPage() {
  const { id } = useParams() as { id: string };
  const [tab, setTab] = useState<Tab>('diagnosis');
  const [closing, setClosing] = useState(false);
  const q = useQuery({ queryKey: ['pro-job', id], queryFn: () => api.get(`/pro/jobs/${id}`) });
  const status = useJobMutation(id, (s: string) => api.post(`/pro/jobs/${id}/status`, { status: s }), 'Status updated');
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const job = q.data;
  const j = job.job;
  const transitions = (job.allowedTransitions as JobStatus[]).filter((s) => s !== 'completed');

  return (
    <div className="space-y-6">
      <Link to="/pro/jobs" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Jobs</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink-muted">Job #{j.number}</span>
            <JobStatusBadge status={j.status} />
          </div>
          <h1 className="display text-4xl leading-tight">{job.device?.product_name ? `${job.device.product_name} ${job.device.model_number ?? ''}` : job.device?.nickname}</h1>
          <div className="text-sm text-ink-muted">
            {j.customer_name}{j.customer_contact ? ` · ${j.customer_contact}` : ''}{job.device?.serial_number ? ` · S/N ${job.device.serial_number}` : ''}
          </div>
        </div>
        {job.outcome && (
          <div className="flex gap-2">
            <Badge tone={job.outcome.succeeded ? 'ok' : 'danger'}>{job.outcome.succeeded ? 'Repair succeeded' : 'Repair unsuccessful'}</Badge>
            <VerificationBadge status={job.outcome.verification_status} />
          </div>
        )}
      </div>

      {(transitions.length > 0 || j.status === 'testing') && (
        <Card className="flex flex-wrap items-center gap-2 py-4">
          <span className="mr-2 text-sm text-ink-muted">Move to</span>
          {transitions.map((s) => (
            <Button key={s} size="sm" variant={s === 'cancelled' ? 'ghost' : 'secondary'} loading={status.isPending && status.variables === s} onClick={() => status.mutate(s)}>
              {JOB_STATUS_LABELS[s]}
            </Button>
          ))}
          {j.status === 'testing' && <Button size="sm" variant="accent" onClick={() => setClosing(true)} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Close job</Button>}
        </Card>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'intake', label: 'Intake', count: job.attachments.length || undefined },
          { value: 'diagnosis', label: 'Diagnosis', count: job.findings.length || undefined },
          { value: 'quote', label: 'Quote', count: job.quote.items.length || undefined },
          { value: 'parts', label: 'Parts' },
          { value: 'work', label: 'Work & tests' },
          { value: 'copilot', label: 'Copilot' },
          { value: 'report', label: 'Report' },
        ]}
      />
      <div className="animate-fade-up">
        {tab === 'intake' && <Intake job={job} id={id} />}
        {tab === 'diagnosis' && <Diagnosis job={job} id={id} />}
        {tab === 'quote' && <Quote job={job} id={id} />}
        {tab === 'parts' && <Parts job={job} />}
        {tab === 'work' && <Work job={job} id={id} />}
        {tab === 'copilot' && <CopilotPanel jobId={id} />}
        {tab === 'report' && <Report id={id} />}
      </div>

      <Card className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> Status history</h3>
        <ol className="relative space-y-3 border-l border-line pl-5">
          {job.history.map((h: any) => (
            <li key={h.id} className="relative text-sm">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-ink ring-4 ring-paper-raised" />
              <span className="font-medium">{JOB_STATUS_LABELS[h.to_status as JobStatus]}</span>
              <span className="text-ink-muted"> · {dateTime(h.changed_at)}{h.display_name ? ` · ${h.display_name}` : ''}</span>
              {h.note && <div className="text-xs text-ink-muted">{h.note}</div>}
            </li>
          ))}
        </ol>
      </Card>
      {closing && <CloseDialog job={job} id={id} open={closing} onClose={() => setClosing(false)} />}
    </div>
  );
}
