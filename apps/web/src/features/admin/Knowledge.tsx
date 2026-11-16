import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileText, Link2, Plus, Search, Trash2, Upload } from 'lucide-react';
import { PROVENANCE_LABELS, PROVENANCE_TYPES, RISK_LEVELS, SOURCE_KINDS } from '@repairverse/shared';
import { api, errorMessage, qs } from '../../lib/api';
import { date, pct, relative } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cx,
  DemoBadge,
  Dialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  KeyValue,
  Notice,
  PageHeader,
  RiskBadge,
  Select,
  Skeleton,
  Stat,
  Tabs,
  Textarea,
  VerificationBadge,
} from '../../ui';
import { JsonView, ProductPicker, STATUS_TONE, useAction } from './common';

type Tab = 'graph' | 'sources' | 'ingestion' | 'review';

function useLookups() {
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const types = useQuery({ queryKey: ['component-types'], queryFn: () => api.get('/component-types') });
  const sources = useQuery({ queryKey: ['admin-sources'], queryFn: () => api.get('/knowledge/sources?limit=100') });
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api.get('/tools') });
  return {
    cats: cats.data?.categories ?? [],
    types: types.data?.componentTypes ?? [],
    sources: (sources.data?.sources ?? []).filter((s: any) => s.status === 'active' && s.kind !== 'demo'),
    allSources: sources.data?.sources ?? [],
    tools: tools.data?.tools ?? [],
  };
}

function MultiToggle({ items, value, onChange }: { items: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
      {items.map((i) => (
        <button
          type="button"
          key={i.id}
          onClick={() => onChange(value.includes(i.id) ? value.filter((x) => x !== i.id) : [...value, i.id])}
          className={cx('rounded-full px-2.5 py-1 text-xs ring-1', value.includes(i.id) ? 'bg-ink text-paper ring-ink' : 'ring-line hover:ring-ink/30')}
        >
          {i.label}
        </button>
      ))}
      {!items.length && <span className="text-xs text-ink-muted">None available.</span>}
    </div>
  );
}

// ───────────────────────── Graph tab ─────────────────────────
function NewFailureMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useLookups();
  const [f, setF] = useState({ name: '', description: '', componentTypeId: '', categoryId: '', riskLevel: 'medium', priorWeight: '1' });
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [symptoms, setSymptoms] = useState<Record<string, number>>({});
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const sym = useQuery({ queryKey: ['symptoms', f.categoryId], queryFn: () => api.get(`/symptoms${qs({ categoryId: f.categoryId })}`), enabled: open });
  const create = useAction(
    () =>
      api.post('/knowledge/failure-modes', {
        ...f,
        categoryId: f.categoryId || null,
        productId: product?.id ?? null,
        priorWeight: Number(f.priorWeight),
        symptoms: Object.entries(symptoms).map(([symptomId, likelihood]) => ({ symptomId, likelihood })),
        sourceIds,
      }),
    { success: 'Failure mode created', invalidate: [['admin-fms'], ['graph-stats']], onSuccess: onClose },
  );
  return (
    <Dialog open={open} onClose={onClose} wide title="New failure mode" footer={<Button loading={create.isPending} disabled={!f.name || !f.componentTypeId || (!f.categoryId && !product)} onClick={() => create.mutate(undefined)}>Create</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Component type (Component HAS_FAILURE)"><Select value={f.componentTypeId} onChange={(e) => setF({ ...f, componentTypeId: e.target.value })}><option value="">Choose…</option>{L.types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Category scope" hint="Generic knowledge for the whole category."><Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{L.cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Or a specific product" optional><ProductPicker value={product} onChange={setProduct} /></Field>
        <Field label="Risk level"><Select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })}>{RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Base prior weight" hint="Relative frequency vs. siblings (1 = typical)."><Input inputMode="decimal" value={f.priorWeight} onChange={(e) => setF({ ...f, priorWeight: e.target.value })} /></Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Symptoms caused (FailureMode CAUSES_SYMPTOM) with P(symptom | failure)">
        <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-paper-sunken p-3">
          {sym.data?.symptoms.map((s: any) => (
            <div key={s.id} className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="accent-ink" checked={s.id in symptoms} onChange={(e) => setSymptoms((cur) => { const n = { ...cur }; if (e.target.checked) n[s.id] = 0.6; else delete n[s.id]; return n; })} />
              <span className="flex-1">{s.name}</span>
              {s.id in symptoms && (
                <>
                  <input type="range" min={0.05} max={0.95} step={0.05} value={symptoms[s.id]} onChange={(e) => setSymptoms({ ...symptoms, [s.id]: Number(e.target.value) })} className="w-28 accent-ink" aria-label={`Likelihood for ${s.name}`} />
                  <span className="w-10 text-right tabular-nums">{pct(symptoms[s.id])}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </Field>
      <Field label="Supporting sources" hint="With at least one source the failure mode is marked verified; without, it stays unverified.">
        <MultiToggle items={L.sources.map((s: any) => ({ id: s.id, label: s.title }))} value={sourceIds} onChange={setSourceIds} />
      </Field>
    </Dialog>
  );
}

function LinkProbe({ fm, onDone }: { fm: any; onDone: () => void }) {
  const [f, setF] = useState({ prompt: '', kind: 'question', riskLevel: 'low', help: '' });
  const [effects, setEffects] = useState<{ answer: string; lr: string }[]>([{ answer: 'yes', lr: '3' }, { answer: 'no', lr: '0.5' }]);
  const save = useAction(
    () => api.post(`/knowledge/failure-modes/${fm.id}/probes`, { ...f, effects: Object.fromEntries(effects.filter((e) => e.answer).map((e) => [e.answer.trim().toLowerCase(), Number(e.lr)])) }),
    { success: 'Diagnostic probe linked', invalidate: [['admin-fm', fm.id]], onSuccess: onDone },
  );
  return (
    <Card className="space-y-3 bg-paper-sunken/50">
      <h4 className="font-semibold">Link a diagnostic question or test (DiagnosticTest INVESTIGATES FailureMode)</h4>
      <Field label="Prompt"><Input value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} placeholder="Does the fan spin when powered on?" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="question">Question</option><option value="test">Physical test</option></Select></Field>
        <Field label="Risk"><Select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })}>{RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
      </div>
      <Field label="Answer → likelihood ratio for this failure" hint=">1 makes this failure more likely; <1 less likely; 1 = no information.">
        <div className="space-y-2">
          {effects.map((e, i) => (
            <div key={i} className="flex gap-2">
              <Input className="h-9" value={e.answer} onChange={(ev) => setEffects(effects.map((x, j) => (j === i ? { ...x, answer: ev.target.value } : x)))} placeholder="answer" />
              <Input className="h-9 w-28" inputMode="decimal" value={e.lr} onChange={(ev) => setEffects(effects.map((x, j) => (j === i ? { ...x, lr: ev.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => setEffects(effects.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setEffects([...effects, { answer: '', lr: '1' }])}>Add answer</Button>
        </div>
      </Field>
      <Button size="sm" loading={save.isPending} disabled={!f.prompt} onClick={() => save.mutate(undefined)}>Link probe</Button>
    </Card>
  );
}

function NewProcedure({ fm, open, onClose }: { fm: any; open: boolean; onClose: () => void }) {
  const L = useLookups();
  const blank = { title: '', body: '', expectedObservation: '', caution: '', provenance: 'expert_reviewed', sourceId: '' };
  const [f, setF] = useState({ title: '', objective: '', difficulty: '2', riskLevel: fm?.risk_level ?? 'medium', provenance: 'expert_reviewed', min: '', max: '', preparation: '', safetyNotes: '', verification: '', reassembly: '' });
  const [steps, setSteps] = useState([{ ...blank }]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [compIds, setCompIds] = useState<string[]>(fm ? [fm.component_type_id] : []);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = useAction(
    () =>
      api.post('/knowledge/procedures', {
        title: f.title,
        objective: f.objective,
        failureModeId: fm.id,
        productId: fm.product_id ?? null,
        difficulty: Number(f.difficulty),
        riskLevel: f.riskLevel,
        provenance: f.provenance,
        estimatedMinutesMin: f.min ? Number(f.min) : null,
        estimatedMinutesMax: f.max ? Number(f.max) : null,
        preparation: lines(f.preparation),
        safetyNotes: lines(f.safetyNotes),
        verification: lines(f.verification),
        reassembly: lines(f.reassembly),
        toolIds,
        componentTypeIds: compIds,
        sourceIds,
        steps: steps.filter((s) => s.title && s.body).map((s) => ({ ...s, expectedObservation: s.expectedObservation || null, caution: s.caution || null, sourceId: s.sourceId || null })),
      }),
    { success: 'Procedure created', invalidate: [['admin-fm', fm?.id], ['graph-stats']], onSuccess: onClose },
  );
  if (!fm) return null;
  const needsSource = f.provenance === 'manufacturer_documentation' && !sourceIds.length;
  return (
    <Dialog open={open} onClose={onClose} wide title={`New procedure · resolves “${fm.name}”`} footer={<Button loading={save.isPending} disabled={!f.title || !f.objective || !steps.some((s) => s.title && s.body) || needsSource} onClick={() => save.mutate(undefined)}>Create procedure</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Provenance"><Select value={f.provenance} onChange={(e) => setF({ ...f, provenance: e.target.value })}>{PROVENANCE_TYPES.filter((p) => p !== 'demo').map((p) => <option key={p} value={p}>{PROVENANCE_LABELS[p]}</option>)}</Select></Field>
        <Field label="Difficulty (1–5)"><Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>{[1, 2, 3, 4, 5].map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Risk level" hint="The safety classifier can raise but never lower this."><Select value={f.riskLevel} onChange={(e) => setF({ ...f, riskLevel: e.target.value })}>{RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Minutes (min)" optional><Input inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></Field>
        <Field label="Minutes (max)" optional><Input inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
      </div>
      <Field label="Objective"><Textarea rows={2} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></Field>
      {needsSource && <Notice tone="warn">Manufacturer-documentation procedures must cite their source document.</Notice>}
      <Field label="Sources"><MultiToggle items={L.sources.map((s: any) => ({ id: s.id, label: s.title }))} value={sourceIds} onChange={setSourceIds} /></Field>
      <Field label="Tools (REQUIRES_TOOL)"><MultiToggle items={L.tools.map((t: any) => ({ id: t.id, label: t.name }))} value={toolIds} onChange={setToolIds} /></Field>
      <Field label="Parts / component types (REQUIRES_PART)"><MultiToggle items={L.types.map((t: any) => ({ id: t.id, label: t.name }))} value={compIds} onChange={setCompIds} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['safetyNotes', 'preparation', 'verification', 'reassembly'] as const).map((k) => (
          <Field key={k} label={{ safetyNotes: 'Safety notes', preparation: 'Preparation', verification: 'Verification', reassembly: 'Reassembly' }[k]} hint="One per line" optional>
            <Textarea rows={3} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="space-y-3">
        <div className="text-sm font-medium">Steps</div>
        {steps.map((s, i) => (
          <Card key={i} className="space-y-2 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-ink-muted">
              Step {i + 1}
              {steps.length > 1 && <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="hover:text-danger">Remove</button>}
            </div>
            <Input placeholder="Title" value={s.title} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Textarea rows={2} placeholder="Instruction (do not invent screw locations, voltages or layouts)" value={s.body} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Expected observation (optional)" value={s.expectedObservation} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, expectedObservation: e.target.value } : x)))} />
              <Input placeholder="Caution (optional)" value={s.caution} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, caution: e.target.value } : x)))} />
              <Select value={s.provenance} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, provenance: e.target.value } : x)))}>{PROVENANCE_TYPES.filter((p) => p !== 'demo').map((p) => <option key={p} value={p}>{PROVENANCE_LABELS[p]}</option>)}</Select>
              <Select value={s.sourceId} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, sourceId: e.target.value } : x)))}><option value="">Step source (optional)</option>{L.sources.map((so: any) => <option key={so.id} value={so.id}>{so.title}</option>)}</Select>
            </div>
          </Card>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setSteps([...steps, { ...blank }])} icon={<Plus className="h-3.5 w-3.5" />}>Add step</Button>
      </div>
    </Dialog>
  );
}

function FailureModeDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-fm', id], queryFn: () => api.get(`/knowledge/failure-modes/${id}`) });
  const [linking, setLinking] = useState(false);
  const [procOpen, setProcOpen] = useState(false);
  const [basePrior, setBasePrior] = useState('');
  const patch = useAction((body: any) => api.patch(`/knowledge/failure-modes/${id}`, body), { success: 'Failure mode updated', invalidate: [['admin-fm', id], ['admin-fms']] });
  const d = q.data;
  const fm = d?.failureMode;
  return (
    <Dialog open onClose={onClose} wide title={fm?.name ?? 'Failure mode'}>
      {q.isLoading && <Skeleton className="h-64" />}
      <ErrorNote error={q.error} />
      {fm && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            <RiskBadge level={fm.risk_level} />
            {fm.is_demo ? <DemoBadge /> : <VerificationBadge status={fm.verification_status} />}
            <Badge tone={fm.is_public ? 'ok' : 'neutral'}>{fm.is_public ? 'Public' : 'Private'}</Badge>
          </div>
          <p className="text-sm text-ink-soft">{fm.description}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Base prior" value={Number(fm.base_prior).toFixed(2)} />
            <Stat label="Effective prior" value={Number(fm.prior_weight).toFixed(2)} hint="after verified outcomes" />
            <Stat label="Confidence" value={pct(Number(fm.confidence))} />
            <Stat label="Verified cases" value={fm.verified_case_count} hint={`${fm.independent_reporter_count} independent reporters`} />
          </div>
          <KeyValue items={[{ label: 'Component', value: fm.component_name }, { label: 'Scope', value: fm.product_name ?? fm.category_name ?? '—' }]} />
          <div>
            <h4 className="mb-2 font-semibold">Symptoms · P(symptom | failure)</h4>
            <div className="space-y-1.5">
              {d.symptoms.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{s.name}</span>
                  <span className="tabular-nums text-ink-muted">base {pct(Number(s.base_likelihood))} → learned <strong className="text-ink">{pct(Number(s.likelihood))}</strong></span>
                </div>
              ))}
              {!d.symptoms.length && <p className="text-sm text-ink-muted">No symptom links.</p>}
            </div>
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Diagnostic probes</h4>
            {d.probes.map((p: any) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-sm">
                <span>{p.prompt} <Badge>{p.kind}</Badge></span>
                <span className="font-mono text-xs text-ink-muted">{p.effects.map((e: any) => `${e.answer}: ×${Number(e.lr)}`).join('  ')}</span>
              </div>
            ))}
            {linking ? <LinkProbe fm={fm} onDone={() => setLinking(false)} /> : <Button size="sm" variant="secondary" className="mt-2" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setLinking(true)}>Link question / test</Button>}
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Repair procedures (RESOLVES)</h4>
            {d.procedures.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-t border-line py-2 text-sm">
                <span>{p.title}</span>
                <span className="flex gap-1.5"><Badge>{PROVENANCE_LABELS[p.provenance as keyof typeof PROVENANCE_LABELS] ?? p.provenance}</Badge><RiskBadge level={p.risk_level} /></span>
              </div>
            ))}
            <Button size="sm" variant="secondary" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setProcOpen(true)}>New procedure</Button>
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Sources (SUPPORTS)</h4>
            {d.sources.map((s: any) => <div key={s.id} className="text-sm">{s.title} <span className="text-xs text-ink-muted">tier {s.reliability_tier} · {s.locator ?? ''}</span></div>)}
            {!d.sources.length && <p className="text-sm text-ink-muted">No sources cited.</p>}
          </div>
          <Card className="space-y-3 bg-paper-sunken/50">
            <h4 className="font-semibold">Curation</h4>
            <div className="flex flex-wrap gap-2">
              {['verified', 'pending_review', 'unverified', 'rejected'].map((s) => (
                <Button key={s} size="sm" variant={fm.verification_status === s ? 'primary' : 'secondary'} onClick={() => patch.mutate({ verificationStatus: s })}>{s.replace('_', ' ')}</Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ isPublic: !fm.is_public })}>{fm.is_public ? 'Make private' : 'Make public'}</Button>
            </div>
            <div className="flex gap-2">
              <Input className="h-9 max-w-[160px]" inputMode="decimal" placeholder="Base prior" value={basePrior} onChange={(e) => setBasePrior(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={!(Number(basePrior) > 0)} onClick={() => patch.mutate({ basePrior: Number(basePrior) })}>Set base prior</Button>
            </div>
          </Card>
          <NewProcedure fm={fm} open={procOpen} onClose={() => setProcOpen(false)} />
        </div>
      )}
    </Dialog>
  );
}

function GraphTab() {
  const L = useLookups();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const stats = useQuery({ queryKey: ['graph-stats'], queryFn: () => api.get('/knowledge/graph/stats') });
  const fms = useQuery({ queryKey: ['admin-fms', q, cat], queryFn: () => api.get(`/knowledge/failure-modes${qs({ q, categoryId: cat, limit: 100 })}`) });
  return (
    <div className="space-y-6">
      {stats.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[['Products', 'products'], ['Components', 'components'], ['Failure modes', 'failure_modes'], ['Symptoms', 'symptoms'], ['Probes', 'diagnostic_probes'], ['Procedures', 'procedures'], ['Parts', 'parts'], ['Compatibility', 'compatibility_relations'], ['Sources', 'sources'], ['Verified outcomes', 'verified_outcomes']].map(([l, k]) => <Stat key={k} label={l} value={stats.data[k]} />)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-ink-faint" />
          <Input className="pl-9" placeholder="Search failure modes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-56" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{L.cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New failure mode</Button>
      </div>
      <ErrorNote error={fms.error} />
      <div className="grid gap-2 sm:grid-cols-2">
        {fms.data?.failureModes.map((f: any) => (
          <button key={f.id} onClick={() => setOpen(f.id)} className="surface space-y-1.5 p-4 text-left transition hover:shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{f.name}</span>
              {f.is_demo ? <DemoBadge /> : <VerificationBadge status={f.verification_status} />}
            </div>
            <div className="text-xs text-ink-muted">{f.component_name} · {f.product_name ?? f.category_name}</div>
            <div className="flex flex-wrap gap-1.5 text-xs text-ink-muted">
              <RiskBadge level={f.risk_level} />
              <Badge>confidence {pct(Number(f.confidence))}</Badge>
              <Badge>{f.verified_case_count} verified cases</Badge>
            </div>
          </button>
        ))}
      </div>
      {open && <FailureModeDetail id={open} onClose={() => setOpen(null)} />}
      <NewFailureMode open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

// ───────────────────────── Sources tab ─────────────────────────
function SourcesTab() {
  const q = useQuery({ queryKey: ['admin-sources'], queryFn: () => api.get('/knowledge/sources?limit=100') });
  const [creating, setCreating] = useState(false);
  const [citeFor, setCiteFor] = useState<any>(null);
  const [f, setF] = useState({ kind: 'technical_documentation', title: '', url: '', publisher: '', publishedAt: '', license: '', accessRestrictions: '' });
  const [file, setFile] = useState<File | null>(null);
  const [cite, setCite] = useState({ entityType: 'failure_mode', entityId: '', locator: '', excerpt: '' });
  const create = useAction(
    async () => {
      const fileId = file ? (await api.upload([file], 'knowledge_source')).files[0].id : null;
      return api.post('/knowledge/sources', { ...f, url: f.url || null, publisher: f.publisher || null, publishedAt: f.publishedAt || null, license: f.license || null, accessRestrictions: f.accessRestrictions || null, fileId });
    },
    { success: 'Source created', invalidate: [['admin-sources']], onSuccess: () => (setCreating(false), setFile(null), setF({ ...f, title: '', url: '' })) },
  );
  const setStatus = useAction((v: { id: string; status: string }) => api.patch(`/knowledge/sources/${v.id}`, { status: v.status }), { success: 'Source updated', invalidate: [['admin-sources']] });
  const addCite = useAction(() => api.post('/knowledge/citations', { ...cite, sourceId: citeFor.id, locator: cite.locator || null, excerpt: cite.excerpt || null }), {
    success: 'Citation attached',
    onSuccess: () => (setCiteFor(null), setCite({ entityType: 'failure_mode', entityId: '', locator: '', excerpt: '' })),
  });
  const fms = useQuery({ queryKey: ['admin-fms', '', ''], queryFn: () => api.get('/knowledge/failure-modes?limit=100'), enabled: !!citeFor });
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-muted">Sources carry a reliability tier derived from their kind. Arbitrary internet content is never authoritative; record the licence and access restrictions before ingesting.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New source</Button>
      </div>
      <ErrorNote error={q.error} />
      <div className="space-y-2">
        {q.data?.sources.map((s: any) => (
          <Card key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.title}</span>
                <Badge>{s.kind.replace(/_/g, ' ')}</Badge>
                <Badge tone="signal">tier {s.reliability_tier}</Badge>
                <Badge tone={STATUS_TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>
              </div>
              <div className="truncate text-xs text-ink-muted">
                {s.publisher ?? '—'}{s.published_at ? ` · ${date(s.published_at)}` : ''} · {s.citation_count} citations · {s.document_count} documents{s.license ? ` · ${s.license}` : ''}
                {s.url && <> · <a className="link" href={s.url} target="_blank" rel="noreferrer">link</a></>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {s.kind !== 'demo' && <Button size="sm" variant="secondary" onClick={() => setCiteFor(s)}>Attach citation</Button>}
              {s.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: 'retracted' })}>Retract</Button> : <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: 'active' })}>Reactivate</Button>}
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="New knowledge source" footer={<Button loading={create.isPending} disabled={!f.title} onClick={() => create.mutate(undefined)}>Create</Button>}>
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{SOURCE_KINDS.filter((k) => k !== 'demo').map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}</Select></Field>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="URL" optional><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
          <Field label="Publisher" optional><Input value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} /></Field>
          <Field label="Publication date" optional><Input type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} /></Field>
          <Field label="Licence" optional><Input value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} /></Field>
        </div>
        <Field label="Access restrictions" optional><Input value={f.accessRestrictions} onChange={(e) => setF({ ...f, accessRestrictions: e.target.value })} /></Field>
        <Field label="Document file" optional hint="PDF or text. Ingest it from the Ingestion tab afterwards."><Input type="file" accept="application/pdf,text/plain,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-2.5" /></Field>
        <ErrorNote error={create.error ? new Error(errorMessage(create.error)) : null} />
      </Dialog>
      <Dialog open={!!citeFor} onClose={() => setCiteFor(null)} title={`Cite “${citeFor?.title ?? ''}”`} footer={<Button loading={addCite.isPending} disabled={!cite.entityId} onClick={() => addCite.mutate(undefined)}>Attach</Button>}>
        <Field label="Supports which kind of claim?"><Select value={cite.entityType} onChange={(e) => setCite({ ...cite, entityType: e.target.value, entityId: '' })}>{['failure_mode', 'product', 'repair_procedure', 'product_spec', 'product_component', 'part_compatibility'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        {cite.entityType === 'failure_mode' ? (
          <Field label="Failure mode"><Select value={cite.entityId} onChange={(e) => setCite({ ...cite, entityId: e.target.value })}><option value="">Choose…</option>{fms.data?.failureModes.map((f: any) => <option key={f.id} value={f.id}>{f.name} ({f.category_name ?? f.product_name})</option>)}</Select></Field>
        ) : cite.entityType === 'product' ? (
          <Field label="Product"><ProductPicker value={cite.entityId ? { id: cite.entityId, name: cite.entityId } : null} onChange={(p) => setCite({ ...cite, entityId: p?.id ?? '' })} /></Field>
        ) : (
          <Field label="Entity ID" hint="Paste the record's ID."><Input value={cite.entityId} onChange={(e) => setCite({ ...cite, entityId: e.target.value.trim() })} /></Field>
        )}
        <Field label="Page / section" optional><Input value={cite.locator} onChange={(e) => setCite({ ...cite, locator: e.target.value })} /></Field>
        <Field label="Verbatim excerpt" optional><Textarea rows={3} value={cite.excerpt} onChange={(e) => setCite({ ...cite, excerpt: e.target.value })} /></Field>
      </Dialog>
    </div>
  );
}

// ───────────────────────── Ingestion tab ─────────────────────────
function JobProgress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [state, setState] = useState<any>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const es = new EventSource(`/api/v1/jobs/${jobId}/events`, { withCredentials: true });
    es.addEventListener('update', (e) => setState(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('end', () => {
      es.close();
      done.current();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);
  if (!state) return <Notice tone="info">Connecting to job progress…</Notice>;
  const p = state.progress ?? {};
  return (
    <Notice tone={state.status === 'succeeded' ? 'ok' : state.status === 'dead' ? 'danger' : 'info'} title={`Ingestion ${state.status}`}>
      {p.stage && <div>Stage: {String(p.stage).replace(/_/g, ' ')}{p.chunk ? ` (${p.chunk}/${p.of})` : ''}{p.chunks ? ` · ${p.chunks} chunks` : ''}</div>}
      {state.result && <div>{state.result.chunks} chunks · {state.result.embedded} embedded ({state.result.embedded ? 'semantic search on' : 'embeddings unavailable'}) · AI extraction: {String(state.result.aiStatus).replace(/_/g, ' ')}</div>}
      {state.result?.injectionFlags?.length > 0 && <div className="font-medium">⚠ Prompt-injection patterns flagged: {state.result.injectionFlags.join(', ')}</div>}
      {state.last_error && <div className="text-danger">{state.last_error}</div>}
    </Notice>
  );
}

function IngestionTab({ openReview }: { openReview: (id: string) => void }) {
  const L = useLookups();
  const docs = useQuery({ queryKey: ['admin-docs'], queryFn: () => api.get('/knowledge/documents') });
  const [sourceId, setSourceId] = useState('');
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [rights, setRights] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const src = L.allSources.find((s: any) => s.id === sourceId);
  const ingest = useAction(
    async () => {
      const fileId = mode === 'file' && file ? (await api.upload([file], 'knowledge_document')).files[0].id : mode === 'file' ? src?.file_id ?? null : null;
      return api.post('/knowledge/documents', { sourceId, fileId: fileId ?? undefined, text: mode === 'text' ? text : undefined, confirmRights: rights });
    },
    { success: 'Ingestion queued', invalidate: [['admin-docs']], onSuccess: (r: any) => (setJobId(r.jobId), setDocId(r.documentId), setFinished(false)) },
  );
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h3 className="flex items-center gap-2 font-semibold"><Upload className="h-4 w-4" /> Ingest a document</h3>
        <Field label="Knowledge source"><Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Choose a source (create one in Sources first)</option>{L.sources.map((s: any) => <option key={s.id} value={s.id}>{s.title} · tier {s.reliability_tier}</option>)}</Select></Field>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === 'file' ? 'primary' : 'secondary'} onClick={() => setMode('file')}>Upload PDF / text file</Button>
          <Button size="sm" variant={mode === 'text' ? 'primary' : 'secondary'} onClick={() => setMode('text')}>Paste text</Button>
        </div>
        {mode === 'file' ? (
          <Field label="File" hint={src?.file_id ? 'Leave empty to use the file attached to this source.' : undefined}><Input type="file" accept="application/pdf,text/plain,.md" className="pt-2.5" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        ) : (
          <Field label="Document text"><Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'SPECIFICATIONS\n\nBattery voltage: 11.55 V'} /></Field>
        )}
        <Checkbox
          checked={rights}
          onChange={setRights}
          label="I confirm REPAIRVERSE may process this document"
          description={`Under its licence${src?.license ? ` (${src.license})` : ''} and access restrictions${src?.access_restrictions ? ` (${src.access_restrictions})` : ''}. Extracted items are only applied after human review.`}
        />
        <Button loading={ingest.isPending} disabled={!sourceId || !rights || (mode === 'text' ? text.trim().length < 10 : !file && !src?.file_id)} onClick={() => ingest.mutate(undefined)}>Start ingestion</Button>
        {jobId && <JobProgress key={jobId} jobId={jobId} onDone={() => (docs.refetch(), setFinished(true))} />}
        {finished && docId && (
          <Button variant="accent" onClick={() => openReview(docId)}>
            Review extracted items
          </Button>
        )}
      </Card>
      <ErrorNote error={docs.error} />
      <div className="space-y-2">
        <h3 className="font-semibold">Documents</h3>
        {docs.data?.documents.length === 0 && <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents ingested" />}
        {docs.data?.documents.map((d: any) => (
          <Card key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.source_title}</span>
                <Badge tone={d.status === 'failed' ? 'danger' : d.status === 'extracted' ? 'ok' : 'neutral'}>{d.status}</Badge>
                {d.injection_flags?.length > 0 && <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>injection flags</Badge>}
              </div>
              <div className="text-xs text-ink-muted">{d.chunk_count} chunks · {d.approved_chunks} approved for retrieval · {d.pending_items} items to review · {relative(d.created_at)}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => openReview(d.id)}>Review</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Review tab ─────────────────────────
function Highlight({ text, quote }: { text: string; quote?: string }) {
  if (!quote) return <>{text}</>;
  const i = text.indexOf(quote.trim());
  if (i < 0) return <>{text}</>;
  const q = quote.trim();
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent-soft px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function ItemReview({ item, chunk }: { item: any; chunk: any }) {
  const L = useLookups();
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState(JSON.stringify(item.payload, null, 2));
  const [fm, setFm] = useState({ name: item.payload.summary ?? '', description: item.payload.supporting_quote ?? '', componentTypeId: '', categoryId: '' });
  const fields = Object.fromEntries((item.payload.fields ?? []).map((f: any) => [f.key, f.value]));
  const review = useAction(
    (decision: string) => {
      const payload = editing ? JSON.parse(json) : undefined;
      const body: any = { decision, notes: notes || undefined, payload };
      if (decision === 'approve' && item.item_type === 'product_spec') body.productId = product?.id;
      if (decision === 'approve' && item.item_type === 'failure_mode') body.failureMode = { ...fm, categoryId: fm.categoryId || null };
      return api.post(`/knowledge/extracted/${item.id}/review`, body);
    },
    { success: (r: any) => (r.applied ? `Applied as ${r.applied.type}` : `Marked ${r.status.replace('_', ' ')}`), invalidate: [['admin-doc', item.document_id], ['admin-docs']] },
  );
  const open = item.status === 'pending' || item.status === 'needs_evidence';
  const canApply = item.item_type === 'product_spec' ? !!product : item.item_type === 'failure_mode' ? !!fm.componentTypeId && !!fm.categoryId && !!fm.name : true;
  return (
    <div className="grid gap-4 border-t border-line pt-4 first:border-0 first:pt-0 lg:grid-cols-2">
      <div className="space-y-2">
        <div className="eyebrow">Source excerpt{chunk?.page ? ` · page ${chunk.page}` : ''}{chunk?.section ? ` · ${chunk.section}` : ''}</div>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-paper-sunken p-4 text-sm leading-relaxed">
          {chunk ? <Highlight text={chunk.content} quote={item.payload.supporting_quote} /> : <span className="text-ink-muted">Source chunk unavailable.</span>}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="dark">{item.item_type.replace('_', ' ')}</Badge>
          <Badge tone={item.extractor.startsWith('llm') ? 'signal' : 'neutral'}>{item.extractor}</Badge>
          <Badge>confidence {pct(Number(item.confidence))}</Badge>
          <Badge tone={STATUS_TONE[item.status]}>{item.status.replace('_', ' ')}</Badge>
        </div>
        <div className="font-medium">{item.payload.summary}</div>
        {editing ? (
          <Textarea rows={8} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
        ) : (
          <KeyValue items={Object.entries(fields).map(([k, v]) => ({ label: k, value: String(v) }))} />
        )}
        {open && item.item_type === 'product_spec' && <Field label="Apply to product"><ProductPicker value={product} onChange={setProduct} /></Field>}
        {open && item.item_type === 'failure_mode' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Name" value={fm.name} onChange={(e) => setFm({ ...fm, name: e.target.value })} />
            <Select value={fm.componentTypeId} onChange={(e) => setFm({ ...fm, componentTypeId: e.target.value })}><option value="">Component type…</option>{L.types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            <Select value={fm.categoryId} onChange={(e) => setFm({ ...fm, categoryId: e.target.value })}><option value="">Category…</option>{L.cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Input placeholder="Description" value={fm.description} onChange={(e) => setFm({ ...fm, description: e.target.value })} />
          </div>
        )}
        {open && !['product_spec', 'failure_mode'].includes(item.item_type) && <p className="text-xs text-ink-muted">Approving records the decision; create the linked graph entity from the Graph tab if needed.</p>}
        {item.applied_entity_id && <Notice tone="ok">Applied as {item.applied_entity_type} with a citation to this excerpt.</Notice>}
        {item.review_notes && <p className="text-xs text-ink-muted">Notes: {item.review_notes}</p>}
        {open && (
          <>
            <Input placeholder="Review notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" loading={review.isPending} disabled={!canApply} onClick={() => review.mutate('approve')}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing((e) => !e)}>{editing ? 'Stop editing' : 'Edit payload'}</Button>
              <Button size="sm" variant="secondary" onClick={() => review.mutate('request_evidence')}>Request evidence</Button>
              <Button size="sm" variant="ghost" onClick={() => review.mutate('reject')}>Reject</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewTab({ docId, setDocId }: { docId: string | null; setDocId: (id: string) => void }) {
  const docs = useQuery({ queryKey: ['admin-docs'], queryFn: () => api.get('/knowledge/documents') });
  const doc = useQuery({ queryKey: ['admin-doc', docId], queryFn: () => api.get(`/knowledge/documents/${docId}`), enabled: !!docId });
  const approve = useAction((approved: boolean) => api.post(`/knowledge/documents/${docId}/approve`, { approved }), { success: (r: any) => (r.approved ? `${r.chunks} chunks approved for retrieval grounding` : 'Withdrawn from retrieval'), invalidate: [['admin-doc', docId], ['admin-docs']] });
  const chunkById = useMemo(() => new Map((doc.data?.chunks ?? []).map((c: any) => [c.id, c])), [doc.data]);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const items = (doc.data?.items ?? []).filter((i: any) => filter === 'all' || i.status === 'pending' || i.status === 'needs_evidence');
  const d = doc.data?.document;
  const approvedChunks = doc.data?.chunks.filter((c: any) => c.approved).length ?? 0;
  return (
    <div className="space-y-4">
      <Field label="Document">
        <Select value={docId ?? ''} onChange={(e) => setDocId(e.target.value)}>
          <option value="">Choose a document…</option>
          {docs.data?.documents.map((x: any) => <option key={x.id} value={x.id}>{x.source_title} · {x.pending_items} to review · {relative(x.created_at)}</option>)}
        </Select>
      </Field>
      <ErrorNote error={doc.error} />
      {doc.isLoading && docId && <Skeleton className="h-64" />}
      {d && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{d.source_title}</div>
                <div className="text-xs text-ink-muted">{d.source_kind.replace(/_/g, ' ')} · {d.page_count ?? '?'} pages · {doc.data.chunks.length} chunks · {approvedChunks} approved for retrieval{d.license ? ` · ${d.license}` : ''}</div>
              </div>
              {approvedChunks === doc.data.chunks.length && doc.data.chunks.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => approve.mutate(false)}>Withdraw from retrieval</Button>
              ) : (
                <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate(true)}>Approve document for retrieval</Button>
              )}
            </div>
            {d.injection_flags?.length > 0 && (
              <Notice tone="danger" title="Possible prompt-injection content detected" icon={<AlertTriangle className="h-4 w-4" />}>
                Patterns: {d.injection_flags.join(', ')}. This text was treated strictly as data during extraction. Review carefully before approving the document for AI grounding.
              </Notice>
            )}
            {doc.data.job?.result?.aiStatus && doc.data.job.result.aiStatus !== 'used' && <p className="text-xs text-ink-muted">AI extraction: {String(doc.data.job.result.aiStatus).replace(/_/g, ' ')} — only deterministic rule-based extractions are shown.</p>}
          </Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Extracted items</h3>
            <div className="flex gap-1.5">
              <Button size="sm" variant={filter === 'open' ? 'primary' : 'ghost'} onClick={() => setFilter('open')}>To review</Button>
              <Button size="sm" variant={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>All</Button>
            </div>
          </div>
          <Card className="space-y-4">
            {items.map((i: any) => <ItemReview key={i.id} item={i} chunk={chunkById.get(i.chunk_id)} />)}
            {!items.length && <p className="text-sm text-ink-muted">No items {filter === 'open' ? 'awaiting review' : 'extracted'}.</p>}
          </Card>
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted">Raw job record</summary>
            <JsonView value={doc.data.job} />
          </details>
        </>
      )}
    </div>
  );
}

export default function AdminKnowledge() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'graph';
  const docId = params.get('doc');
  const set = (t: Tab, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Knowledge network" title="Repair knowledge graph" description="Products, components, failures, symptoms, tests, procedures and their sources. Every claim keeps its provenance; extracted knowledge is applied only after review." />
      <Tabs
        tabs={[
          { value: 'graph', label: 'Graph' },
          { value: 'sources', label: 'Sources' },
          { value: 'ingestion', label: 'Ingestion' },
          { value: 'review', label: 'Review' },
        ]}
        value={tab}
        onChange={(t) => set(t)}
      />
      {tab === 'graph' && <GraphTab />}
      {tab === 'sources' && <SourcesTab />}
      {tab === 'ingestion' && <IngestionTab openReview={(id) => set('review', { doc: id })} />}
      {tab === 'review' && <ReviewTab docId={docId} setDocId={(id) => set('review', { doc: id })} />}
    </div>
  );
}
