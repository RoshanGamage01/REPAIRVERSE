import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History, Stethoscope, Wrench } from 'lucide-react';
import { api } from '../../lib/api';
import { date, money } from '../../lib/format';
import { Badge, cx, EmptyState, PageHeader, Skeleton } from '../../ui';
import { chip } from './components';

type Filter = 'all' | 'diagnoses' | 'repairs' | 'maintenance';

export default function HistoryPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const q = useQuery({ queryKey: ['history'], queryFn: () => api.get('/library/history') });
  if (q.isLoading) return <Skeleton className="h-60" />;
  const items = [
    ...(q.data?.diagnoses ?? []).map((d: any) => ({ type: 'diagnosis', at: d.created_at, d })),
    ...(q.data?.events ?? []).filter((e: any) => e.kind !== 'diagnosis').map((e: any) => ({ type: 'event', at: e.occurred_at, e })),
  ]
    .filter((i) =>
      filter === 'all'
        ? true
        : filter === 'diagnoses'
          ? i.type === 'diagnosis'
          : filter === 'repairs'
            ? i.type === 'event' && ['repair_attempt', 'repair_completed', 'component_replaced'].includes(i.e.kind)
            : i.type === 'event' && ['maintenance', 'receipt', 'warranty', 'note'].includes(i.e.kind),
    )
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Repair history" title="Everything you've fixed" description="Diagnoses, repairs, replaced components and maintenance across all your devices." />
      <div className="scroll-x">
        {(['all', 'diagnoses', 'repairs', 'maintenance'] as Filter[]).map((f) => (
          <button key={f} className={chip(filter === f)} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((i: any) =>
            i.type === 'diagnosis' ? (
              <Link key={`d${i.d.id}`} to={`/diagnose/${i.d.id}`} className="surface flex items-start gap-4 p-4 hover:shadow-soft">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-signal-soft text-signal">
                  <Stethoscope className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{i.d.product_name ?? i.d.category_name}{i.d.nickname ? ` · ${i.d.nickname}` : ''}</span>
                    <span className="text-xs text-ink-muted">{date(i.at)}</span>
                  </div>
                  <div className="text-sm text-ink-muted">
                    {i.d.result?.hypotheses?.[0] ? `Leading hypothesis: ${i.d.result.hypotheses[0].name} (${Math.round(i.d.result.hypotheses[0].probability * 100)}%, not confirmed)` : i.d.description}
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <Badge tone={i.d.status === 'completed' ? 'ok' : 'neutral'}>{i.d.status === 'completed' ? 'Completed' : 'In progress'}</Badge>
                    {i.d.saved && <Badge>Saved</Badge>}
                  </div>
                </div>
              </Link>
            ) : (
              <Link key={`e${i.e.id}`} to={`/devices/${i.e.device_id}`} className="surface flex items-start gap-4 p-4 hover:shadow-soft">
                <div className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', i.e.kind === 'repair_completed' ? 'bg-ok-soft text-ok' : 'bg-paper-sunken')}>
                  <Wrench className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{i.e.title}</span>
                    <span className="text-xs text-ink-muted">{date(i.at)}</span>
                  </div>
                  <div className="text-sm text-ink-muted">
                    {i.e.nickname}
                    {i.e.component_name ? ` · ${i.e.component_name}` : ''}
                    {i.e.cost_cents != null ? ` · ${money(i.e.cost_cents, i.e.currency)}` : ''}
                  </div>
                  {i.e.details && <p className="mt-1 text-sm text-ink-soft">{i.e.details}</p>}
                </div>
              </Link>
            ),
          )}
        </div>
      ) : (
        <EmptyState icon={<History className="h-8 w-8" />} title="Nothing here yet" description="Diagnoses you save and repairs you record will appear here." action={<Link to="/identify" className="link">Start a diagnosis</Link>} />
      )}
    </div>
  );
}
