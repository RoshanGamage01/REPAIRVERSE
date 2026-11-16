import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Package, Plus, Search, Store, Trash2 } from 'lucide-react';
import { COMPATIBILITY_STATES, PART_CLASSIFICATIONS } from '@repairverse/shared';
import { api, errorMessage, qs } from '../../lib/api';
import { toCents } from '../../lib/format';
import { Badge, Button, DemoBadge, Dialog, EmptyState, ErrorNote, Field, Input, Notice, PageHeader, Segmented, Select, Skeleton, Textarea, useToast, VerificationBadge } from '../../ui';
import { AttributesEditor, ProductPicker } from './common';

function AddPart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: '', partNumber: '', componentTypeId: '', classification: 'unknown', manufacturerId: '', description: '', attributes: {} as Record<string, string> });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const mfrs = useQuery({ queryKey: ['manufacturers'], queryFn: () => api.get('/manufacturers') });
  const save = useMutation({
    mutationFn: () => api.post('/parts', { ...f, partNumber: f.partNumber || null, manufacturerId: f.manufacturerId || null, description: f.description || null }),
    onSuccess: () => {
      toast('Part added — pending review');
      qc.invalidateQueries({ queryKey: ['pro-parts'] });
      onClose();
    },
  });
  const t = types.data?.componentTypes?.find((x: any) => x.id === f.componentTypeId);
  return (
    <Dialog open={open} onClose={onClose} title="Add a part" wide footer={<Button disabled={!f.name || !f.componentTypeId} loading={save.isPending} onClick={() => save.mutate()}>Save part</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Part number" optional><Input value={f.partNumber} onChange={(e) => setF((x) => ({ ...x, partNumber: e.target.value }))} /></Field>
        <Field label="Component type">
          <Select value={f.componentTypeId} onChange={(e) => setF((x) => ({ ...x, componentTypeId: e.target.value }))}>
            <option value="">Choose…</option>
            {types.data?.componentTypes?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Manufacturer" optional>
          <Select value={f.manufacturerId} onChange={(e) => setF((x) => ({ ...x, manufacturerId: e.target.value }))}>
            <option value="">Unknown</option>
            {mfrs.data?.manufacturers?.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Classification">
        <Segmented size="sm" value={f.classification} onChange={(v) => setF((x) => ({ ...x, classification: v }))} options={PART_CLASSIFICATIONS.map((c) => ({ value: c, label: c.replace('_', ' ') }))} />
      </Field>
      <Field label="Attributes" hint={t?.compat_attributes?.length ? `The compatibility engine compares: ${t.compat_attributes.join(', ')}` : 'Recorded specifications'}>
        <AttributesEditor value={f.attributes} onChange={(a) => setF((x) => ({ ...x, attributes: a }))} suggestions={t?.compat_attributes ?? []} />
      </Field>
      <ErrorNote error={save.error ? new Error(errorMessage(save.error)) : null} />
    </Dialog>
  );
}

function RecordCompat({ part, onClose }: { part: any; onClose: () => void }) {
  const toast = useToast();
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [variantId, setVariantId] = useState('');
  const [state, setState] = useState<string>('confirmed');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState<{ kind: string; description: string }[]>([]);
  const [ev, setEv] = useState({ kind: 'technician_report', description: '' });
  const prod = useQuery({ queryKey: ['product', product?.id], queryFn: () => api.get(`/products/${product!.id}`), enabled: !!product });
  const save = useMutation({
    mutationFn: () => api.post('/parts/compatibility', { partId: part.id, productId: product!.id, variantId: variantId || null, state, notes: notes || null, evidence }),
    onSuccess: (r) => {
      toast(r.verificationStatus === 'verified' ? 'Compatibility recorded' : 'Submitted for review');
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Record compatibility · ${part.name}`} wide footer={<Button disabled={!product || !evidence.length} loading={save.isPending} onClick={() => save.mutate()}>Submit</Button>}>
      <Notice tone="info">Compatibility is never inferred from names or appearance. Your record and its evidence go to moderation before it counts as confirmed.</Notice>
      <Field label="Product"><ProductPicker value={product} onChange={setProduct} /></Field>
      {prod.data?.variants?.length > 0 && (
        <Field label="Variant" optional>
          <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">All variants</option>
            {prod.data.variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
      )}
      <Field label="State">
        <Segmented size="sm" value={state} onChange={setState} options={COMPATIBILITY_STATES.map((s) => ({ value: s, label: s }))} />
      </Field>
      <Field label="Notes" optional><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Field label="Evidence (at least one)">
        <div className="space-y-2">
          {evidence.map((e, i) => (
            <div key={i} className="flex items-start justify-between gap-2 text-sm">
              <span><Badge>{e.kind.replace('_', ' ')}</Badge> {e.description}</span>
              <button className="text-ink-faint hover:text-danger" onClick={() => setEvidence((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
            <Select value={ev.kind} onChange={(e) => setEv((x) => ({ ...x, kind: e.target.value }))}>
              {['technician_report', 'verified_repair', 'manufacturer_documentation', 'attribute_match', 'community'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
            </Select>
            <Input placeholder="What did you observe / where is it documented?" value={ev.description} onChange={(e) => setEv((x) => ({ ...x, description: e.target.value }))} />
            <Button variant="secondary" disabled={!ev.description.trim()} onClick={() => { setEvidence((x) => [...x, ev]); setEv({ kind: ev.kind, description: '' }); }} icon={<Plus className="h-4 w-4" />} />
          </div>
        </div>
      </Field>
      <ErrorNote error={save.error ? new Error(errorMessage(save.error)) : null} />
    </Dialog>
  );
}

function AddOffer({ part, onClose }: { part: any; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ seller: '', url: '', price: '', currency: 'USD', availability: 'unknown' });
  const save = useMutation({
    mutationFn: () => api.post(`/parts/${part.id}/offers`, { seller: f.seller, url: f.url || null, priceCents: f.price ? toCents(f.price) : null, currency: f.currency, availability: f.availability }),
    onSuccess: () => {
      toast('Verified offer added');
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Add verified offer · ${part.name}`} footer={<Button disabled={!f.seller || (!f.price && !f.url)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
      <Notice tone="info">Only enter prices you have personally checked at the source. Offers are timestamped and expire from view after 90 days.</Notice>
      <Field label="Seller"><Input value={f.seller} onChange={(e) => setF((x) => ({ ...x, seller: e.target.value }))} /></Field>
      <Field label="Listing URL" optional><Input value={f.url} onChange={(e) => setF((x) => ({ ...x, url: e.target.value }))} placeholder="https://" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price" optional><Input inputMode="decimal" value={f.price} onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))} /></Field>
        <Field label="Currency"><Input maxLength={3} value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} /></Field>
      </div>
      <Field label="Availability">
        <Segmented size="sm" value={f.availability} onChange={(v) => setF((x) => ({ ...x, availability: v }))} options={['in_stock', 'limited', 'out_of_stock', 'unknown'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))} />
      </Field>
      <ErrorNote error={save.error ? new Error(errorMessage(save.error)) : null} />
    </Dialog>
  );
}

export default function ProPartsPage() {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [compat, setCompat] = useState<any>(null);
  const [offer, setOffer] = useState<any>(null);
  const { data, isLoading } = useQuery({ queryKey: ['pro-parts', q], queryFn: () => api.get(`/parts${qs({ q, limit: 60 })}`) });
  return (
    <div className="space-y-6">
      <PageHeader title="Parts" description="Search the parts database, record compatibility evidence, and add verified offers." actions={<Button variant="accent" onClick={() => setAdding(true)} icon={<Plus className="h-4 w-4" />}>Add part</Button>} />
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-10" placeholder="Name, part number or component type" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !data?.parts?.length ? <EmptyState icon={<Package className="h-8 w-8" />} title="No parts found" /> : (
        <div className="surface divide-y divide-line">
          {data.parts.map((p: any) => (
            <div key={p.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/parts/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                  {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
                </div>
                <div className="text-xs text-ink-muted">
                  <span className="font-mono">{p.part_number ?? '—'}</span> · {p.component_type} · {p.classification.replace('_', ' ')}{p.manufacturer ? ` · ${p.manufacturer}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" onClick={() => setCompat(p)} icon={<Link2 className="h-3.5 w-3.5" />}>Compatibility</Button>
                <Button size="sm" variant="ghost" onClick={() => setOffer(p)} icon={<Store className="h-3.5 w-3.5" />}>Offer</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <AddPart open={adding} onClose={() => setAdding(false)} />
      {compat && <RecordCompat part={compat} onClose={() => setCompat(null)} />}
      {offer && <AddOffer part={offer} onClose={() => setOffer(null)} />}
    </div>
  );
}
