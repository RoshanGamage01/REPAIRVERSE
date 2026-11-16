import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, CircuitBoard, Coffee, Headphones, Laptop, Plug, ShieldCheck, Smartphone, Tablet, Tv, Factory, WashingMachine, Network, Wrench } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { relative } from '../../lib/format';
import { CaptureEntry } from './Identify';
import { Badge, Card } from '../../ui';

const catIcon: Record<string, any> = {
  smartphones: Smartphone,
  'laptops-computers': Laptop,
  tablets: Tablet,
  'tvs-monitors': Tv,
  'home-appliances': WashingMachine,
  'kitchen-appliances': Coffee,
  audio: Headphones,
  accessories: Plug,
  'small-industrial-equipment': Factory,
};

export default function HomePage() {
  const { user } = useAuth();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const stats = useQuery({ queryKey: ['graph-stats'], queryFn: () => api.get('/knowledge/graph/stats') });
  const recent = useQuery({ queryKey: ['diagnoses'], queryFn: () => api.get('/diagnoses?limit=3'), enabled: !!user });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get('/library/devices'), enabled: !!user });

  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1fr_1.05fr] lg:pt-8">
        <div className="animate-fade-up space-y-4 sm:space-y-5">
          <Badge tone="accent">Repair intelligence for everything you own</Badge>
          <h1 className="display text-[3rem] leading-[0.98] sm:text-7xl">
            What's broken?
            <br />
            <span className="italic text-ink-muted">Let's figure it out.</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-ink-muted sm:text-[17px]">
            Identify the object, understand what might have failed and why, and repair it safely — guided by a growing network of verified repair knowledge.
          </p>
          <div className="hidden flex-wrap gap-x-6 gap-y-2 pt-1 text-sm text-ink-muted sm:flex">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-ok" /> Hypotheses, never guesses
            </span>
            <span className="flex items-center gap-1.5">
              <Network className="h-4 w-4 text-signal" /> Every claim has a source
            </span>
            <span className="flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-accent" /> Knows when to call a pro
            </span>
          </div>
        </div>
        <div className="animate-fade-up [animation-delay:80ms]">
          <CaptureEntry />
        </div>
      </section>

      {user && (recent.data?.diagnoses?.length > 0 || devices.data?.devices?.length > 0) && (
        <section className="grid gap-4 md:grid-cols-2">
          {recent.data?.diagnoses?.length > 0 && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Continue a diagnosis</h2>
                <Link to="/history" className="text-sm text-ink-muted hover:text-ink">
                  All
                </Link>
              </div>
              {recent.data.diagnoses.map((d: any) => (
                <Link key={d.id} to={`/diagnose/${d.id}`} className="flex items-center justify-between gap-3 rounded-xl p-2 -mx-2 hover:bg-ink/[.03]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.product_name ?? d.category_name}</div>
                    <div className="truncate text-xs text-ink-muted">{d.result?.hypotheses?.[0] ? `Leading hypothesis: ${d.result.hypotheses[0].name}` : d.description}</div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-faint">{relative(d.created_at)}</span>
                </Link>
              ))}
            </Card>
          )}
          {devices.data?.devices?.length > 0 && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Your devices</h2>
                <Link to="/devices" className="text-sm text-ink-muted hover:text-ink">
                  All
                </Link>
              </div>
              {devices.data.devices.slice(0, 3).map((d: any) => (
                <Link key={d.id} to={`/devices/${d.id}`} className="-mx-2 flex items-center gap-3 rounded-xl p-2 hover:bg-ink/[.03]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-sunken">
                    <Boxes className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.nickname}</div>
                    <div className="truncate text-xs text-ink-muted">{d.product_name ?? 'Unidentified'} · {d.repair_count} repairs</div>
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </section>
      )}

      <section className="space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="eyebrow">Browse by category</div>
            <h2 className="display mt-1 text-3xl">Start from what it is</h2>
          </div>
          <Link to="/discover" className="hidden items-center gap-1 text-sm font-medium sm:flex">
            Discover products <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cats.data?.categories
            ?.filter((c: any) => !c.parent_id)
            .map((c: any) => {
              const Icon = catIcon[c.slug] ?? CircuitBoard;
              return (
                <Link key={c.id} to={`/diagnose/new?categoryId=${c.id}`} className="surface group flex flex-col justify-between gap-6 p-4 transition hover:-translate-y-0.5 hover:shadow-soft">
                  <Icon className="h-6 w-6 text-ink-soft transition group-hover:text-accent" />
                  <div className="text-sm font-medium leading-tight">{c.name}</div>
                </Link>
              );
            })}
        </div>
      </section>

      {stats.data && (
        <section className="overflow-hidden rounded-3xl bg-ink p-8 text-paper sm:p-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-3">
              <div className="eyebrow text-paper/50">The knowledge network</div>
              <h2 className="display text-4xl leading-tight">Every repair makes the next one smarter.</h2>
              <p className="text-paper/60">Verified outcomes from technicians and repairers refine what REPAIRVERSE knows about how products fail — and how to fix them.</p>
              <Link to="/discover" className="inline-flex items-center gap-1 pt-2 text-sm font-medium text-accent">
                Explore the network <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-paper/10 sm:grid-cols-3">
              {[
                ['Products', stats.data.products],
                ['Components', stats.data.components],
                ['Failure modes', stats.data.failure_modes],
                ['Repair procedures', stats.data.procedures],
                ['Compatibility links', stats.data.compatibility_relations],
                ['Verified outcomes', stats.data.verified_outcomes],
              ].map(([l, v]) => (
                <div key={l as string} className="bg-ink p-5">
                  <div className="text-3xl font-semibold tabular-nums">{v as number}</div>
                  <div className="text-xs text-paper/50">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
