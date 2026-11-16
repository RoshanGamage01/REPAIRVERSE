import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Plus, Search } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { useAuth, isStaff } from '../../lib/auth';
import { Button, DemoBadge, Dialog, EmptyState, ErrorNote, Field, Input, Notice, PageHeader, Select, Skeleton, useToast, VerificationBadge } from '../../ui';
import { AttributesEditor } from './common';

function RegisterProduct({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [f, setF] = useState({ categoryId: '', brandId: '', name: '', modelNumber: '', releaseYear: '', gtin: '' });
  const [created, setCreated] = useState<{ id: string; status: string } | null>(null);
  const [comp, setComp] = useState({ componentTypeId: '', name: '', attributes: {} as Record<string, string> });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get('/brands') });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const create = useMutation({
    mutationFn: () =>
      api.post('/products', {
        categoryId: f.categoryId,
        brandId: f.brandId || null,
        name: f.name,
        modelNumber: f.modelNumber || null,
        releaseYear: f.releaseYear ? Number(f.releaseYear) : null,
        identifiers: f.gtin ? [{ kind: 'gtin', value: f.gtin }] : [],
      }),
    onSuccess: (r) => {
      setCreated(r);
      qc.invalidateQueries({ queryKey: ['pro-products'] });
    },
  });
  const template = useMutation({ mutationFn: () => api.post(`/products/${created!.id}/components/from-template`, {}), onSuccess: (r) => toast(`${r.created} typical components added`), onError: (e) => toast(errorMessage(e), 'danger') });
  const addComp = useMutation({
    mutationFn: () => api.post(`/products/${created!.id}/components`, comp),
    onSuccess: () => {
      toast('Component added');
      setComp({ componentTypeId: '', name: '', attributes: {} });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const selectedType = types.data?.componentTypes?.find((t: any) => t.id === comp.componentTypeId);
  const close = () => {
    setCreated(null);
    setF({ categoryId: '', brandId: '', name: '', modelNumber: '', releaseYear: '', gtin: '' });
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={created ? 'Add components' : 'Register a product'} wide>
      {!created ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={f.categoryId} onChange={(e) => setF((x) => ({ ...x, categoryId: e.target.value }))}>
                <option value="">Choose…</option>
                {cats.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Brand" optional>
              <Select value={f.brandId} onChange={(e) => setF((x) => ({ ...x, brandId: e.target.value }))}>
                <option value="">Not listed</option>
                {brands.data?.brands?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Product name"><Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
            <Field label="Model number" optional><Input value={f.modelNumber} onChange={(e) => setF((x) => ({ ...x, modelNumber: e.target.value }))} /></Field>
            <Field label="Release year" optional><Input inputMode="numeric" value={f.releaseYear} onChange={(e) => setF((x) => ({ ...x, releaseYear: e.target.value }))} /></Field>
            <Field label="Barcode / GTIN" optional><Input inputMode="numeric" value={f.gtin} onChange={(e) => setF((x) => ({ ...x, gtin: e.target.value }))} /></Field>
          </div>
          {!isStaff(user) && <Notice tone="info">New products are saved privately and submitted for moderation. They become public once a moderator approves them.</Notice>}
          <ErrorNote error={create.error ? new Error(errorMessage(create.error)) : null} />
          <Button disabled={!f.categoryId || !f.name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Register product</Button>
        </>
      ) : (
        <>
          <Notice tone="ok">Product registered{created.status === 'pending_review' ? ' — pending review' : ''}. Add its component breakdown.</Notice>
          <Button variant="secondary" loading={template.isPending} onClick={() => template.mutate()}>Add typical components for this category</Button>
          <div className="space-y-3 border-t border-line pt-4">
            <Field label="Component type">
              <Select value={comp.componentTypeId} onChange={(e) => setComp((x) => ({ ...x, componentTypeId: e.target.value, name: x.name || types.data?.componentTypes?.find((t: any) => t.id === e.target.value)?.name || '' }))}>
                <option value="">Choose…</option>
                {types.data?.componentTypes?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Name"><Input value={comp.name} onChange={(e) => setComp((x) => ({ ...x, name: e.target.value }))} /></Field>
            <Field label="Attributes" hint="Used by the compatibility engine (e.g. connector type, voltage, dimensions). Only enter verified values.">
              <AttributesEditor value={comp.attributes} onChange={(a) => setComp((x) => ({ ...x, attributes: a }))} suggestions={selectedType?.compat_attributes ?? []} />
            </Field>
            <Button size="sm" disabled={!comp.componentTypeId || !comp.name.trim()} loading={addComp.isPending} onClick={() => addComp.mutate()} icon={<Plus className="h-3.5 w-3.5" />}>Add component</Button>
          </div>
          <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
        </>
      )}
    </Dialog>
  );
}

export default function ProProductsPage() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['pro-products', q], queryFn: () => api.get(`/products${qs({ q, limit: 50 })}`) });
  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="Browse the knowledge network or register products you repair." actions={<Button variant="accent" onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" />}>Register a product</Button>} />
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-10" placeholder="Search name, model or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !data?.products?.length ? <EmptyState icon={<Cpu className="h-8 w-8" />} title="No products found" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((p: any) => (
            <Link key={p.id} to={`/products/${p.slug}`} className="surface space-y-2 p-4 transition hover:shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
                {!p.is_public && <span className="text-xs text-ink-muted">Private draft</span>}
              </div>
              <div className="font-semibold">{p.brand_name} {p.name}</div>
              <div className="text-sm text-ink-muted">{p.model_number} · {p.category_name}</div>
            </Link>
          ))}
        </div>
      )}
      <RegisterProduct open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
