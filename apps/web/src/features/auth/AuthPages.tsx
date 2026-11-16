import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Wrench, User } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button, cx, ErrorNote, Field, Input } from '../../ui';
import { Logo } from '../../app/shells';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="display text-5xl">{title}</h1>
          <p className="mt-2 text-ink-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(rgb(var(--paper))_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-paper">
          <div className="display text-5xl leading-[1.05]">
            Every repair makes
            <br />
            the next one <em className="text-accent">smarter.</em>
          </div>
          <p className="mt-4 max-w-md text-paper/60">REPAIRVERSE connects products, components, failures and verified repair outcomes into one open intelligence network.</p>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/auth/login', { email, password });
      await refresh();
      const next = params.get('next');
      nav(next && next.startsWith('/') ? next : r.user.role === 'technician' ? '/pro' : r.user.role === 'admin' ? '/admin' : '/');
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to continue your repairs.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm text-ink-muted">
          New here? <Link className="link" to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Create an account</Link>
        </p>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const [form, setForm] = useState({ email: '', password: '', displayName: '', accountType: 'consumer' as 'consumer' | 'technician', businessName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/register', { ...form, businessName: form.businessName || undefined });
      await refresh();
      const next = params.get('next');
      nav(next && next.startsWith('/') ? next : form.accountType === 'technician' ? '/pro' : '/');
    } catch (err) {
      setError(new Error(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame title="Create your account" subtitle="Diagnose problems, track repairs and keep your things working longer.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            { v: 'consumer', label: 'I fix my own things', icon: User },
            { v: 'technician', label: 'I repair professionally', icon: Wrench },
          ].map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => setForm((f) => ({ ...f, accountType: o.v as any }))}
              className={cx('flex flex-col items-start gap-2 rounded-2xl p-3 text-left text-sm font-medium ring-1 transition', form.accountType === o.v ? 'bg-ink text-paper ring-ink' : 'bg-paper-raised ring-line hover:ring-ink/30')}
            >
              <o.icon className="h-4 w-4" />
              {o.label}
            </button>
          ))}
        </div>
        <Field label="Name" htmlFor="name">
          <Input id="name" required value={form.displayName} onChange={set('displayName')} autoComplete="name" />
        </Field>
        {form.accountType === 'technician' && (
          <Field label="Business name" htmlFor="biz" optional hint="Creates your repair workspace. Credentials are verified separately.">
            <Input id="biz" value={form.businessName} onChange={set('businessName')} />
          </Field>
        )}
        <Field label="Email" htmlFor="remail">
          <Input id="remail" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="rpw" hint="At least 10 characters.">
          <Input id="rpw" type="password" required minLength={10} value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-sm text-ink-muted">
          Already have an account? <Link className="link" to="/login">Sign in</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
