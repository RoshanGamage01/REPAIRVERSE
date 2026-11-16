import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { relative } from '../../lib/format';
import { Badge, Button, Card, Checkbox, DemoBadge, Dialog, ErrorNote, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea, VerificationBadge } from '../../ui';
import { useAction } from './common';

function useTaxonomy() {
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get('/brands') });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const sources = useQuery({ queryKey: ['admin-sources'], queryFn: () => api.get('/knowledge/sources?limit=100') });
  return { cats: cats.data?.categories ?? [], brands: brands.data?.brands ?? [], types: types.data?.componentTypes ?? [], sources: sources.data?.sources ?? [] };
}

function CreateProduct({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTaxonomy();
  const [f, setF] = useState({ categoryId: '', brandId: '', name: '', modelNumber: '', releaseYear: '', description: '', isPublic: false, gtin: '' });
  const create = useAction(
    () =>
      api.post('/products', {
        categoryId: f.categoryId,
        brandId: f.brandId || null,
        name: f.name,
        modelNumber: f.modelNumber || null,
        releaseYear: f.releaseYear ? Number(f.releaseYear) : null,
        description: f.description || null,
        isPublic: f.isPublic,
        identifiers: f.gtin ? [{ kind: 'gtin', value: f.gtin }] : [],
      }),
    { success: 'Product registered', invalidate: [['admin-products']], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onClose={onClose} title="Register product" footer={<Button loading={create.isPending} disabled={!f.categoryId || !f.name} onClick={() => create.mutate(undefined)}>Create</Button>}>
      <Field label="Category"><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Choose…</option>{t.cats.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</Select></Field>
      <Field label="Brand" optional><Select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">None / unknown</option>{t.brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Model number" optional><Input value={f.modelNumber} onChange={(e) => setF({ ...f, modelNumber: e.target.value })} /></Field>
        <Field label="Release year" optional><Input inputMode="numeric" value={f.releaseYear} onChange={(e) => setF({ ...f, releaseYear: e.target.value })} /></Field>
        <Field label="Barcode (GTIN)" optional><Input value={f.gtin} onChange={(e) => setF({ ...f, gtin: e.target.value })} /></Field>
      </div>
      <Field label="Description" optional><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Checkbox label="Publish publicly now" description="Public profiles show only knowledge — never private user or technician data." checked={f.isPublic} onChange={(v) => setF({ ...f, isPublic: v })} />
    </Dialog>
  );
}

function ProductEditor({ product, onClose }: { product: any; onClose: () => void }) {
  const t = useTaxonomy();
  const [tab, setTab] = useState<'spec' | 'variant' | 'component'>('spec');
  const [spec, setSpec] = useState({ key: '', value: '', unit: '', sourceId: '', isEstimate: false });
  const [variant, setVariant] = useState({ name: '', variantCode: '', hardwareRevision: '' });
  const [comp, setComp] = useState({ componentTypeId: '', name: '', attrs: '', sourceId: '' });
  const inv = [['admin-products'], ['product', product.id]];
  const addSpec = useAction(() => api.post(`/products/${product.id}/specs`, { key: spec.key, value: spec.value, unit: spec.unit || null, sourceId: spec.sourceId || null, isEstimate: spec.isEstimate }), { success: 'Specification added', invalidate: inv, onSuccess: () => setSpec({ key: '', value: '', unit: '', sourceId: '', isEstimate: false }) });
  const addVariant = useAction(() => api.post(`/products/${product.id}/variants`, variant), { success: 'Variant added', invalidate: inv, onSuccess: () => setVariant({ name: '', variantCode: '', hardwareRevision: '' }) });
  const attrs = Object.fromEntries(comp.attrs.split(',').map((p) => p.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0]));
  const addComp = useAction(() => api.post(`/products/${product.id}/components`, { componentTypeId: comp.componentTypeId, name: comp.name, attributes: attrs, sourceId: comp.sourceId || null }), { success: 'Component added', invalidate: inv, onSuccess: () => setComp({ componentTypeId: '', name: '', attrs: '', sourceId: '' }) });
  const fromTemplate = useAction(() => api.post(`/products/${product.id}/components/from-template`), { success: (r: any) => `${r.created} components created from the category template`, invalidate: inv });
  return (
    <Dialog open onClose={onClose} title={`${product.name} ${product.model_number ?? ''}`} wide>
      <Tabs tabs={[{ value: 'spec', label: 'Specification' }, { value: 'variant', label: 'Variant' }, { value: 'component', label: 'Component' }]} value={tab} onChange={setTab} />
      {tab === 'spec' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Key"><Input value={spec.key} onChange={(e) => setSpec({ ...spec, key: e.target.value })} placeholder="Battery capacity" /></Field>
            <Field label="Value"><Input value={spec.value} onChange={(e) => setSpec({ ...spec, value: e.target.value })} /></Field>
            <Field label="Unit" optional><Input value={spec.unit} onChange={(e) => setSpec({ ...spec, unit: e.target.value })} /></Field>
          </div>
          <Field label="Source" hint="Specifications must cite a reliable source — or be explicitly marked as an estimate."><Select value={spec.sourceId} onChange={(e) => setSpec({ ...spec, sourceId: e.target.value })}><option value="">No source</option>{t.sources.filter((s: any) => s.status === 'active').map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></Field>
          <Checkbox label="This is an estimate" checked={spec.isEstimate} onChange={(v) => setSpec({ ...spec, isEstimate: v })} />
          <Button loading={addSpec.isPending} disabled={!spec.key || !spec.value || (!spec.sourceId && !spec.isEstimate)} onClick={() => addSpec.mutate(undefined)}>Add specification</Button>
        </div>
      )}
      {tab === 'variant' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><Input value={variant.name} onChange={(e) => setVariant({ ...variant, name: e.target.value })} /></Field>
            <Field label="Variant code" optional><Input value={variant.variantCode} onChange={(e) => setVariant({ ...variant, variantCode: e.target.value })} /></Field>
            <Field label="Hardware revision" optional><Input value={variant.hardwareRevision} onChange={(e) => setVariant({ ...variant, hardwareRevision: e.target.value })} /></Field>
          </div>
          <Button loading={addVariant.isPending} disabled={!variant.name} onClick={() => addVariant.mutate(undefined)}>Add variant</Button>
        </div>
      )}
      {tab === 'component' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Component type"><Select value={comp.componentTypeId} onChange={(e) => setComp({ ...comp, componentTypeId: e.target.value })}><option value="">Choose…</option>{t.types.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Name"><Input value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} /></Field>
          </div>
          <Field label="Attributes" optional hint={`key=value, comma separated. Compared attributes for this type: ${t.types.find((c: any) => c.id === comp.componentTypeId)?.compat_attributes.join(', ') || '—'}`}><Input value={comp.attrs} onChange={(e) => setComp({ ...comp, attrs: e.target.value })} placeholder="connector_type=eDP 30-pin, size=14.0 in" /></Field>
          <Field label="Source" optional><Select value={comp.sourceId} onChange={(e) => setComp({ ...comp, sourceId: e.target.value })}><option value="">No source (unverified)</option>{t.sources.filter((s: any) => s.status === 'active').map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={addComp.isPending} disabled={!comp.componentTypeId || !comp.name} onClick={() => addComp.mutate(undefined)}>Add component</Button>
            <Button variant="secondary" loading={fromTemplate.isPending} onClick={() => fromTemplate.mutate(undefined)}>Create from category template</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function AdminProducts() {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const list = useQuery({ queryKey: ['admin-products', q], queryFn: () => api.get(`/products${qs({ q, all: 'true', limit: 100 })}`) });
  const publish = useAction((v: { id: string; isPublic: boolean }) => api.post(`/products/${v.id}/publish`, { isPublic: v.isPublic }), { success: 'Visibility updated', invalidate: [['admin-products']] });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Knowledge network" title="Products" description="All product records, including private drafts and community submissions awaiting review." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Register product</Button>} />
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-9" placeholder="Search name or model" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorNote error={list.error} />
      {list.isLoading && <Skeleton className="h-40" />}
      <div className="space-y-2">
        {list.data?.products.map((p: any) => (
          <Card key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.brand_name} {p.name}</span>
                <span className="font-mono text-xs text-ink-muted">{p.model_number}</span>
                {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
                <Badge tone={p.is_public ? 'ok' : 'neutral'}>{p.is_public ? 'Public' : 'Private'}</Badge>
              </div>
              <div className="text-xs text-ink-muted">{p.category_name}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Link to={`/products/${p.slug}`}><Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />}>Profile</Button></Link>
              <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit knowledge</Button>
              <Button size="sm" variant={p.is_public ? 'ghost' : 'primary'} onClick={() => publish.mutate({ id: p.id, isPublic: !p.is_public })}>{p.is_public ? 'Unpublish' : 'Publish'}</Button>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-faint">{list.data?.total ?? 0} products{list.data?.products?.[0] ? ` · updated ${relative(new Date())}` : ''}</p>
      <CreateProduct open={creating} onClose={() => setCreating(false)} />
      {editing && <ProductEditor product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
