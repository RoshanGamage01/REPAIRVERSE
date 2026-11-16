import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { cx, DemoBadge, Input, Spinner, useToast } from '../../ui';

/** Mutation helper: toasts success/errors (403s from admin-only actions surface as readable messages) and invalidates keys. */
export function useAction<V = any, R = any>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: QueryKey[]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
}

/** Progress meter. `alertAbove` (0–1) turns it red past a threshold — for budgets and quotas only. */
export function Meter({ value, max, label, tone = 'ink', alertAbove }: { value: number; max: number; label?: ReactNode; tone?: 'ink' | 'accent' | 'danger' | 'ok'; alertAbove?: number }) {
  const pctv = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = { ink: 'bg-ink', accent: 'bg-accent', danger: 'bg-danger', ok: 'bg-ok' }[alertAbove != null && pctv > alertAbove * 100 ? 'danger' : tone];
  return (
    <div className="space-y-1.5">
      {label && <div className="flex justify-between text-xs text-ink-muted">{label}</div>}
      <div className="h-2 overflow-hidden rounded-full bg-ink/10">
        <div className={cx('h-full rounded-full', color)} style={{ width: `${Math.max(pctv, 1)}%` }} />
      </div>
    </div>
  );
}

/** Inline CSS bar chart (no chart library). */
export function Bars({ data, format = (n: number) => String(n) }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="text-sm text-ink-muted">No data in this period.</p>;
  return (
    <div className="flex h-32 items-end gap-1" role="img" aria-label="Bar chart">
      {data.map((d) => (
        <div key={d.label} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${format(d.value)}`}>
          <div className="w-full rounded-t bg-ink/80 transition group-hover:bg-accent" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          <span className="hidden text-[9px] text-ink-faint sm:block">{d.label.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function ProductPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({ queryKey: ['admin-product-search', q], queryFn: () => api.get(`/products${qs({ q, all: 'true', limit: 8 })}`), enabled: q.trim().length > 1 });
  if (value)
    return (
      <div className="flex items-center justify-between rounded-xl bg-paper-sunken px-3 py-2 text-sm">
        <span className="font-medium">{value.name}</span>
        <button className="text-ink-muted hover:text-ink" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-ink-faint" />
        <Input className="pl-9" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isFetching && <Spinner className="h-4 w-4" />}
      <div className="max-h-48 divide-y divide-line overflow-y-auto">
        {data?.products?.map((p: any) => (
          <button key={p.id} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-ink/[.03]" onClick={() => onChange({ id: p.id, name: `${p.name} ${p.model_number ?? ''}`.trim() })}>
            <span>
              {p.name} <span className="text-ink-muted">{p.model_number}</span>
            </span>
            {p.is_demo && <DemoBadge />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="max-h-72 overflow-auto rounded-xl bg-paper-sunken p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

/** Render a payload object as readable key/value rows (falls back to JSON for nested values). */
export function PayloadView({ payload, names = {} }: { payload: Record<string, any>; names?: Record<string, string> }) {
  const entries = Object.entries(payload ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length));
  if (!entries.length) return <p className="text-sm text-ink-muted">Empty payload.</p>;
  const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const render = (k: string, v: any): ReactNode => {
    if (k === 'symptomIds' && Array.isArray(v)) return v.map((id) => names[id] ?? id).join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return <JsonView value={v} />;
    return String(v);
  };
  return (
    <dl className="divide-y divide-line text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-2 sm:grid-cols-[160px_1fr]">
          <dt className="text-ink-muted">{label(k)}</dt>
          <dd className="min-w-0 break-words">{render(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export const STATUS_TONE: Record<string, any> = {
  pending: 'warn',
  needs_evidence: 'signal',
  approved: 'ok',
  rejected: 'danger',
  succeeded: 'ok',
  queued: 'neutral',
  running: 'signal',
  failed: 'danger',
  dead: 'danger',
  rejected_by_validation: 'warn',
  not_configured: 'neutral',
  verified: 'ok',
  pending_review: 'warn',
  active: 'ok',
  revoked: 'danger',
  suspended: 'danger',
  retracted: 'danger',
};
