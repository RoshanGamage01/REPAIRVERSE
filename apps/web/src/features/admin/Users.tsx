import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { USER_ROLES } from '@repairverse/shared';
import { api, qs } from '../../lib/api';
import { relative } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { Badge, Button, ErrorNote, Input, PageHeader, Select, Table, Tabs, Td, VerificationBadge } from '../../ui';
import { useAction } from './common';

export default function AdminUsers() {
  const [tab, setTab] = useState<'users' | 'orgs'>('users');
  const [q, setQ] = useState('');
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['admin-users', q], queryFn: () => api.get(`/admin/users${qs({ q, limit: 100 })}`) });
  const orgs = useQuery({ queryKey: ['admin-orgs'], queryFn: () => api.get('/admin/organizations'), enabled: tab === 'orgs' });
  const patch = useAction((v: { id: string; role?: string; status?: string }) => api.patch(`/admin/users/${v.id}`, v), { success: 'User updated', invalidate: [['admin-users']] });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="Users" description="Roles control access. Changing a role or suspending an account is audited; suspension ends all sessions." />
      <Tabs tabs={[{ value: 'users', label: 'Users', count: users.data?.total }, { value: 'orgs', label: 'Organizations' }]} value={tab} onChange={setTab} />
      {tab === 'users' ? (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-ink-faint" />
            <Input className="pl-9" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ErrorNote error={users.error} />
          <Table head={['User', 'Role', 'Technician', 'Reputation', 'Last login', '']}>
            {users.data?.users.map((u: any) => (
              <tr key={u.id}>
                <Td>
                  <div className="font-medium">{u.display_name}</div>
                  <div className="text-xs text-ink-muted">{u.email}</div>
                </Td>
                <Td>
                  <Select className="h-9 w-36" value={u.role} disabled={u.id === me?.id} onChange={(e) => patch.mutate({ id: u.id, role: e.target.value })}>
                    {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
                  </Select>
                </Td>
                <Td>{u.verification_status ? <VerificationBadge status={u.verification_status === 'pending' ? 'pending' : u.verification_status} /> : '—'}</Td>
                <Td className="tabular-nums">{Number(u.reputation).toFixed(1)}</Td>
                <Td className="text-ink-muted">{relative(u.last_login_at)}</Td>
                <Td>
                  {u.id !== me?.id &&
                    (u.status === 'active' ? (
                      <Button size="sm" variant="ghost" onClick={() => confirm(`Suspend ${u.email}?`) && patch.mutate({ id: u.id, status: 'suspended' })}>Suspend</Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => patch.mutate({ id: u.id, status: 'active' })}>
                        <Badge tone="danger">Suspended</Badge> Reactivate
                      </Button>
                    ))}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <Table head={['Organization', 'Kind', 'Members', 'Jobs', 'Created']}>
          {orgs.data?.organizations.map((o: any) => (
            <tr key={o.id}>
              <Td className="font-medium">{o.name}</Td>
              <Td><Badge>{o.kind.replace('_', ' ')}</Badge></Td>
              <Td className="tabular-nums">{o.members}</Td>
              <Td className="tabular-nums">{o.jobs}</Td>
              <Td className="text-ink-muted">{relative(o.created_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
