import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { RISK_LEVELS } from '@repairverse/shared';
import { api, qs } from '../../lib/api';
import { Badge, Button, Card, DemoBadge, Dialog, ErrorNote, Field, Input, PageHeader, RiskBadge, Select, Skeleton, Tabs, Textarea, VerificationBadge } from '../../ui';
import { useAction } from './common';

function NewComponentType({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: '', description: '', defaultRisk: 'medium', attrs: '' });
  const create = useAction(() => api.post('/knowledge/component-types', { name: f.name, description: f.description || null, defaultRisk: f.defaultRisk, compatAttributes: f.attrs.split(',').map((s) => s.trim()).filter(Boolean) }), {
    success: 'Component type created',
    invalidate: [['component-types']],
    onSuccess: () => (onClose(), setF({ name: '', description: '', defaultRisk: 'medium', attrs: '' })),
  });
  return (
    <Dialog open={open} onClose={onClose} title="New component type" footer={<Button loading={create.isPending} disabled={f.name.length < 2} onClick={() => create.mutate(undefined)}>Create</Button>}>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Hinge assembly" /></Field>
      <Field label="Description" optional><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Default risk"><Select value={f.defaultRisk} onChange={(e) => setF({ ...f, defaultRisk: e.target.value })}>{RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
      <Field label="Compatibility attributes" hint="Comma-separated. The compatibility engine compares exactly these attributes — never names or appearance.">
        <Input value={f.attrs} onChange={(e) => setF({ ...f, attrs: e.target.value })} placeholder="connector_type, voltage, dimensions" />
      </Field>
    </Dialog>
  );
}

export default function AdminComponents() {
  const [tab, setTab] = useState<'types' | 'parts'>('types');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const parts = useQuery({ queryKey: ['admin-parts', q], queryFn: () => api.get(`/parts${qs({ q, limit: 100 })}`), enabled: tab === 'parts' });
  const [openPart, setOpenPart] = useState<string | null>(null);
  const part = useQuery({ queryKey: ['part', openPart], queryFn: () => api.get(`/parts/${openPart}`), enabled: !!openPart });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Knowledge network" title="Components" description="The category-independent component taxonomy, and the parts catalogue with evidence-backed compatibility." actions={tab === 'types' && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New component type</Button>} />
      <Tabs tabs={[{ value: 'types', label: 'Component types', count: types.data?.componentTypes.length }, { value: 'parts', label: 'Parts catalogue' }]} value={tab} onChange={setTab} />
      <ErrorNote error={types.error ?? parts.error} />
      {tab === 'types' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.isLoading && <Skeleton className="h-24" />}
          {types.data?.componentTypes.map((t: any) => (
            <div key={t.id} className="surface space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="font-mono text-xs text-ink-faint">{t.slug}</div>
                </div>
                <RiskBadge level={t.default_risk} />
              </div>
              <div className="flex flex-wrap gap-1">
                {t.compat_attributes.length ? t.compat_attributes.map((a: string) => <Badge key={a} tone="signal">{a}</Badge>) : <span className="text-xs text-ink-muted">No comparable attributes</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-ink-faint" />
            <Input className="pl-9" placeholder="Search name, part number or type" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {parts.data?.parts.map((p: any) => (
              <button key={p.id} onClick={() => setOpenPart(p.id)} className="surface space-y-2 p-4 text-left transition hover:shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-ink-muted">{p.part_number ?? 'no part number'} · {p.component_type}</div>
                  </div>
                  {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge>{p.classification.replace('_', ' ')}</Badge>
                  {Object.entries(p.attributes ?? {}).map(([k, v]) => <Badge key={k} tone="neutral">{k}: {String(v)}</Badge>)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <NewComponentType open={open} onClose={() => setOpen(false)} />
      <Dialog open={!!openPart} onClose={() => setOpenPart(null)} title={part.data?.part.name ?? 'Part'} wide>
        {part.data && (
          <div className="space-y-3">
            <div className="text-sm text-ink-muted">{part.data.part.component_type} · {part.data.part.manufacturer ?? 'Unknown manufacturer'} · {part.data.offers.length} sourced offers</div>
            <h4 className="font-semibold">Compatibility relations</h4>
            {part.data.compatibility.length === 0 && <p className="text-sm text-ink-muted">No explicit relations. Compatibility will be assessed by attribute rules only (never "confirmed").</p>}
            {part.data.compatibility.map((c: any) => (
              <Card key={c.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link className="link text-sm" to={`/products/${c.product_slug}`}>{c.product_name} {c.model_number}{c.variant_name ? ` · ${c.variant_name}` : ''}</Link>
                  <span className="flex gap-1.5"><Badge tone={c.state === 'confirmed' ? 'ok' : c.state === 'incompatible' ? 'danger' : 'warn'}>{c.state}</Badge><VerificationBadge status={c.verification_status} /></span>
                </div>
                <ul className="space-y-1 text-xs text-ink-muted">{c.evidence.map((e: any, i: number) => <li key={i}>• [{e.kind}] {e.description}{e.sourceTitle ? ` — ${e.sourceTitle}` : ''}</li>)}</ul>
              </Card>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}
