import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowUpRight, FileCheck2, Flag, ScrollText, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { Card, cx, ErrorNote, PageHeader, Section, Segmented, Skeleton, Stat } from '../../ui';
import { Meter } from './common';

const fmt = (key: string, v: number | null) => {
  if (v == null) return '—';
  if (key.startsWith('cost_')) return `$${v.toFixed(4)}`;
  if (key === 'repeat_repair_incidents') return String(v);
  return `${Math.round(v * 1000) / 10}%`;
};

export default function AdminOverview() {
  const [days, setDays] = useState('30');
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api.get('/admin/overview') });
  const metrics = useQuery({ queryKey: ['admin-metrics', days], queryFn: () => api.get(`/admin/metrics?days=${days}`) });
  const c = overview.data?.counts;
  const queues = c
    ? [
        { label: 'Pending contributions', value: c.pending_contributions, to: '/admin/contributions', icon: FileCheck2 },
        { label: 'Verification requests', value: c.pending_verifications, to: '/admin/verification', icon: ShieldCheck },
        { label: 'Extractions to review', value: c.pending_extractions, to: '/admin/knowledge?tab=review', icon: ScrollText },
        { label: 'Open content reports', value: c.open_reports, to: '/admin/contributions?tab=reports', icon: Flag },
        { label: 'Dead background jobs', value: c.dead_jobs, to: '/admin/system', icon: AlertOctagon },
      ]
    : [];
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Administration" title="Control center" description="What needs attention, and whether REPAIRVERSE is producing successful repairs and trustworthy knowledge." />
      <ErrorNote error={overview.error} />
      <Section title="Needs attention">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {overview.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          {queues.map((q) => (
            <Link key={q.label} to={q.to} className={cx('surface group flex flex-col justify-between gap-3 p-4 transition hover:shadow-soft', q.value > 0 && 'ring-ink/30')}>
              <div className="flex items-center justify-between">
                <q.icon className={cx('h-4 w-4', q.value > 0 ? 'text-accent' : 'text-ink-faint')} />
                <ArrowUpRight className="h-4 w-4 text-ink-faint transition group-hover:text-ink" />
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">{q.value}</div>
                <div className="text-xs text-ink-muted">{q.label}</div>
              </div>
            </Link>
          ))}
        </div>
      </Section>
      {c && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">AI spend this month</h3>
              <Link to="/admin/ai" className="text-sm text-ink-muted hover:text-ink">Details</Link>
            </div>
            <div className="text-3xl font-semibold tabular-nums">${c.ai_cost_month.toFixed(2)}</div>
            <Meter value={c.ai_cost_month} max={overview.data.aiBudgetUsd} tone="accent" alertAbove={0.9} label={<><span>Budget used</span><span>of ${overview.data.aiBudgetUsd}</span></>} />
          </Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Users" value={c.users} />
            <Stat label="Technicians" value={c.technicians} />
            <Stat label="Organizations" value={c.organizations} />
            <Stat label="Diagnoses (7d)" value={c.diagnoses_7d} />
          </div>
        </div>
      )}
      <Section
        title="Product success metrics"
        description="Optimised for successful repairs and trustworthy knowledge — not engagement."
        actions={<Segmented size="sm" options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} value={days} onChange={setDays} />}
      >
        <ErrorNote error={metrics.error} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          {metrics.data?.metrics.map((m: any) => (
            <div key={m.key} className="surface space-y-2 p-4">
              <div className="text-xs font-medium text-ink-muted">{m.label}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{fmt(m.key, m.value)}</span>
                {m.value == null && <span className="text-xs text-ink-faint">not enough data</span>}
                {m.denominator != null && m.value != null && <span className="text-xs text-ink-muted tabular-nums">{m.numerator}/{m.denominator}</span>}
              </div>
              {m.value != null && typeof m.value === 'number' && m.value <= 1 && !m.key.startsWith('cost_') && <Meter value={m.value} max={1} />}
              {m.definition && <p className="text-xs leading-relaxed text-ink-faint">{m.definition}</p>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
