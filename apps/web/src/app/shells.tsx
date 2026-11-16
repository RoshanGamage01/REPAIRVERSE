import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  BookMarked,
  Boxes,
  Briefcase,
  Building2,
  Compass,
  Cpu,
  FileCheck2,
  Gauge,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Network,
  Package,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cx } from '../ui';
import { isPro, isStaff, useAuth } from '../lib/auth';
import { api } from '../lib/api';

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: () => api.get<{ demoData: boolean; ai: Record<string, { configured: boolean; enabled: boolean; model: string }> }>('/status'), staleTime: 300_000 });
}

export function Logo({ to = '/', suffix }: { to?: string; suffix?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2" aria-label="REPAIRVERSE home">
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-ink" />
        <circle cx="16" cy="16" r="7.5" fill="none" className="stroke-accent" strokeWidth="3" />
        <circle cx="16" cy="16" r="2.5" className="fill-paper" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[0.08em]">REPAIRVERSE</span>
      {suffix && <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">{suffix}</span>}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user)
    return (
      <div className="flex items-center gap-2">
        <Link to="/login" className="rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5">
          Sign in
        </Link>
        <Link to="/register" className="rounded-full bg-ink px-3.5 py-1.5 text-sm font-medium text-paper">
          Get started
        </Link>
      </div>
    );
  return (
    <div className="flex items-center gap-1">
      {isPro(user) && (
        <Link to="/pro" className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 md:inline">
          Workspace
        </Link>
      )}
      {isStaff(user) && (
        <Link to="/admin" className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-ink/5 md:inline">
          Admin
        </Link>
      )}
      <Link to="/profile" className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper" title={user.displayName}>
        {user.displayName.slice(0, 1).toUpperCase()}
      </Link>
      <button
        className="hidden rounded-full p-2 text-ink-muted hover:bg-ink/5 sm:block"
        title="Sign out"
        onClick={async () => {
          await logout();
          nav('/');
        }}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Banner reminding everyone that demonstration data is not real knowledge. */
export function DemoBanner() {
  const { data } = useStatus();
  if (!data?.demoData) return null;
  return (
    <div className="bg-warn-soft text-[rgb(120,72,0)]">
      <div className="container-page py-1.5 text-center text-xs">
        This environment includes <strong>demonstration data</strong> (fictional “Demo Devices” products). Demo knowledge is labelled and is not verified repair guidance.
      </div>
    </div>
  );
}

const consumerNav = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/devices', label: 'My Devices', icon: Boxes },
  { to: '/history', label: 'History', icon: History },
  { to: '/saved', label: 'Saved', icon: BookMarked },
  { to: '/profile', label: 'Profile', icon: User },
];

export function ConsumerShell() {
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <DemoBanner />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className="container-page flex h-14 items-center justify-between gap-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {consumerNav.slice(0, 5).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('rounded-full px-3 py-1.5 text-sm font-medium transition', isActive ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-ink/5')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <UserMenu />
        </div>
      </header>
      <main className="container-page py-6 sm:py-10">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Primary">
        <div className="grid grid-cols-5">
          {consumerNav
            .filter((n) => n.to !== '/saved')
            .map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-ink' : 'text-ink-faint')}>
                <n.icon className="h-5 w-5" />
                {n.label}
              </NavLink>
            ))}
        </div>
      </nav>
    </div>
  );
}

function SideShell({ nav, title, homeTo, children }: { nav: { to: string; label: string; icon: any; end?: boolean }[]; title: string; homeTo: string; children?: ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-paper-raised/60 px-3 py-4 md:flex">
        <div className="px-2 pb-6">
          <Logo to={homeTo} suffix={title} />
        </div>
        <nav className="flex-1 space-y-0.5">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-ink/5')}>
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted hover:bg-ink/5">
          <Home className="h-4 w-4" /> Consumer app
        </Link>
      </aside>
      <div className="min-w-0 flex-1">
        <DemoBanner />
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <Logo to={homeTo} suffix={title} />
            <UserMenu />
          </div>
          <div className="scroll-x px-4 pb-2">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('shrink-0 rounded-full px-3 py-1 text-xs font-medium', isActive ? 'bg-ink text-paper' : 'bg-ink/5 text-ink-soft')}>
                {n.label}
              </NavLink>
            ))}
          </div>
        </header>
        <div className="hidden justify-end px-8 pt-4 md:flex">
          <UserMenu />
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
          {children}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function ProShell() {
  return (
    <SideShell
      title="Pro"
      homeTo="/pro"
      nav={[
        { to: '/pro', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/pro/jobs', label: 'Repair Jobs', icon: Briefcase },
        { to: '/pro/diagnostics', label: 'Diagnostics', icon: Stethoscope },
        { to: '/pro/products', label: 'Products', icon: Cpu },
        { to: '/pro/parts', label: 'Parts', icon: Package },
        { to: '/pro/contributions', label: 'Knowledge Contributions', icon: Sparkles },
        { to: '/pro/settings', label: 'Business Settings', icon: Building2 },
      ]}
    />
  );
}

export function AdminShell() {
  return (
    <SideShell
      title="Admin"
      homeTo="/admin"
      nav={[
        { to: '/admin', label: 'Overview', icon: Gauge, end: true },
        { to: '/admin/knowledge', label: 'Knowledge Network', icon: Network },
        { to: '/admin/products', label: 'Products', icon: Cpu },
        { to: '/admin/components', label: 'Components', icon: Boxes },
        { to: '/admin/repairs', label: 'Repairs', icon: Wrench },
        { to: '/admin/contributions', label: 'Contributions', icon: FileCheck2 },
        { to: '/admin/verification', label: 'Verification', icon: ShieldCheck },
        { to: '/admin/users', label: 'Users', icon: Users },
        { to: '/admin/ai', label: 'AI Configuration', icon: Sparkles },
        { to: '/admin/api', label: 'API Management', icon: KeyRound },
        { to: '/admin/system', label: 'System Settings', icon: Settings },
      ]}
    />
  );
}

export const icons = { ScanSearch, Activity };
