import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { date } from '../../lib/format';
import { Badge, Button, Card, cx, ErrorNote, Field, FullPageSpinner, Input, Notice, PageHeader, Section, Select, Textarea, useToast } from '../../ui';

function VerificationStatus({ status }: { status: string }) {
  if (status === 'verified') return <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>Verified technician</Badge>;
  if (status === 'pending') return <Badge tone="warn">Verification pending</Badge>;
  if (status === 'rejected') return <Badge tone="danger">Verification declined</Badge>;
  return <Badge>Unverified</Badge>;
}

function Organization() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['pro-org'], queryFn: () => api.get('/pro/organization') });
  const [f, setF] = useState({ name: '', phone: '', website: '', address: '' });
  const [member, setMember] = useState({ email: '', role: 'technician' });
  useEffect(() => {
    if (data?.organization) setF({ name: data.organization.name ?? '', phone: data.organization.phone ?? '', website: data.organization.website ?? '', address: data.organization.address ?? '' });
  }, [data]);
  const save = useMutation({ mutationFn: () => api.patch('/pro/organization', f), onSuccess: () => (toast('Business details saved'), qc.invalidateQueries({ queryKey: ['pro-org'] })), onError: (e) => toast(errorMessage(e), 'danger') });
  const add = useMutation({ mutationFn: () => api.post('/pro/organization/members', member), onSuccess: () => (toast('Member added'), setMember({ email: '', role: 'technician' }), qc.invalidateQueries({ queryKey: ['pro-org'] })), onError: (e) => toast(errorMessage(e), 'danger') });
  const canEdit = ['owner', 'manager'].includes(data?.myRole);
  return (
    <Section title="Business" description="Your repair workspace. Jobs and customer devices are private to its members.">
      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name"><Input disabled={!canEdit} value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
          <Field label="Phone" optional><Input disabled={!canEdit} value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} /></Field>
          <Field label="Website" optional><Input disabled={!canEdit} value={f.website} onChange={(e) => setF((x) => ({ ...x, website: e.target.value }))} /></Field>
          <Field label="Address" optional><Input disabled={!canEdit} value={f.address} onChange={(e) => setF((x) => ({ ...x, address: e.target.value }))} /></Field>
        </div>
        {canEdit && <Button loading={save.isPending} onClick={() => save.mutate()}>Save business details</Button>}
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">Team</h3>
        {data?.members?.map((m: any) => (
          <div key={m.id} className="flex items-center justify-between border-b border-line pb-2 text-sm">
            <span>{m.display_name} <span className="text-ink-muted">{m.email}</span></span>
            <Badge>{m.role}</Badge>
          </div>
        ))}
        {canEdit && (
          <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
            <Input placeholder="Colleague's account email" value={member.email} onChange={(e) => setMember((x) => ({ ...x, email: e.target.value }))} />
            <Select value={member.role} onChange={(e) => setMember((x) => ({ ...x, role: e.target.value }))}>
              {['technician', 'manager', 'staff'].map((r) => <option key={r}>{r}</option>)}
            </Select>
            <Button variant="secondary" disabled={!member.email.includes('@')} loading={add.isPending} onClick={() => add.mutate()} icon={<Plus className="h-4 w-4" />}>Add</Button>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Profile({ data }: { data: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const p = data.profile ?? {};
  const [f, setF] = useState({
    headline: p.headline ?? '',
    bio: p.bio ?? '',
    specialties: (p.specialties ?? []) as string[],
    categoryIds: (p.category_ids ?? []) as string[],
    yearsExperience: p.years_experience?.toString() ?? '',
    serviceArea: p.service_area ?? '',
    latitude: p.latitude?.toString() ?? '',
    longitude: p.longitude?.toString() ?? '',
    businessName: p.business_name ?? '',
    businessPhone: p.business_phone ?? '',
    businessWebsite: p.business_website ?? '',
  });
  const [spec, setSpec] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put('/auth/me/technician-profile', {
        ...f,
        yearsExperience: f.yearsExperience ? Number(f.yearsExperience) : null,
        latitude: f.latitude ? Number(f.latitude) : null,
        longitude: f.longitude ? Number(f.longitude) : null,
      }),
    onSuccess: () => (toast('Profile saved'), qc.invalidateQueries({ queryKey: ['tech-profile'] })),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (pos) => setF((x) => ({ ...x, latitude: pos.coords.latitude.toFixed(5), longitude: pos.coords.longitude.toFixed(5) })),
      () => toast('Location unavailable', 'danger'),
    );
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Section title="Technician profile" description="Shown in the public technician directory.">
      <Card className="space-y-4">
        <Field label="Headline"><Input value={f.headline} onChange={set('headline')} placeholder="e.g. Laptop board-level repair" /></Field>
        <Field label="About" optional><Textarea rows={3} value={f.bio} onChange={set('bio')} /></Field>
        <Field label="Specialties">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {f.specialties.map((s) => (
                <Badge key={s}>{s}<button onClick={() => setF((x) => ({ ...x, specialties: x.specialties.filter((y) => y !== s) }))}><X className="h-3 w-3" /></button></Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="Add a specialty" onKeyDown={(e) => { if (e.key === 'Enter' && spec.trim()) { setF((x) => ({ ...x, specialties: [...new Set([...x.specialties, spec.trim()])] })); setSpec(''); } }} />
              <Button variant="secondary" disabled={!spec.trim()} onClick={() => { setF((x) => ({ ...x, specialties: [...new Set([...x.specialties, spec.trim()])] })); setSpec(''); }} icon={<Plus className="h-4 w-4" />} />
            </div>
          </div>
        </Field>
        <Field label="Product categories you repair">
          <div className="flex flex-wrap gap-2">
            {cats.data?.categories?.filter((c: any) => !c.parent_id).map((c: any) => {
              const on = f.categoryIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => setF((x) => ({ ...x, categoryIds: on ? x.categoryIds.filter((y) => y !== c.id) : [...x.categoryIds, c.id] }))} className={cx('rounded-full px-3 py-1.5 text-sm ring-1', on ? 'bg-ink text-paper ring-ink' : 'bg-paper-raised ring-line')}>
                  {c.name}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Years of experience" optional><Input inputMode="numeric" value={f.yearsExperience} onChange={set('yearsExperience')} /></Field>
          <Field label="Service area" optional><Input value={f.serviceArea} onChange={set('serviceArea')} /></Field>
          <Field label="Latitude" optional><Input value={f.latitude} onChange={set('latitude')} /></Field>
          <Field label="Longitude" optional><Input value={f.longitude} onChange={set('longitude')} /></Field>
        </div>
        <Button variant="ghost" size="sm" onClick={locate} icon={<LocateFixed className="h-3.5 w-3.5" />}>Use my location</Button>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Business name" optional><Input value={f.businessName} onChange={set('businessName')} /></Field>
          <Field label="Business phone" optional><Input value={f.businessPhone} onChange={set('businessPhone')} /></Field>
          <Field label="Website" optional><Input value={f.businessWebsite} onChange={set('businessWebsite')} placeholder="https://" /></Field>
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save profile</Button>
      </Card>
    </Section>
  );
}

function Verification({ data }: { data: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [statement, setStatement] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const status = data.profile?.verification_status ?? 'unverified';
  const open = data.verificationRequests?.some((r: any) => ['pending', 'needs_evidence'].includes(r.status));
  const req = useMutation({
    mutationFn: () => api.post('/auth/me/verification-requests', { statement, evidence: urls.map((u) => ({ kind: 'url', value: u })) }),
    onSuccess: () => (toast('Verification requested'), setStatement(''), setUrls([]), qc.invalidateQueries({ queryKey: ['tech-profile'] })),
  });
  return (
    <Section title="Credential verification" description="An administrator reviews your evidence. Until then your profile and contributions show as unverified.">
      <Card className="space-y-4">
        <div className="flex items-center gap-2"><span className="text-sm text-ink-muted">Status</span><VerificationStatus status={status} /></div>
        {data.verificationRequests?.map((r: any) => (
          <div key={r.id} className="border-t border-line pt-3 text-sm">
            <div className="flex items-center gap-2"><Badge>{r.status.replace('_', ' ')}</Badge><span className="text-xs text-ink-muted">{date(r.created_at)}</span></div>
            <p className="mt-1 text-ink-soft">{r.statement}</p>
            {r.review_notes && <p className="text-xs text-ink-muted">Reviewer: {r.review_notes}</p>}
          </div>
        ))}
        {status !== 'verified' && !open && (
          <div className="space-y-3 border-t border-line pt-4">
            <Field label="Your qualifications"><Textarea rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Certifications, training, years of professional repair, business registration…" /></Field>
            <Field label="Evidence links" optional hint="Certificates, business registration, portfolio.">
              <div className="space-y-2">
                {urls.map((u) => <div key={u} className="flex items-center justify-between text-sm"><span className="truncate">{u}</span><button onClick={() => setUrls((x) => x.filter((y) => y !== u))}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></button></div>)}
                <div className="flex gap-2">
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
                  <Button variant="secondary" disabled={!url.trim()} onClick={() => { setUrls((x) => [...x, url.trim()]); setUrl(''); }} icon={<Plus className="h-4 w-4" />} />
                </div>
              </div>
            </Field>
            <ErrorNote error={req.error ? new Error(errorMessage(req.error)) : null} />
            <Button disabled={statement.trim().length < 10} loading={req.isPending} onClick={() => req.mutate()}>Request verification</Button>
          </div>
        )}
        {open && <Notice tone="info">Your request is with an administrator.</Notice>}
      </Card>
    </Section>
  );
}

export default function ProSettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['tech-profile'], queryFn: () => api.get('/auth/me/technician-profile') });
  if (isLoading) return <FullPageSpinner />;
  return (
    <div className="space-y-10">
      <PageHeader title="Business settings" />
      <Organization />
      {data && <Profile key={data.profile?.updated_at ?? 'p'} data={data} />}
      {data && <Verification data={data} />}
    </div>
  );
}
