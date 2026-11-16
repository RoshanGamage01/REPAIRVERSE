import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck, CheckCircle2, CircleHelp, Flag, PencilLine, Search, XCircle } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, money } from '../../lib/format';
import { Badge, Button, cx, DemoBadge, Dialog, Disclosure, ErrorNote, Field, Input, Spinner, Textarea, useToast, VerificationBadge } from '../../ui';

export const classificationLabel: Record<string, string> = {
  oem: 'OEM / original',
  genuine_refurbished: 'Genuine refurbished',
  aftermarket: 'Aftermarket',
  salvaged: 'Salvaged',
  unknown: 'Unknown origin',
};

export const compatTone: Record<string, any> = { confirmed: 'ok', potential: 'warn', incompatible: 'danger', unknown: 'neutral' };
export const compatLabel: Record<string, string> = { confirmed: 'Confirmed compatible', potential: 'Potentially compatible (unverified)', incompatible: 'Incompatible', unknown: 'Cannot assess' };

/** Redirect anonymous users to login before an action. */
export function useRequireLogin() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  return (fn: () => void) => {
    if (!user) nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    else fn();
  };
}

export function SaveButton({ entityType, entityId, saved }: { entityType: string; entityId: string; saved?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const requireLogin = useRequireLogin();
  const { user } = useAuth();
  const savedList = useQuery({ queryKey: ['saved'], queryFn: () => api.get('/saved'), enabled: saved === undefined && !!user });
  const isSaved = saved ?? !!savedList.data?.saved?.some((s: any) => s.entity_id === entityId);
  const [local, setLocal] = useState<boolean | null>(null);
  const current = local ?? isSaved;
  const m = useMutation({
    mutationFn: (v: boolean) => api.post('/saved', { entityType, entityId, saved: v }),
    onSuccess: (_d, v) => {
      setLocal(v);
      toast(v ? 'Saved to your knowledge' : 'Removed from saved');
      qc.invalidateQueries({ queryKey: ['saved'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Button variant="secondary" size="sm" loading={m.isPending} onClick={() => requireLogin(() => m.mutate(!current))} icon={current ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}>
      {current ? 'Saved' : 'Save'}
    </Button>
  );
}

/** "Report inaccurate information" + "Suggest a correction" for any knowledge entity. */
export function FeedbackActions({ entityType, entityId, title }: { entityType: string; entityId: string; title: string }) {
  const [mode, setMode] = useState<'report' | 'correct' | null>(null);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState('');
  const toast = useToast();
  const requireLogin = useRequireLogin();
  const m = useMutation({
    mutationFn: () =>
      mode === 'report'
        ? api.post('/contributions/reports', { entityType, entityId, reason: text })
        : api.post('/contributions', {
            type: 'correction',
            title: `Correction: ${title}`.slice(0, 200),
            targetEntityType: entityType,
            targetEntityId: entityId,
            payload: { correction: text },
            evidence: evidence ? [{ kind: /^https?:/.test(evidence) ? 'url' : 'text', value: evidence }] : [],
          }),
    onSuccess: () => {
      toast(mode === 'report' ? 'Thanks — moderators will review this report' : 'Correction submitted for review');
      setMode(null);
      setText('');
      setEvidence('');
    },
  });
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" icon={<Flag className="h-3.5 w-3.5" />} onClick={() => requireLogin(() => setMode('report'))}>
          Report inaccurate information
        </Button>
        <Button variant="ghost" size="sm" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => requireLogin(() => setMode('correct'))}>
          Suggest a correction
        </Button>
      </div>
      <Dialog
        open={!!mode}
        onClose={() => setMode(null)}
        title={mode === 'report' ? 'Report inaccurate information' : 'Suggest a correction'}
        footer={
          <Button loading={m.isPending} disabled={text.trim().length < 5} onClick={() => m.mutate()}>
            Submit
          </Button>
        }
      >
        <p className="text-sm text-ink-muted">{mode === 'report' ? 'Tell us what looks wrong or unsafe.' : 'Corrections are reviewed by moderators before they change public knowledge.'}</p>
        <Field label={mode === 'report' ? 'What is inaccurate?' : 'Your correction'}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {mode === 'correct' && (
          <Field label="Evidence" optional hint="A link to documentation, or a short description of how you know.">
            <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
        )}
        <ErrorNote error={m.error ? new Error(errorMessage(m.error)) : null} />
      </Dialog>
    </>
  );
}

export function ProductPicker({ value, onChange }: { value: any | null; onChange: (p: any | null) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useQuery({ queryKey: ['product-search', q], queryFn: () => api.get(`/products${qs({ q, limit: 8 })}`), enabled: open });
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-paper-sunken px-3.5 py-2.5 text-sm">
        <span className="font-medium">
          {value.brand_name ?? ''} {value.name} <span className="font-mono text-ink-muted">{value.model_number}</span>
        </span>
        <button className="text-ink-muted hover:text-ink" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
      <Input className="pl-10" placeholder="Search products by name or model" value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl bg-paper-raised shadow-lift ring-1 ring-line">
          {isFetching && <div className="p-3"><Spinner /></div>}
          {data?.products?.map((p: any) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-ink/[.03]"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              <span>
                {p.brand_name} {p.name} <span className="font-mono text-xs text-ink-muted">{p.model_number}</span>
              </span>
              {p.is_demo && <DemoBadge />}
            </button>
          ))}
          {data && !data.products.length && <p className="p-3 text-sm text-ink-muted">No products found.</p>}
        </div>
      )}
    </div>
  );
}

const checkIcon = { match: <CheckCircle2 className="h-3.5 w-3.5 text-ok" />, mismatch: <XCircle className="h-3.5 w-3.5 text-danger" />, unknown: <CircleHelp className="h-3.5 w-3.5 text-ink-faint" /> } as Record<string, any>;

export function OffersList({ offers }: { offers: any[] }) {
  if (!offers?.length) return <p className="text-xs text-ink-muted">No sourced offers — prices are never estimated.</p>;
  return (
    <ul className="space-y-1.5">
      {offers.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="min-w-0">
            {o.url ? (
              <a className="link" href={o.url} target="_blank" rel="noreferrer">
                {o.seller}
              </a>
            ) : (
              o.seller
            )}{' '}
            <span className="text-xs text-ink-muted">
              · {o.provider === 'manual' ? 'verified manual entry' : o.provider} · observed {date(o.observed_at)} · {o.availability.replace(/_/g, ' ')}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {o.is_demo && <DemoBadge label="Demo offer" />}
            <span className="font-semibold tabular-nums">{o.price_cents != null ? money(o.price_cents, o.currency) : 'Price not listed'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A compatibility verdict for one part, with expandable evidence. */
export function PartCompatCard({ r }: { r: any }) {
  return (
    <div className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/parts/${r.part.id}`} className="font-semibold hover:underline">
            {r.part.name}
          </Link>
          <div className="font-mono text-xs text-ink-muted">{r.part.partNumber ?? 'No part number'}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={compatTone[r.state]}>{compatLabel[r.state]}</Badge>
          <Badge>{classificationLabel[r.part.classification] ?? r.part.classification}</Badge>
          {r.isDemo && <DemoBadge />}
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-ink-soft">
        {r.reasons.map((x: string) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <div className="mt-2">
        <Disclosure title="Evidence behind this verdict" meta={<span className="text-xs text-ink-muted">{r.basis === 'explicit' ? 'Explicit record' : r.basis === 'attribute_rules' ? 'Attribute comparison' : 'Insufficient data'}</span>}>
          <div className="space-y-3 text-sm">
            {r.attributeChecks?.length > 0 && (
              <div className="divide-y divide-line rounded-xl ring-1 ring-line">
                {r.attributeChecks.map((c: any) => (
                  <div key={c.attribute} className="grid grid-cols-[auto_1fr] items-center gap-x-3 px-3 py-2 sm:grid-cols-[auto_1fr_1fr_1fr]">
                    {checkIcon[c.result]}
                    <span className="font-medium">{c.attribute.replace(/_/g, ' ')}</span>
                    <span className="col-span-2 text-xs text-ink-muted sm:col-span-1">Needs: {c.required ?? 'unknown'}</span>
                    <span className="col-span-2 text-xs text-ink-muted sm:col-span-1">Part: {c.offered ?? 'unknown'}</span>
                  </div>
                ))}
              </div>
            )}
            {r.evidence?.length > 0 ? (
              <ul className="space-y-1.5">
                {r.evidence.map((e: any, i: number) => (
                  <li key={i}>
                    <Badge>{e.kind.replace(/_/g, ' ')}</Badge> {e.description}
                    {e.sourceTitle && <span className="text-xs text-ink-muted"> — {e.sourceUrl ? <a className="link" href={e.sourceUrl}>{e.sourceTitle}</a> : e.sourceTitle}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">No recorded evidence.</p>
            )}
          </div>
        </Disclosure>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <OffersList offers={r.offers} />
      </div>
    </div>
  );
}

export function SourcesList({ sources }: { sources: any[] }) {
  if (!sources?.length) return <p className="text-sm text-ink-muted">No cited sources.</p>;
  return (
    <ul className="space-y-2">
      {sources.map((s: any) => (
        <li key={`${s.id}-${s.locator ?? ''}`} className="flex flex-wrap items-center gap-2 text-sm">
          {s.url ? (
            <a className="link" href={s.url} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          ) : (
            <span className="font-medium">{s.title}</span>
          )}
          <Badge>{String(s.kind).replace(/_/g, ' ')}</Badge>
          {s.kind === 'demo' && <DemoBadge />}
          {s.verification_status && s.kind !== 'demo' && <VerificationBadge status={s.verification_status} />}
          {s.locator && <span className="text-xs text-ink-muted">{s.locator}</span>}
        </li>
      ))}
    </ul>
  );
}

export const chip = (active: boolean) => cx('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition', active ? 'bg-ink text-paper ring-ink' : 'bg-paper-raised ring-line hover:ring-ink/30');
