import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, KeyRound } from 'lucide-react';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { Badge, Button, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Table, Td } from '../../ui';
import { Meter, STATUS_TONE, useAction } from './common';

export default function AdminApi() {
  const q = useQuery({ queryKey: ['admin-api-clients'], queryFn: () => api.get('/admin/api-clients') });
  const [editing, setEditing] = useState<any>(null);
  const [rate, setRate] = useState('');
  const [quota, setQuota] = useState('');
  const save = useAction(() => api.patch(`/admin/api-clients/${editing.id}`, { rateLimitPerMinute: Number(rate), monthlyQuota: Number(quota) }), { success: 'Limits updated', invalidate: [['admin-api-clients']], onSuccess: () => setEditing(null) });
  const revoke = useAction((id: string) => api.post(`/admin/api-clients/${id}/revoke`), { success: 'Key revoked', invalidate: [['admin-api-clients']] });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Developer platform"
        title="API management"
        description="Keys are stored as hashes, scoped, rate limited per minute and metered monthly. Only public knowledge is exposed; high-risk steps are always withheld."
        actions={<a href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer"><Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>OpenAPI spec</Button></a>}
      />
      <ErrorNote error={q.error} />
      {q.data?.clients.length === 0 ? (
        <EmptyState icon={<KeyRound className="h-8 w-8" />} title="No API clients yet" description="Developers create keys from the Developers page." />
      ) : (
        <Table head={['Client', 'Scopes', 'Usage this month', 'Rate limit', 'Status', '']}>
          {q.data?.clients.map((c: any) => (
            <tr key={c.id}>
              <Td>
                <div className="font-medium">{c.name}</div>
                <div className="font-mono text-xs text-ink-muted">{c.key_prefix}… · {c.owner}</div>
                <div className="text-xs text-ink-faint">Last used {relative(c.last_used_at)}</div>
              </Td>
              <Td><div className="flex max-w-[220px] flex-wrap gap-1">{c.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div></Td>
              <Td className="min-w-[160px]"><Meter value={c.month_requests} max={c.monthly_quota} alertAbove={0.9} label={<><span>{c.month_requests}</span><span>/ {c.monthly_quota}</span></>} /></Td>
              <Td className="tabular-nums">{c.rate_limit_per_minute}/min</Td>
              <Td><Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge></Td>
              <Td>
                {c.status === 'active' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => (setEditing(c), setRate(String(c.rate_limit_per_minute)), setQuota(String(c.monthly_quota)))}>Limits</Button>
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Revoke ${c.name}? Integrations using it will stop working.`) && revoke.mutate(c.id)}>Revoke</Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Limits · ${editing?.name ?? ''}`} footer={<Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}>
        <Field label="Requests per minute"><Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Monthly quota"><Input inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
