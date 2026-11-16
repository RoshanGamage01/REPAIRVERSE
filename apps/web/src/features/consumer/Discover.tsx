import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Cpu, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { Badge, Card, DemoBadge, EmptyState, Input, PageHeader, Skeleton, Tabs, VerificationBadge } from '../../ui';
import { chip } from './components';

export default function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'products' | 'knowledge'>((params.get('tab') as any) ?? 'products');
  const [q, setQ] = useState(params.get('q') ?? '');
  const categoryId = params.get('categoryId') ?? '';
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const stats = useQuery({ queryKey: ['graph-stats'], queryFn: () => api.get('/knowledge/graph/stats') });
  const products = useQuery({ queryKey: ['discover-products', q, categoryId], queryFn: () => api.get(`/products${qs({ q, categoryId, limit: 48 })}`), enabled: tab === 'products' });
  const knowledge = useQuery({ queryKey: ['knowledge-search', q], queryFn: () => api.get(`/knowledge/search${qs({ q })}`), enabled: tab === 'knowledge' && q.trim().length >= 2 });
  const setCat = (id: string) => {
    const n = new URLSearchParams(params);
    id ? n.set('categoryId', id) : n.delete('categoryId');
    setParams(n);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Global repair knowledge network" title="Discover" description="Browse public product intelligence and search approved repair knowledge. Every item shows where it comes from." />
      {stats.data && (
        <div className="scroll-x text-sm">
          {[
            ['products', 'products'],
            ['components', 'components'],
            ['failure_modes', 'failure modes'],
            ['procedures', 'procedures'],
            ['sources', 'sources'],
            ['verified_outcomes', 'verified outcomes'],
          ].map(([k, l]) => (
            <span key={k} className="shrink-0 rounded-full bg-paper-raised px-3 py-1.5 ring-1 ring-line">
              <span className="font-semibold tabular-nums">{stats.data[k]}</span> <span className="text-ink-muted">{l}</span>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-4 top-4 h-5 w-5 text-ink-faint" />
        <Input className="h-14 rounded-2xl pl-12 text-base" placeholder={tab === 'products' ? 'Search products, brands or model numbers' : 'Search repair knowledge, e.g. "backlight flashlight test"'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Tabs tabs={[{ value: 'products', label: 'Products' }, { value: 'knowledge', label: 'Knowledge' }]} value={tab} onChange={setTab} />

      {tab === 'products' && (
        <>
          <div className="scroll-x">
            <button className={chip(!categoryId)} onClick={() => setCat('')}>
              All
            </button>
            {cats.data?.categories
              ?.filter((c: any) => !c.parent_id)
              .map((c: any) => (
                <button key={c.id} className={chip(categoryId === c.id)} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
          </div>
          {products.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : products.data?.products?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {products.data.products.map((p: any) => (
                <Link key={p.id} to={`/products/${p.slug}`} className="surface group flex flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper-sunken">
                      <Cpu className="h-5 w-5 text-ink-soft group-hover:text-accent" />
                    </div>
                    {p.is_demo ? <DemoBadge /> : <VerificationBadge status={p.verification_status} />}
                  </div>
                  <div>
                    <div className="font-semibold">
                      {p.brand_name} {p.name}
                    </div>
                    <div className="text-sm text-ink-muted">
                      <span className="font-mono">{p.model_number}</span> · {p.category_name}
                      {p.release_year ? ` · ${p.release_year}` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Search className="h-8 w-8" />} title="No products match" description="Products appear here once they're registered and published to the network." />
          )}
        </>
      )}

      {tab === 'knowledge' &&
        (q.trim().length < 2 ? (
          <EmptyState icon={<BookOpen className="h-8 w-8" />} title="Search approved repair knowledge" description="Only documents approved by reviewers are searchable. Results show their source and reliability." />
        ) : knowledge.isLoading ? (
          <Skeleton className="h-40" />
        ) : knowledge.data?.results?.length ? (
          <div className="space-y-3">
            {knowledge.data.results.map((r: any) => (
              <Card key={r.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.title}</span>
                  <Badge>{r.sourceKind.replace(/_/g, ' ')}</Badge>
                  {r.sourceKind === 'demo' && <DemoBadge />}
                  <span className="text-xs text-ink-muted">Reliability tier {r.reliabilityTier}/5</span>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{r.excerpt}</p>
                {r.url && (
                  <a className="link text-xs" href={r.url} target="_blank" rel="noreferrer">
                    Open source
                  </a>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No approved knowledge found" description="REPAIRVERSE only returns reviewed knowledge — it won't fill gaps with guesses." />
        ))}
    </div>
  );
}
