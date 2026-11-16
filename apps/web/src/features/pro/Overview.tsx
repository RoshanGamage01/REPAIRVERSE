import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import { JOB_STATUSES, JOB_STATUS_LABELS } from '@repairverse/shared';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Button, Card, cx, EmptyState, FullPageSpinner, Notice, PageHeader, Stat } from '../../ui';
import { JobStatusBadge } from './common';

export default function ProOverviewPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['pro-overview'], queryFn: () => api.get('/pro/overview') });
  if (isLoading) return <FullPageSpinner />;
  const count = (s: string) => data?.byStatus?.find((x: any) => x.status === s)?.n ?? 0;
  const o = data?.outcomes ?? {};
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={user?.memberships[0]?.name ?? 'Workspace'}
        title="Today at the bench"
        actions={
          <Link to="/pro/jobs/new">
            <Button variant="accent" icon={<Plus className="h-4 w-4" />}>New repair job</Button>
          </Link>
        }
      />
      {data?.technicianVerified ? (
        <Notice tone="ok" icon={<ShieldCheck className="h-4 w-4" />} title="Verified technician">Your credentials have been reviewed. High-risk diagnostic tests and procedures are available to you.</Notice>
      ) : (
        <Notice tone="warn" icon={<ShieldAlert className="h-4 w-4" />} title="Credentials not yet verified">
          Your profile shows as unverified until an administrator reviews your qualifications. High-risk procedures stay restricted until then.{' '}
          <Link className="link" to="/pro/settings">Request verification</Link>
        </Notice>
      )}
      <div className="scroll-x">
        {JOB_STATUSES.filter((s) => s !== 'cancelled').map((s, i) => (
          <Link key={s} to={`/pro/jobs?status=${s}`} className={cx('surface flex min-w-[118px] shrink-0 flex-col gap-1 p-3 transition hover:ring-ink/30')}>
            <span className="text-2xl font-semibold tabular-nums">{count(s)}</span>
            <span className="text-xs text-ink-muted">{i + 1}. {JOB_STATUS_LABELS[s]}</span>
          </Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Repairs closed" value={o.total ?? 0} />
        <Stat label="Successful" value={o.total ? `${Math.round((o.succeeded / o.total) * 100)}%` : '—'} hint={`${o.succeeded ?? 0} of ${o.total ?? 0}`} tone="ok" />
        <Stat label="AI suggestion accuracy" value={o.ai_evaluated ? `${o.ai_top_correct}/${o.ai_evaluated}` : '—'} hint="AI suggestion matched confirmed diagnosis" />
        <Stat label="Reputation" value={Number(data?.reputation ?? 0).toFixed(1)} hint={`${data?.contributions?.approved ?? 0} approved · ${data?.contributions?.pending ?? 0} pending`} tone="accent" />
      </div>
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Active jobs</h2>
          <Link to="/pro/jobs" className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink">All jobs <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        {!data?.recent?.length ? (
          <EmptyState title="No active jobs" description="Create a repair job when a device comes in." />
        ) : (
          data.recent.map((j: any) => (
            <Link key={j.id} to={`/pro/jobs/${j.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-xl p-2 hover:bg-ink/[.03]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">#{j.number} · {j.customer_name} · {j.device}</div>
                <div className="truncate text-xs text-ink-muted">{j.complaint}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <JobStatusBadge status={j.status} />
                <span className="hidden text-xs text-ink-faint sm:inline">{relative(j.updated_at)}</span>
              </div>
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
