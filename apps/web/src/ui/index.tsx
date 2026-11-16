/**
 * REPAIRVERSE design system.
 * Principles: calm surfaces, one strong accent for the repair action, progressive disclosure,
 * and explicit trust signals (provenance, verification, confidence, risk) wherever knowledge appears.
 */
import { clsx } from 'clsx';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FlaskConical,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { PROVENANCE_LABELS, type Provenance, type RiskLevel } from '@repairverse/shared';

export const cx = clsx;

// ───────────────────────── Buttons ─────────────────────────
type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft shadow-soft',
  accent: 'bg-accent text-white hover:brightness-105 shadow-soft',
  secondary: 'bg-paper-raised text-ink ring-1 ring-line hover:ring-ink/25',
  ghost: 'text-ink-soft hover:bg-ink/5 hover:text-ink',
  subtle: 'bg-ink/5 text-ink hover:bg-ink/10',
  danger: 'bg-danger text-white hover:brightness-110',
};
const buttonSizes = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        buttonStyles[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ───────────────────────── Forms ─────────────────────────
export function Field({ label, hint, error, children, htmlFor, optional }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-sm font-medium text-ink">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-ink-faint">Optional</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const inputBase = 'w-full rounded-xl bg-paper-raised px-3.5 text-sm text-ink ring-1 ring-line placeholder:text-ink-faint transition focus:outline-none focus:ring-2 focus:ring-ink/70 disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(inputBase, 'h-11', className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(inputBase, 'min-h-[96px] py-3 leading-relaxed', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(inputBase, 'h-11 appearance-none pr-9', className)} {...p}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
    </div>
  );
});

export function Checkbox({ label, checked, onChange, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line accent-ink" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Segmented choice — used for diagnostic answers and filters. */
export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: { options: { value: T; label: ReactNode }[]; value: T | null; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-full font-medium ring-1 transition',
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm',
            value === o.value ? 'bg-ink text-paper ring-ink' : 'bg-paper-raised text-ink ring-line hover:ring-ink/30',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Layout ─────────────────────────
export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: any; [k: string]: any }) {
  return (
    <As className={cx('surface p-5 sm:p-6', className)} {...rest}>
      {children}
    </As>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-6 pt-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="display text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('space-y-4', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx('border-line', className)} />;
}

export function KeyValue({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-6 py-2.5 text-sm">
          <dt className="text-ink-muted">{it.label}</dt>
          <dd className="text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'accent' | 'ok' | 'warn' }) {
  return (
    <div className="surface p-4">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', tone === 'accent' && 'text-accent', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

// ───────────────────────── Feedback ─────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-ink-muted', className)} />;
}
export function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-ink/5', className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <div className="font-medium">{title}</div>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'danger' | 'ok' | 'ai'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const styles = {
    info: 'bg-paper-sunken text-ink-soft',
    warn: 'bg-warn-soft text-[rgb(120,72,0)]',
    danger: 'bg-danger-soft text-danger',
    ok: 'bg-ok-soft text-ok',
    ai: 'bg-signal-soft text-signal',
  }[tone];
  return (
    <div className={cx('flex gap-3 rounded-xl px-4 py-3 text-sm', styles)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 space-y-0.5">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Trust signals ─────────────────────────
export function Badge({ children, tone = 'neutral', className, icon }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'signal' | 'dark'; className?: string; icon?: ReactNode }) {
  const t = {
    neutral: 'bg-ink/5 text-ink-soft',
    accent: 'bg-accent-soft text-accent-ink',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-[rgb(140,84,0)]',
    danger: 'bg-danger-soft text-danger',
    signal: 'bg-signal-soft text-signal',
    dark: 'bg-ink text-paper',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', t, className)}>{icon}{children}</span>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  if (level === 'high') return <Badge tone="danger" icon={<ShieldAlert className="h-3 w-3" />}>High risk · professionals only</Badge>;
  if (level === 'medium') return <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>Medium risk</Badge>;
  return <Badge tone="ok" icon={<ShieldCheck className="h-3 w-3" />}>Low risk</Badge>;
}

const provenanceIcon: Record<string, ReactNode> = {
  manufacturer_documentation: <BookOpen className="h-3 w-3" />,
  expert_reviewed: <BadgeCheck className="h-3 w-3" />,
  verified_repair_record: <Wrench className="h-3 w-3" />,
  community_contribution: <Users className="h-3 w-3" />,
  ai_generated: <Bot className="h-3 w-3" />,
  ai_generated_grounded: <Bot className="h-3 w-3" />,
  demo: <FlaskConical className="h-3 w-3" />,
};
export function ProvenanceBadge({ provenance }: { provenance: Provenance | 'ai_generated_grounded' | string }) {
  const label = provenance === 'ai_generated_grounded' ? 'AI-generated · grounded in sources' : PROVENANCE_LABELS[provenance as Provenance] ?? provenance;
  const tone = provenance.startsWith('ai') ? 'signal' : provenance === 'demo' ? 'warn' : provenance === 'community_contribution' ? 'neutral' : 'ok';
  return (
    <Badge tone={tone as any} icon={provenanceIcon[provenance]}>
      {label}
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: string }) {
  if (status === 'verified') return <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>Verified</Badge>;
  if (status === 'demo') return <DemoBadge />;
  if (status === 'pending_review' || status === 'pending') return <Badge tone="warn" icon={<CircleDashed className="h-3 w-3" />}>Pending review</Badge>;
  if (status === 'rejected') return <Badge tone="danger">Rejected</Badge>;
  return <Badge icon={<CircleDashed className="h-3 w-3" />}>Unverified</Badge>;
}

export function DemoBadge({ label = 'Demo data' }: { label?: string }) {
  return (
    <Badge tone="warn" icon={<FlaskConical className="h-3 w-3" />} className="ring-1 ring-warn/30">
      {label}
    </Badge>
  );
}

const bandLabel = { very_low: 'Very low', low: 'Low', moderate: 'Moderate', high: 'High' } as const;
export function bandOf(p: number) {
  return p >= 0.75 ? 'high' : p >= 0.45 ? 'moderate' : p >= 0.2 ? 'low' : 'very_low';
}
/** Confidence display. Always phrased as likelihood — never as confirmation. */
export function ConfidenceMeter({ value, label, compact }: { value: number; label?: string; compact?: boolean }) {
  const band = bandOf(value);
  const color = band === 'high' ? 'bg-ink' : band === 'moderate' ? 'bg-ink-soft' : band === 'low' ? 'bg-ink-muted' : 'bg-ink-faint';
  return (
    <div className={cx('w-full', compact ? 'space-y-1' : 'space-y-1.5')} title={`${Math.round(value * 100)}% relative likelihood`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">{label ?? 'Relative likelihood'}</span>
        <span className="font-semibold tabular-nums">
          {Math.round(value * 100)}% <span className="font-normal text-ink-muted">· {bandLabel[band]}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
      </div>
    </div>
  );
}

/** The stop-and-seek-professional mechanism. */
export function SafetyStop({ title, reasons, actions, children }: { title: string; reasons?: string[]; actions?: string[]; children?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-danger text-white shadow-lift">
      <div className="flex items-start gap-3 p-5">
        <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="space-y-3">
          <div className="text-lg font-semibold leading-snug">{title}</div>
          {reasons && (
            <ul className="space-y-1 text-sm text-white/90">
              {reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          )}
          {actions && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">What you can do</div>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-white/95">
                {actions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Disclosure, Tabs, Dialog ─────────────────────────
export function Disclosure({ title, children, defaultOpen = false, meta }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; meta?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line last:border-0">
      <button className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-center gap-2">
          {meta}
          <ChevronDown className={cx('h-4 w-4 text-ink-muted transition', open && 'rotate-180')} />
        </span>
      </button>
      {open && <div className="animate-fade-up pb-4">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scroll-x border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition', value === t.value ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink')}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 rounded-full bg-ink/5 px-1.5 text-[11px] tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('relative z-10 max-h-[92vh] w-full animate-fade-up overflow-y-auto rounded-t-3xl bg-paper-raised shadow-lift sm:rounded-3xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper-raised/95 px-6 py-4 backdrop-blur">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink-muted hover:bg-ink/5" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-paper-raised/95 px-6 py-4 backdrop-blur">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Toasts ─────────────────────────
type Toast = { id: number; message: ReactNode; tone: 'ok' | 'danger' | 'info' };
const ToastCtx = createContext<(message: ReactNode, tone?: Toast['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: ReactNode, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto animate-fade-up rounded-full px-4 py-2.5 text-sm font-medium shadow-lift', t.tone === 'danger' ? 'bg-danger text-white' : t.tone === 'info' ? 'bg-paper-raised text-ink ring-1 ring-line' : 'bg-ink text-paper')}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ───────────────────────── Tables (used sparingly) ─────────────────────────
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-line text-xs text-ink-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-top', className)}>{children}</td>;
