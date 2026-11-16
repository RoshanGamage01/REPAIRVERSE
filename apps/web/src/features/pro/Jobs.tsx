import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Plus, Search } from 'lucide-react';
import { JOB_STATUSES, JOB_STATUS_LABELS } from '@repairverse/shared';
import { api, qs } from '../../lib/api';
import { relative } from '../../lib/format';
import { Button, EmptyState, Input, PageHeader, Segmented, Skeleton } from '../../ui';
import { JobStatusBadge } from './common';

export default function ProJobsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['pro-jobs', status, q], queryFn: () => api.get(`/pro/jobs${qs({ status: status === 'all' ? undefined : status, q, limit: 100 })}`) });
  return (
    <div className="space-y-6">
      <PageHeader title="Repair jobs" actions={<Link to="/pro/jobs/new"><Button variant="accent" icon={<Plus className="h-4 w-4" />}>New job</Button></Link>} />
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-10" placeholder="Search customer, device, complaint or job #" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll-x">
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => setParams(v === 'all' ? {} : { status: v })}
          options={[{ value: 'all', label: 'All' }, ...JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABELS[s] }))]}
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data?.jobs?.length ? (
        <EmptyState icon={<Briefcase className="h-8 w-8" />} title="No jobs here" description="Jobs you create appear here with their status." />
      ) : (
        <div className="surface divide-y divide-line">
          {data.jobs.map((j: any) => (
            <Link key={j.id} to={`/pro/jobs/${j.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-ink/[.02] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="font-mono text-ink-muted">#{j.number}</span>
                  <span className="truncate">{j.customer_name}</span>
                </div>
                <div className="truncate text-sm text-ink-soft">{j.device}{j.product_name ? ` · ${j.product_name} ${j.model_number ?? ''}` : ''}</div>
                <div className="truncate text-xs text-ink-muted">{j.complaint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <JobStatusBadge status={j.status} />
                <span className="text-xs text-ink-faint">{relative(j.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
