import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, CheckCircle2, Circle, Clock, Gauge, Hand, Package, Sparkles, Wrench } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Badge, Button, Card, cx, DemoBadge, Dialog, ErrorNote, FullPageSpinner, Notice, PageHeader, ProvenanceBadge, RiskBadge, SafetyStop, useToast, VerificationBadge } from '../../ui';

function StepList({ steps, done, toggle }: { steps: any[]; done: Set<string>; toggle: (k: string) => void }) {
  return (
    <ol className="space-y-3">
      {steps.map((s: any) => {
        const key = `${s.position}`;
        const isDone = done.has(key);
        return (
          <li key={key} className={cx('surface p-5 transition', isDone && 'opacity-60')}>
            <div className="flex items-start gap-4">
              <button onClick={() => toggle(key)} className="mt-0.5 shrink-0 text-ink" aria-label={isDone ? 'Mark step not done' : 'Mark step done'}>
                {isDone ? <CheckCircle2 className="h-6 w-6 text-ok" /> : <Circle className="h-6 w-6 text-ink-faint" />}
              </button>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-ink-muted">Step {s.position}</span>
                  <ProvenanceBadge provenance={s.provenance} />
                </div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
                {s.caution && <Notice tone="warn">{s.caution}</Notice>}
                {(s.expected_observation ?? s.expectedObservation) && (
                  <p className="text-sm">
                    <span className="font-medium">You should see: </span>
                    <span className="text-ink-muted">{s.expected_observation ?? s.expectedObservation}</span>
                  </p>
                )}
                {s.source_title && (
                  <p className="text-xs text-ink-muted">
                    Source: {s.source_url ? <a className="link" href={s.source_url} target="_blank" rel="noreferrer">{s.source_title}</a> : s.source_title}
                  </p>
                )}
                {s.references?.length > 0 && (
                  <p className="text-xs text-ink-muted">
                    Grounded in: {s.references.map((r: any) => r.title).join('; ')}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Checklist({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <Card className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="space-y-1.5 text-sm text-ink-soft">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="text-ink-faint">—</span>
            {i}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function GuidePage() {
  const { id, fmId } = useParams();
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [stopOpen, setStopOpen] = useState(false);
  const [active, setActive] = useState(0);
  const diagnosis = useQuery({ queryKey: ['diagnosis', id], queryFn: () => api.get(`/diagnoses/${id}`) });
  const guide = useQuery({ queryKey: ['guide', id, fmId], queryFn: () => api.post(`/diagnoses/${id}/guide`, { failureModeId: fmId }) });
  const ai = useMutation({ mutationFn: () => api.post(`/diagnoses/${id}/guide`, { failureModeId: fmId, generate: true }) });
  const logRepair = useMutation({
    mutationFn: (kind: 'repair_completed' | 'repair_attempt') =>
      api.post(`/library/devices/${diagnosis.data.deviceId}/events`, { kind, title: kind === 'repair_completed' ? `Repaired: ${guide.data.failureMode.name}` : `Repair attempted: ${guide.data.failureMode.name}`, diagnosisId: id }),
    onSuccess: () => toast('Recorded in your device timeline'),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (guide.isLoading) return <FullPageSpinner />;
  if (guide.error) return <ErrorNote error={new Error(errorMessage(guide.error))} />;
  const g = guide.data;
  const proc = g.procedures[active];
  const toggle = (k: string) =>
    setDone((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const aiGuide = ai.data?.aiGuide;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/diagnose/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to diagnosis
      </Link>
      <PageHeader
        eyebrow="Repair guide · for a hypothesis, not a confirmed fault"
        title={g.failureMode.name}
        description={g.failureMode.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <RiskBadge level={g.safety.level} />
            {g.failureMode.isDemo && <DemoBadge />}
          </div>
        }
      />

      {g.professionalOnly ? (
        <SafetyStop title={g.professionalGuidance.title} reasons={[...g.safety.hazards.map((h: any) => `${h.label}: ${h.guidance}`), ...g.professionalGuidance.reasons]} actions={g.professionalGuidance.whatYouCanDo}>
          <Link to="/technicians" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-danger">
            Find a technician
          </Link>
        </SafetyStop>
      ) : (
        <>
          {g.safety.hazards.length > 0 && (
            <Notice tone="warn" title="Before you start">
              <ul className="space-y-0.5">
                {g.safety.hazards.map((h: any) => (
                  <li key={h.id}>• {h.label}: {h.guidance}</li>
                ))}
              </ul>
            </Notice>
          )}
          {g.procedures.length > 1 && (
            <div className="scroll-x">
              {g.procedures.map((p: any, i: number) => (
                <button key={p.id} onClick={() => setActive(i)} className={cx('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ring-1', i === active ? 'bg-ink text-paper ring-ink' : 'ring-line')}>
                  {p.title}
                </button>
              ))}
            </div>
          )}
          {proc ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="p-4">
                  <Gauge className="mb-2 h-4 w-4 text-ink-muted" />
                  <div className="text-xs text-ink-muted">Difficulty</div>
                  <div className="font-semibold">{proc.difficulty}/5</div>
                </Card>
                <Card className="p-4">
                  <Clock className="mb-2 h-4 w-4 text-ink-muted" />
                  <div className="text-xs text-ink-muted">Estimated time</div>
                  <div className="font-semibold">{proc.estimatedMinutes ? `${proc.estimatedMinutes[0]}–${proc.estimatedMinutes[1]} min` : 'Unknown'}</div>
                </Card>
                <Card className="col-span-2 p-4">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <ProvenanceBadge provenance={proc.provenance} />
                    <VerificationBadge status={proc.verificationStatus} />
                  </div>
                  <div className="text-xs text-ink-muted">Objective</div>
                  <div className="text-sm font-medium">{proc.objective}</div>
                </Card>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Wrench className="h-4 w-4" /> Tools
                  </h3>
                  <ul className="space-y-1 text-sm text-ink-soft">
                    {proc.tools.map((t: any) => (
                      <li key={t.id}>{t.name}</li>
                    ))}
                    {!proc.tools.length && <li className="text-ink-muted">None listed</li>}
                  </ul>
                </Card>
                <Card className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Package className="h-4 w-4" /> Parts
                  </h3>
                  <ul className="space-y-1 text-sm text-ink-soft">
                    {proc.requiredComponents.map((c: any) => (
                      <li key={c.id}>
                        {diagnosis.data?.product ? (
                          <Link className="link" to={`/parts?productId=${diagnosis.data.product.id}&componentTypeId=${c.id}`}>
                            {c.name} — check compatible parts
                          </Link>
                        ) : (
                          c.name
                        )}
                      </li>
                    ))}
                    {!proc.requiredComponents.length && <li className="text-ink-muted">No replacement parts required</li>}
                  </ul>
                </Card>
              </div>
              <Checklist title="Safety requirements" items={proc.safetyNotes} />
              <Checklist title="Preparation" items={proc.preparation} />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Steps</h2>
                  <span className="text-sm text-ink-muted">
                    {done.size}/{proc.steps.length} done
                  </span>
                </div>
                <StepList steps={proc.steps} done={done} toggle={toggle} />
              </div>
              <Checklist title="Verify the repair" items={proc.verification} />
              <Checklist title="Reassembly" items={proc.reassembly} />
              {proc.sources?.length > 0 && (
                <p className="text-xs text-ink-muted">
                  Sources: {proc.sources.map((s: any) => s.title).join('; ')}
                </p>
              )}
            </div>
          ) : (
            <Notice tone="warn" title="No documented procedure yet">
              {g.noKnowledgeMessage} You can request an AI-generated guide grounded in available references, or consult a professional.
            </Notice>
          )}

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  <Sparkles className="h-4 w-4 text-signal" /> Alternative: AI-generated guide
                </h3>
                <p className="text-sm text-ink-muted">Grounded only in approved sources; each step shows what supports it.</p>
              </div>
              <Button variant="secondary" size="sm" loading={ai.isPending} onClick={() => ai.mutate()} icon={<Bot className="h-3.5 w-3.5" />}>
                Generate
              </Button>
            </div>
            {aiGuide && aiGuide.status !== 'generated' && <Notice tone={aiGuide.status === 'refused' ? 'danger' : 'info'}>{aiGuide.message}</Notice>}
            {aiGuide?.status === 'generated' && (
              <div className="space-y-3">
                {!aiGuide.knowledgeSufficient && <Notice tone="warn" title="Limited knowledge">{aiGuide.insufficiencyReason}</Notice>}
                <StepList steps={aiGuide.steps} done={done} toggle={(k) => toggle(`ai-${k}`)} />
                <Checklist title="Verify" items={aiGuide.verification} />
                <Checklist title="Other approaches" items={aiGuide.alternatives} />
              </div>
            )}
          </Card>
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-6">
        {!g.professionalOnly && (
          <Button variant="danger" onClick={() => setStopOpen(true)} icon={<Hand className="h-4 w-4" />}>
            Stop — I need a professional
          </Button>
        )}
        {diagnosis.data?.deviceId && !g.professionalOnly && (
          <>
            <Button variant="secondary" loading={logRepair.isPending} onClick={() => logRepair.mutate('repair_completed')} icon={<CheckCircle2 className="h-4 w-4" />}>
              I completed this repair
            </Button>
            <Button variant="ghost" onClick={() => logRepair.mutate('repair_attempt')}>
              It didn't work
            </Button>
          </>
        )}
      </div>
      <Dialog open={stopOpen} onClose={() => setStopOpen(false)} title="Stopping is the right call">
        <p className="text-sm text-ink-soft">If anything feels unsafe, unfamiliar or different from what the guide describes, stop. Reassemble only if it's safe to do so, unplug the device, and bring your diagnostic report to a technician.</p>
        <ul className="space-y-1 text-sm text-ink-muted">
          {g.safety.stopConditions.map((s: string) => (
            <li key={s}>• {s}</li>
          ))}
        </ul>
        <Link to="/technicians">
          <Button className="w-full">Find a technician near me</Button>
        </Link>
      </Dialog>
      {(g.procedures.some((p: any) => p.isDemo) || g.failureMode.isDemo) && (
        <Badge tone="warn">This guide uses demonstration knowledge. Do not rely on it for a real repair.</Badge>
      )}
    </div>
  );
}
