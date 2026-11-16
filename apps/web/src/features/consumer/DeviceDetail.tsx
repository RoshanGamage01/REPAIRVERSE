import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, Download, FileText, Plus, Receipt, ShieldCheck, Stethoscope, Trash2, Wrench, Hammer, Repeat, StickyNote, CircleDot } from 'lucide-react';
import { DEVICE_EVENT_KINDS } from '@repairverse/shared';
import { api, errorMessage } from '../../lib/api';
import { date, money, relative, toCents } from '../../lib/format';
import { Badge, Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorNote, FullPageSpinner, Field, Input, PageHeader, Section, Select, Stat, Textarea, useToast } from '../../ui';

const kindMeta: Record<string, { label: string; icon: any; tone: string }> = {
  registered: { label: 'Registered', icon: CircleDot, tone: 'bg-ink' },
  diagnosis: { label: 'Diagnosis', icon: Stethoscope, tone: 'bg-signal' },
  repair_attempt: { label: 'Repair attempt', icon: Hammer, tone: 'bg-warn' },
  repair_completed: { label: 'Repair completed', icon: CheckCircle2, tone: 'bg-ok' },
  component_replaced: { label: 'Component replaced', icon: Repeat, tone: 'bg-accent' },
  maintenance: { label: 'Maintenance', icon: Wrench, tone: 'bg-ink-soft' },
  warranty: { label: 'Warranty', icon: ShieldCheck, tone: 'bg-ok' },
  receipt: { label: 'Receipt', icon: Receipt, tone: 'bg-ink-muted' },
  note: { label: 'Note', icon: StickyNote, tone: 'bg-ink-faint' },
};

function AddEventDialog({ deviceId, open, onClose }: { deviceId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ kind: 'maintenance', title: '', details: '', cost: '', occurredAt: '', componentTypeId: '' });
  const [file, setFile] = useState<File | null>(null);
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: async () => {
      let fileId: string | null = null;
      if (file) fileId = (await api.upload([file], 'receipt')).files[0].id;
      return api.post(`/library/devices/${deviceId}/events`, {
        kind: f.kind,
        title: f.title || kindMeta[f.kind].label,
        details: f.details || undefined,
        costCents: f.cost ? toCents(f.cost) : null,
        occurredAt: f.occurredAt ? new Date(f.occurredAt).toISOString() : undefined,
        componentTypeId: f.componentTypeId || null,
        fileId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', deviceId] });
      toast('Added to timeline');
      setF({ kind: 'maintenance', title: '', details: '', cost: '', occurredAt: '', componentTypeId: '' });
      setFile(null);
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Add to timeline" footer={<Button loading={m.isPending} onClick={() => m.mutate()}>Add</Button>}>
      <Field label="What happened?">
        <Select value={f.kind} onChange={set('kind')}>
          {DEVICE_EVENT_KINDS.filter((k) => k !== 'registered' && k !== 'diagnosis').map((k) => (
            <option key={k} value={k}>
              {kindMeta[k].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <Input value={f.title} onChange={set('title')} placeholder={kindMeta[f.kind].label} />
      </Field>
      {f.kind === 'component_replaced' && (
        <Field label="Component">
          <Select value={f.componentTypeId} onChange={set('componentTypeId')}>
            <option value="">Choose…</option>
            {types.data?.componentTypes?.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Details" optional>
        <Textarea rows={3} value={f.details} onChange={set('details')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cost" optional>
          <Input inputMode="decimal" value={f.cost} onChange={set('cost')} />
        </Field>
        <Field label="Date" optional>
          <Input type="date" value={f.occurredAt} onChange={set('occurredAt')} />
        </Field>
      </div>
      {(f.kind === 'receipt' || f.kind === 'maintenance' || f.kind === 'warranty' || f.kind === 'repair_completed') && (
        <Field label="Attach receipt or photo" optional hint="Images have location metadata removed.">
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
        </Field>
      )}
      <ErrorNote error={m.error ? new Error(errorMessage(m.error)) : null} />
    </Dialog>
  );
}

export default function DeviceDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [reminder, setReminder] = useState({ title: '', dueAt: '' });
  const q = useQuery({ queryKey: ['device', id], queryFn: () => api.get(`/library/devices/${id}`) });
  const addReminder = useMutation({
    mutationFn: () => api.post(`/library/devices/${id}/reminders`, { title: reminder.title, dueAt: new Date(reminder.dueAt).toISOString() }),
    onSuccess: () => {
      setReminder({ title: '', dueAt: '' });
      qc.invalidateQueries({ queryKey: ['device', id] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const done = useMutation({ mutationFn: (rid: string) => api.patch(`/library/reminders/${rid}`, { done: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ['device', id] }) });
  const del = useMutation({
    mutationFn: () => api.del(`/library/devices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast('Device deleted');
      nav('/devices');
    },
  });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const { device: d, product, events, reminders, diagnoses, totals } = q.data;
  const warranty = d.warranty_expires ? new Date(d.warranty_expires) > new Date() : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="My device"
        title={d.nickname}
        description={product ? `${product.name} ${product.model_number ?? ''} · ${product.category_name}` : 'Not linked to a product in the knowledge network'}
        actions={
          <Link to={`/diagnose/new?${product ? `productId=${product.id}&` : ''}deviceId=${d.id}`}>
            <Button variant="accent" icon={<Stethoscope className="h-4 w-4" />} disabled={!product}>
              Diagnose a problem
            </Button>
          </Link>
        }
      />
      <div className="flex flex-wrap gap-2">
        {product?.is_demo && <DemoBadge />}
        {product && (
          <Link to={`/products/${product.slug}`}>
            <Badge>Product intelligence →</Badge>
          </Link>
        )}
        {warranty !== null && <Badge tone={warranty ? 'ok' : 'neutral'}>{warranty ? `Under warranty until ${date(d.warranty_expires)}` : `Warranty expired ${date(d.warranty_expires)}`}</Badge>}
        {d.serial_number && <Badge>S/N {d.serial_number}</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Purchased" value={d.purchase_date ? date(d.purchase_date) : '—'} />
        <Stat label="Purchase price" value={money(d.purchase_price_cents, d.currency)} />
        <Stat label="Repair spend" value={money(totals.repairCostCents, totals.currency)} />
        <Stat label="Diagnoses" value={diagnoses.length} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Section
          title="Timeline"
          description="The life and repair history of this object."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)} icon={<Plus className="h-3.5 w-3.5" />}>
              Add
            </Button>
          }
        >
          {events.length ? (
            <ol className="relative space-y-5 border-l border-line pl-6">
              {events.map((e: any) => {
                const m = kindMeta[e.kind] ?? kindMeta.note;
                const Icon = m.icon;
                return (
                  <li key={e.id} className="relative">
                    <span className={cx('absolute -left-[35px] flex h-6 w-6 items-center justify-center rounded-full text-white ring-4 ring-paper', m.tone)}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="font-medium">{e.title}</div>
                      <div className="text-xs text-ink-muted">{date(e.occurred_at)}</div>
                    </div>
                    <div className="text-xs text-ink-muted">
                      {m.label}
                      {e.component_name ? ` · ${e.component_name}` : ''}
                      {e.cost_cents != null ? ` · ${money(e.cost_cents, d.currency)}` : ''}
                    </div>
                    {e.details && <p className="mt-1 text-sm text-ink-soft">{e.details}</p>}
                    {e.diagnosis_id && (
                      <Link className="link text-xs" to={`/diagnose/${e.diagnosis_id}`}>
                        Open diagnosis
                      </Link>
                    )}
                    {e.file_id && (
                      <a className="link ml-2 text-xs" href={`/api/v1/files/${e.file_id}/raw`} target="_blank" rel="noreferrer">
                        <FileText className="mr-0.5 inline h-3 w-3" />
                        {e.file_name ?? 'Attachment'}
                      </a>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState title="No events yet" />
          )}
        </Section>

        <div className="space-y-8">
          <Section title="Reminders">
            <Card className="space-y-3">
              {reminders.filter((r: any) => !r.done).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <BellRing className={cx('h-4 w-4', new Date(r.due_at) < new Date() ? 'text-accent' : 'text-ink-muted')} />
                    {r.title}
                    <span className="text-xs text-ink-muted">{date(r.due_at)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => done.mutate(r.id)}>
                    Done
                  </Button>
                </div>
              ))}
              {!reminders.some((r: any) => !r.done) && <p className="text-sm text-ink-muted">No upcoming reminders.</p>}
              <div className="grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto_auto]">
                <Input placeholder="e.g. Clean the vents" value={reminder.title} onChange={(e) => setReminder((r) => ({ ...r, title: e.target.value }))} />
                <Input type="date" value={reminder.dueAt} onChange={(e) => setReminder((r) => ({ ...r, dueAt: e.target.value }))} />
                <Button variant="secondary" disabled={!reminder.title || !reminder.dueAt} loading={addReminder.isPending} onClick={() => addReminder.mutate()}>
                  Add
                </Button>
              </div>
            </Card>
          </Section>
          <Section title="Diagnoses">
            <div className="space-y-2">
              {diagnoses.map((x: any) => (
                <Link key={x.id} to={`/diagnose/${x.id}`} className="surface block p-4 hover:shadow-soft">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{x.result?.hypotheses?.[0]?.name ? `Hypothesis: ${x.result.hypotheses[0].name}` : 'Diagnosis'}</span>
                    <Badge tone={x.status === 'completed' ? 'ok' : 'neutral'}>{x.status}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-ink-muted">
                    {relative(x.created_at)} · {x.description}
                  </div>
                </Link>
              ))}
              {!diagnoses.length && <p className="text-sm text-ink-muted">None yet.</p>}
            </div>
          </Section>
          <Section title="Records">
            <div className="flex flex-wrap gap-2">
              <a href={`/api/v1/library/devices/${d.id}/export?format=json`}>
                <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                  Export JSON
                </Button>
              </a>
              <a href={`/api/v1/library/devices/${d.id}/export?format=csv`}>
                <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                  Export CSV
                </Button>
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  if (confirm('Delete this device and its entire history?')) del.mutate();
                }}
              >
                Delete device
              </Button>
            </div>
          </Section>
        </div>
      </div>
      <AddEventDialog deviceId={d.id} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
