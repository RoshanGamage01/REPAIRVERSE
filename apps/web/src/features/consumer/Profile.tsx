import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Code2, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { isPro, isStaff, useAuth } from '../../lib/auth';
import { relative } from '../../lib/format';
import { Badge, Button, Card, KeyValue, PageHeader, Section, Stat } from '../../ui';

const statusTone: Record<string, any> = { approved: 'ok', rejected: 'danger', pending: 'warn', needs_evidence: 'accent' };

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const contributions = useQuery({ queryKey: ['my-contributions'], queryFn: () => api.get('/contributions/mine') });
  if (!user) return null;
  const list = contributions.data?.contributions ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader eyebrow="Profile" title={user.displayName} description={user.email} />
      <Card>
        <KeyValue
          items={[
            { label: 'Account type', value: <span className="capitalize">{user.role}</span> },
            ...(user.role === 'technician'
              ? [{ label: 'Credentials', value: user.technicianVerified ? <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>Verified</Badge> : <Badge>Not verified</Badge> }]
              : []),
            ...(user.memberships.length ? [{ label: 'Workspaces', value: user.memberships.map((m) => m.name).join(', ') }] : []),
          ]}
        />
      </Card>
      <div className="flex flex-wrap gap-2">
        {isPro(user) && (
          <Link to="/pro">
            <Button variant="secondary" icon={<Briefcase className="h-4 w-4" />}>Repair workspace</Button>
          </Link>
        )}
        {isStaff(user) && (
          <Link to="/admin">
            <Button variant="secondary" icon={<ShieldCheck className="h-4 w-4" />}>Administration</Button>
          </Link>
        )}
        <Link to="/developers">
          <Button variant="secondary" icon={<Code2 className="h-4 w-4" />}>Developer API</Button>
        </Link>
        <Button
          variant="ghost"
          icon={<LogOut className="h-4 w-4" />}
          onClick={async () => {
            await logout();
            nav('/');
          }}
        >
          Sign out
        </Button>
      </div>
      <Section title="Your contributions" description="Reputation is earned through accurate, evidenced and corroborated knowledge — not volume.">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Reputation" value={Number(contributions.data?.reputation ?? 0).toFixed(1)} tone="accent" />
          <Stat label="Approved" value={list.filter((c: any) => c.status === 'approved').length} />
          <Stat label="Pending" value={list.filter((c: any) => c.status === 'pending' || c.status === 'needs_evidence').length} />
        </div>
        <div className="space-y-2">
          {list.map((c: any) => (
            <div key={c.id} className="surface flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.title}</div>
                <div className="text-xs text-ink-muted">
                  {c.type.replace(/_/g, ' ')} · {relative(c.created_at)}
                  {c.review_notes ? ` · “${c.review_notes}”` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {Number(c.reputation_delta) !== 0 && <span className="text-xs tabular-nums text-ink-muted">{Number(c.reputation_delta) > 0 ? '+' : ''}{Number(c.reputation_delta).toFixed(1)}</span>}
                <Badge tone={statusTone[c.status]}>{c.status.replace('_', ' ')}</Badge>
              </div>
            </div>
          ))}
          {!list.length && <p className="text-sm text-ink-muted">No contributions yet. Suggest corrections from any product page.</p>}
        </div>
      </Section>
    </div>
  );
}
