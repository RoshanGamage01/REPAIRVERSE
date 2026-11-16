import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PlugZap, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { Badge, Card, DemoBadge, EmptyState, Field, Input, Notice, PageHeader, Section, Select, Skeleton, Tabs, VerificationBadge } from '../../ui';
import { classificationLabel, PartCompatCard, ProductPicker } from './components';

const GROUPS = [
  { key: 'confirmed', title: 'Confirmed compatible', desc: 'Backed by explicit, reviewed evidence for this product (and variant).' },
  { key: 'potential', title: 'Potentially compatible — unverified', desc: 'Recorded attributes match, or a claim awaits review. No documentation or verified repair confirms the fit yet.' },
  { key: 'unknown', title: 'Cannot assess', desc: 'Not enough recorded data to compare. Treat as unknown.' },
  { key: 'incompatible', title: 'Incompatible', desc: 'Explicit evidence or a recorded attribute mismatch rules these out.' },
] as const;

function ProductMode() {
  const [params, setParams] = useSearchParams();
  const productId = params.get('productId');
  const [product, setProduct] = useState<any>(null);
  const variantId = params.get('variantId') ?? '';
  const componentTypeId = params.get('componentTypeId') ?? '';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    setParams(n, { replace: true });
  };
  const profile = useQuery({ queryKey: ['product', productId], queryFn: () => api.get(`/products/${productId}`), enabled: !!productId });
  useEffect(() => {
    if (profile.data && !product) {
      const p = profile.data.product;
      setProduct({ id: p.id, name: p.name, model_number: p.modelNumber, brand_name: p.brand });
    }
  }, [profile.data, product]);
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const results = useQuery({ queryKey: ['parts-for', productId, variantId, componentTypeId], queryFn: () => api.get(`/parts/for-product/${productId}${qs({ variantId, componentTypeId })}`), enabled: !!productId });

  // Only offer component types the product actually has, when its breakdown is known.
  const productTypes = new Set<string>();
  const walk = (nodes: any[]) => nodes.forEach((n) => (productTypes.add(n.component_type_id), walk(n.children ?? [])));
  walk(profile.data?.components?.tree ?? []);
  const typeOptions = (types.data?.componentTypes ?? []).filter((t: any) => !productTypes.size || productTypes.has(t.id));

  return (
    <div className="space-y-6">
      <Card className="grid gap-4 md:grid-cols-3">
        <Field label="Product">
          <ProductPicker
            value={product}
            onChange={(p) => {
              setProduct(p);
              const n = new URLSearchParams();
              if (p) n.set('productId', p.id);
              setParams(n, { replace: true });
            }}
          />
        </Field>
        <Field label="Variant" hint={profile.data?.variants?.length ? 'Variants can need different parts.' : undefined}>
          <Select value={variantId} onChange={(e) => setParam('variantId', e.target.value)} disabled={!profile.data?.variants?.length}>
            <option value="">{profile.data?.variants?.length ? 'Not sure / any' : 'No variants recorded'}</option>
            {profile.data?.variants?.map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Component needed">
          <Select value={componentTypeId} onChange={(e) => setParam('componentTypeId', e.target.value)}>
            <option value="">All components</option>
            {typeOptions.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
      {!productId && <EmptyState icon={<Search className="h-8 w-8" />} title="Choose a product" description="We'll check every recorded part against it and show the evidence behind each verdict." />}
      {productId && results.isLoading && <Skeleton className="h-48" />}
      {results.data && (
        <div className="space-y-8">
          {results.data.variantRequired && (
            <Notice tone="warn" title="Select a variant for a precise answer">
              This product has variants that can use different parts. Without a variant, parts confirmed for only one variant are shown as unverified, and attribute checks use only what all variants share.
            </Notice>
          )}
          {GROUPS.map((g) => {
            const list = results.data[g.key] as any[];
            if (!list.length) return null;
            return (
              <Section key={g.key} title={`${g.title} (${list.length})`} description={g.desc}>
                <div className="grid gap-3 lg:grid-cols-2">
                  {list.map((r) => (
                    <PartCompatCard key={r.part.id} r={r} />
                  ))}
                </div>
              </Section>
            );
          })}
          {GROUPS.every((g) => !results.data[g.key].length) && <EmptyState title="No parts recorded for this selection" description="REPAIRVERSE does not invent parts catalogues. Parts appear once added by technicians, moderators or a configured provider." />}
        </div>
      )}
    </div>
  );
}

function SearchMode() {
  const [q, setQ] = useState('');
  const [pn, setPn] = useState('');
  const results = useQuery({ queryKey: ['parts-search', q, pn], queryFn: () => api.get(`/parts${qs({ q, partNumber: pn, limit: 40 })}`) });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
          <Input className="pl-10" placeholder="Component name, e.g. display panel" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Input placeholder="Exact part number" value={pn} onChange={(e) => setPn(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {results.data?.parts?.map((p: any) => (
          <Link key={p.id} to={`/parts/${p.id}`} className="surface space-y-2 p-4 hover:shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{p.name}</div>
              {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
            </div>
            <div className="text-xs text-ink-muted">
              {p.component_type} · <span className="font-mono">{p.part_number ?? 'no PN'}</span>
            </div>
            <Badge>{classificationLabel[p.classification]}</Badge>
          </Link>
        ))}
      </div>
      {results.data && !results.data.parts.length && <EmptyState title="No parts found" />}
    </div>
  );
}

export default function PartsDiscoveryPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'product' | 'search'>(params.get('productId') || !params.get('q') ? 'product' : 'search');
  const providers = useQuery({ queryKey: ['parts-providers'], queryFn: () => api.get('/parts/providers') });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Parts discovery" title="Find the right part" description="Compatibility from explicit relationships and recorded attributes — confirmed and unverified options are always kept apart, and you can inspect the evidence for each." />
      <Tabs tabs={[{ value: 'product', label: 'Parts for my product' }, { value: 'search', label: 'Search parts' }]} value={tab} onChange={setTab} />
      {tab === 'product' ? <ProductMode /> : <SearchMode />}
      {providers.data && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-ink-muted">
          <PlugZap className="h-3.5 w-3.5" /> Offer sources:
          {providers.data.providers.map((p: any) => (
            <Badge key={p.key} tone={p.configured ? 'ok' : 'neutral'}>
              {p.name}
              {p.configured ? '' : ' — integration requires configuration'}
            </Badge>
          ))}
          {providers.data.providers.length === 1 && <span>No external parts provider is configured; prices come only from verified manual entries.</span>}
        </div>
      )}
    </div>
  );
}
