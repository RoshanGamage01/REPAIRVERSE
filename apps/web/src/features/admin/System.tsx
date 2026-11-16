import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Database, HardDrive, RefreshCw, Server } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { dateTime, relative } from '../../lib/format';
import { Badge, Button, Card, Disclosure, ErrorNote, Input, KeyValue, PageHeader, Segmented, Skeleton, Table, Tabs, Td } from '../../ui';
import { JsonView, STATUS_TONE, useAction } from './common';

function Health() {
  const h = useQuery({ queryKey: ['admin-health'], queryFn: () => api.get('/admin/system/health'), refetchInterval: 15000 });
  if (h.isLoading) return <Skeleton className="h-64" />;
  if (h.error) return <ErrorNote error={h.error} />;
  const d = h.data;
  const ok = (b: boolean) => <Badge tone={b ? 'ok' : 'warn'}>{b ? 'OK' : 'Attention'}</Badge>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><Database className="h-4 w-4" /> Database {ok(d.database.status === 'ok')}</h3>
        <KeyValue items={[
          { label: 'Latency', value: `${d.database.latencyMs} ms` },
          { label: 'Size', value: d.database.size },
          { label: 'Pool (total/idle/waiting)', value: `${d.database.pool.total}/${d.database.pool.idle}/${d.database.pool.waiting}` },
          { label: 'Extensions', value: d.database.extensions.map((e: any) => `${e.extname} ${e.extversion}`).join(', ') },
        ]} />
      </Card>
      <Card className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><Server className="h-4 w-4" /> Runtime</h3>
        <KeyValue items={[
          { label: 'Version', value: d.version },
          { label: 'Uptime', value: `${Math.floor(d.uptimeSeconds / 3600)}h ${Math.floor((d.uptimeSeconds % 3600) / 60)}m` },
          { label: 'Memory (RSS)', value: `${d.memoryMb} MB` },
          { label: 'Redis', value: <Badge tone={d.redis === 'connected' ? 'ok' : d.redis === 'not_configured' ? 'neutral' : 'warn'}>{d.redis.replace('_', ' ')}</Badge> },
          { label: 'Object storage', value: d.storage },
        ]} />
      </Card>
      <Card className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4" /> Background queue</h3>
        <KeyValue items={d.queue.length ? d.queue.map((q: any) => ({ label: q.status, value: q.n })) : [{ label: 'Jobs', value: 'none' }]} />
      </Card>
      <Card className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><HardDrive className="h-4 w-4" /> Integrations</h3>
        <KeyValue items={[
          ...Object.entries(d.ai).map(([cap, v]: any) => ({ label: `AI · ${cap}`, value: <Badge tone={v.configured && v.enabled ? 'ok' : 'neutral'}>{v.configured ? (v.enabled ? v.model : 'disabled') : 'not configured'}</Badge> })),
          ...d.partsProviders.map((p: any) => ({ label: `Parts · ${p.name}`, value: <Badge tone={p.configured ? 'ok' : 'neutral'}>{p.configured ? 'configured' : 'requires configuration'}</Badge> })),
        ]} />
      </Card>
    </div>
  );
}

function Jobs() {
  const [status, setStatus] = useState('all');
  const q = useQuery({ queryKey: ['admin-jobs', status], queryFn: () => api.get(`/admin/jobs${qs({ status: status === 'all' ? '' : status })}`) });
  const retry = useAction((id: string) => api.post(`/admin/jobs/${id}/retry`), { success: 'Job re-queued', invalidate: [['admin-jobs']] });
  return (
    <div className="space-y-4">
      <Segmented size="sm" options={['all', 'queued', 'running', 'succeeded', 'dead'].map((v) => ({ value: v, label: v }))} value={status} onChange={setStatus} />
      <ErrorNote error={q.error} />
      <Table head={['Job', 'Status', 'Attempts', 'Updated', '']}>
        {q.data?.jobs.map((j: any) => (
          <tr key={j.id}>
            <Td>
              <div className="font-medium">{j.type}</div>
              <div className="font-mono text-xs text-ink-faint">{j.id.slice(0, 8)}</div>
              {j.last_error && <div className="mt-1 max-w-md text-xs text-danger">{j.last_error}</div>}
            </Td>
            <Td><Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge></Td>
            <Td className="tabular-nums">{j.attempts}/{j.max_attempts}</Td>
            <Td className="text-ink-muted">{relative(j.updated_at)}</Td>
            <Td>{['dead', 'failed'].includes(j.status) && <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate(j.id)} icon={<RefreshCw className="h-3.5 w-3.5" />}>Retry</Button>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['admin-audit', action], queryFn: () => api.get(`/admin/audit-logs${qs({ action, limit: 150 })}`) });
  return (
    <div className="space-y-4">
      <Input className="max-w-sm" placeholder="Filter by action prefix, e.g. contribution." value={action} onChange={(e) => setAction(e.target.value)} />
      <ErrorNote error={q.error} />
      <Card className="py-2">
        {q.data?.logs.map((l: any) => (
          <Disclosure key={l.id} title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{l.action}</span><span className="text-xs font-normal text-ink-muted">{l.actor ?? l.actor_kind} · {l.entity_type ?? ''}</span></span>} meta={<span className="text-xs text-ink-faint">{dateTime(l.created_at)}</span>}>
            <JsonView value={{ entity: `${l.entity_type}:${l.entity_id}`, ip: l.ip, details: l.details }} />
          </Disclosure>
        ))}
        {q.data?.logs.length === 0 && <p className="py-4 text-sm text-ink-muted">No matching entries.</p>}
      </Card>
    </div>
  );
}

export default function AdminSystem() {
  const [tab, setTab] = useState<'health' | 'jobs' | 'audit'>('health');
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Operations" title="System settings" description="Health, durable background jobs with dead-letter recovery, and the immutable audit trail." />
      <Tabs tabs={[{ value: 'health', label: 'Health' }, { value: 'jobs', label: 'Background jobs' }, { value: 'audit', label: 'Audit log' }]} value={tab} onChange={setTab} />
      {tab === 'health' ? <Health /> : tab === 'jobs' ? <Jobs /> : <Audit />}
    </div>
  );
}
