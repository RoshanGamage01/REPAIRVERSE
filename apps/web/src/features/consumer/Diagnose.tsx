import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleHelp,
  FileText,
  FlaskConical,
  HelpCircle,
  ListChecks,
  MessageSquarePlus,
  Microscope,
  Pencil,
  Printer,
  Scale,
  Search,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { dateTime } from '../../lib/format';
import {
  Badge,
  Button,
  Card,
  ConfidenceMeter,
  cx,
  DemoBadge,
  Disclosure,
  ErrorNote,
  FullPageSpinner,
  Notice,
  RiskBadge,
  SafetyStop,
  Segmented,
  Textarea,
  useToast,
  VerificationBadge,
} from '../../ui';
import { VoiceButton } from './StartDiagnosis';

export interface Hypothesis {
  failureModeId: string;
  name: string;
  description: string;
  component: { id: string; name: string };
  probability: number;
  confidenceBand: string;
  status: 'hypothesis';
  supportingEvidence: { kind: string; label: string; strength: number }[];
  contradictingEvidence: { kind: string; label: string; strength: number }[];
  missingInformation: string[];
  recommendedTests: { probeId: string; prompt: string; riskLevel: any; allowed: boolean; instructions: string[] }[];
  requiredTools: string[];
  procedures: { id: string; title: string; difficulty: number; riskLevel: any; provenance: string; verificationStatus: string; estimatedMinutes: [number, number] | null }[];
  complexity: number | null;
  safety: { level: any; hazards: { id: string; label: string; guidance: string }[]; professionalOnly: boolean; stopConditions: string[] };
  knowledge: { verificationStatus: string; isDemo: boolean; confidence: number; verifiedCases: number; sources: { id: string; title: string; kind: string; url: string | null; locator: string | null }[] };
}

export interface DiagnosisView {
  id: string;
  status: string;
  description: string;
  product: { id: string; name: string; slug: string; model_number: string } | null;
  category: { id: string; name: string };
  deviceId: string | null;
  interpretation: any;
  readiness: 'needs_more_information' | 'leading_hypothesis' | 'no_further_questions';
  evidenceCount: number;
  unknownProbability: number;
  hypotheses: Hypothesis[];
  nextQuestions: { probeId: string; kind: 'question' | 'test'; prompt: string; help: string | null; instructions: string[]; riskLevel: any; options: { value: string; label: string }[]; why: string; expectedInformationGain: number }[];
  journey: any[];
  missingInformation: string[];
  safetyNotice: { level: string; message: string } | null;
  disclaimer: string;
  saved: boolean;
  createdAt: string;
}

const STAGES = [
  { key: 'initial', label: 'Symptoms' },
  { key: 'question', label: 'Questions' },
  { key: 'test', label: 'Tests' },
  { key: 'observations', label: 'Observations' },
  { key: 'diagnosis', label: 'Diagnosis' },
];

function JourneyStrip({ d }: { d: DiagnosisView }) {
  const has = (t: string) => d.journey.some((j) => j.type === t);
  const raw = [true, has('question'), has('test'), d.evidenceCount >= 3, d.readiness !== 'needs_more_information' || d.status === 'completed'];
  // A stage counts as reached once any later stage is reached (questions may be skipped in favour of tests).
  const reached = raw.map((_, i) => raw.slice(i).some(Boolean));
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1 text-xs" aria-label="Diagnostic journey">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex shrink-0 items-center gap-1">
          <span className={cx('flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium', reached[i] ? 'bg-ink text-paper' : 'bg-ink/5 text-ink-muted')}>
            {reached[i] && <CheckCircle2 className="h-3 w-3" />}
            {s.label}
          </span>
          {i < STAGES.length - 1 && <span className={cx('h-px w-4', reached[i + 1] ? 'bg-ink' : 'bg-line')} />}
        </li>
      ))}
    </ol>
  );
}

function QuestionCard({ q, onAnswer, busy }: { q: DiagnosisView['nextQuestions'][number]; onAnswer: (v: string) => void; busy: boolean }) {
  const [showHow, setShowHow] = useState(false);
  return (
    <div className="animate-fade-up overflow-hidden rounded-3xl bg-paper-raised shadow-lift ring-1 ring-line">
      <div className="space-y-4 p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={q.kind === 'test' ? 'accent' : 'neutral'} icon={q.kind === 'test' ? <Microscope className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}>
            {q.kind === 'test' ? 'Safe diagnostic test' : 'Question'}
          </Badge>
          {q.kind === 'test' && <RiskBadge level={q.riskLevel} />}
        </div>
        <h2 className="text-xl font-semibold leading-snug sm:text-2xl">{q.prompt}</h2>
        {q.help && <p className="text-sm text-ink-muted">{q.help}</p>}
        {q.instructions?.length > 0 && (
          <div>
            <button className="text-sm font-medium text-ink underline decoration-line underline-offset-4" onClick={() => setShowHow((s) => !s)}>
              {showHow ? 'Hide' : 'How to do this safely'}
            </button>
            {showHow && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                {q.instructions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {q.options.map((o) => (
            <Button key={o.value} variant={o.value === 'unsure' ? 'ghost' : 'secondary'} size="lg" disabled={busy} onClick={() => onAnswer(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-paper-sunken/60 px-6 py-3 text-xs text-ink-muted">
        <CircleHelp className="h-3.5 w-3.5 shrink-0" /> Why we ask: {q.why}
      </div>
    </div>
  );
}

function HypothesisCard({ h, rank, diagnosisId }: { h: Hypothesis; rank: number; diagnosisId: string }) {
  return (
    <div className={cx('surface p-5', rank === 0 && 'ring-2 ring-ink')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rank === 0 && <Badge tone="dark">Leading hypothesis</Badge>}
            <RiskBadge level={h.safety.level} />
            {h.knowledge.isDemo ? <DemoBadge /> : <VerificationBadge status={h.knowledge.verificationStatus} />}
          </div>
          <h3 className="mt-2 text-lg font-semibold leading-snug">{h.name}</h3>
          <div className="text-sm text-ink-muted">Component: {h.component.name}</div>
        </div>
      </div>
      <div className="mt-4">
        <ConfidenceMeter value={h.probability} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{h.description}</p>
      <div className="mt-3">
        <Disclosure title="Why this is plausible" meta={<span className="text-xs text-ink-muted">{h.supportingEvidence.length} supporting</span>}>
          <ul className="space-y-1.5 text-sm">
            {h.supportingEvidence.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ok">+</span> {e.label}
              </li>
            ))}
            {h.contradictingEvidence.map((e, i) => (
              <li key={`c${i}`} className="flex gap-2 text-ink-muted">
                <span className="text-danger">−</span> {e.label}
              </li>
            ))}
            {!h.supportingEvidence.length && !h.contradictingEvidence.length && <li className="text-ink-muted">Based on prior knowledge only so far.</li>}
          </ul>
        </Disclosure>
        {(h.missingInformation.length > 0 || h.recommendedTests.length > 0) && (
          <Disclosure title="What would confirm or rule it out">
            <ul className="space-y-2 text-sm">
              {h.recommendedTests.map((t) => (
                <li key={t.probeId} className="flex items-start justify-between gap-3">
                  <span>{t.prompt}</span>
                  {t.allowed ? <RiskBadge level={t.riskLevel} /> : <Badge tone="danger">Professional test</Badge>}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        <Disclosure title="Repair outlook" meta={h.complexity ? <span className="text-xs text-ink-muted">Difficulty {h.complexity}/5</span> : null}>
          <div className="space-y-3 text-sm">
            {h.procedures.length ? (
              h.procedures.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{p.title}</span>
                  <span className="flex gap-1.5 text-xs text-ink-muted">
                    Difficulty {p.difficulty}/5{p.estimatedMinutes ? ` · ${p.estimatedMinutes[0]}–${p.estimatedMinutes[1]} min` : ''}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-ink-muted">No documented procedure in the knowledge network yet.</p>
            )}
            {h.requiredTools.length > 0 && <p className="text-ink-muted">Tools: {h.requiredTools.join(', ')}</p>}
            {h.safety.hazards.length > 0 && (
              <ul className="space-y-1 text-danger">
                {h.safety.hazards.map((z) => (
                  <li key={z.id}>⚠ {z.label}: {z.guidance}</li>
                ))}
              </ul>
            )}
          </div>
        </Disclosure>
        <Disclosure title="Knowledge sources" meta={<span className="text-xs text-ink-muted">{h.knowledge.sources.length}</span>}>
          <ul className="space-y-1 text-sm">
            {h.knowledge.sources.map((s) => (
              <li key={s.id}>
                {s.url ? (
                  <a className="link" href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}{' '}
                <span className="text-xs text-ink-muted">{s.locator}</span>
              </li>
            ))}
            {!h.knowledge.sources.length && <li className="text-ink-muted">No cited sources — treat with extra caution.</li>}
            <li className="text-xs text-ink-muted">Verified repair cases: {h.knowledge.verifiedCases}</li>
          </ul>
        </Disclosure>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/diagnose/${diagnosisId}/guide/${h.failureModeId}`}>
          <Button variant={rank === 0 ? 'primary' : 'secondary'} size="sm" icon={<Wrench className="h-3.5 w-3.5" />}>
            {h.safety.professionalOnly ? 'Safety guidance' : 'Repair guide'}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Report({ d }: { d: DiagnosisView }) {
  const top = d.hypotheses[0];
  return (
    <Card className="space-y-4 print:shadow-none print:ring-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Diagnostic report</h2>
        <Button variant="ghost" size="sm" onClick={() => window.print()} icon={<Printer className="h-3.5 w-3.5" />}>
          Print
        </Button>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">Product</div>
          {d.product ? `${d.product.name} ${d.product.model_number ?? ''}` : `${d.category.name} (model not identified)`}
        </div>
        <div>
          <div className="eyebrow mb-1">Reported</div>
          {d.description}
        </div>
        <div>
          <div className="eyebrow mb-1">Suspected failure (hypothesis)</div>
          {top ? `${top.name} — ${Math.round(top.probability * 100)}% relative likelihood` : 'Insufficient knowledge'}
        </div>
        <div>
          <div className="eyebrow mb-1">Alternative causes</div>
          {d.hypotheses.slice(1, 4).map((h) => `${h.name} (${Math.round(h.probability * 100)}%)`).join(', ') || '—'}
          {d.unknownProbability > 0.01 && `; unrepresented causes (${Math.round(d.unknownProbability * 100)}%)`}
        </div>
        <div>
          <div className="eyebrow mb-1">Supporting evidence</div>
          {top?.supportingEvidence.map((e) => e.label).join('; ') || '—'}
        </div>
        <div>
          <div className="eyebrow mb-1">Missing information</div>
          {[...d.missingInformation, ...(top?.missingInformation ?? [])].join('; ') || 'None outstanding'}
        </div>
        <div>
          <div className="eyebrow mb-1">Recommended tests</div>
          {top?.recommendedTests.map((t) => t.prompt).join('; ') || '—'}
        </div>
        <div>
          <div className="eyebrow mb-1">Required tools</div>
          {top?.requiredTools.join(', ') || '—'}
        </div>
        <div>
          <div className="eyebrow mb-1">Safety precautions</div>
          {top ? [top.safety.level.toUpperCase() + ' risk', ...top.safety.hazards.map((h) => h.label)].join(' · ') : '—'}
        </div>
        <div>
          <div className="eyebrow mb-1">Estimated repair complexity</div>
          {top?.complexity ? `${top.complexity}/5` : 'Unknown'}
        </div>
      </div>
      <p className="text-xs text-ink-muted">{d.disclaimer}</p>
    </Card>
  );
}

export default function DiagnosePage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [moreText, setMoreText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const q = useQuery({ queryKey: ['diagnosis', id], queryFn: () => api.get<DiagnosisView>(`/diagnoses/${id}`) });
  const set = (d: DiagnosisView) => qc.setQueryData(['diagnosis', id], d);
  const answer = useMutation({ mutationFn: (v: { probeId: string; answer: string }) => api.post<DiagnosisView>(`/diagnoses/${id}/answers`, v), onSuccess: (d) => (set(d), setEditing(null)), onError: (e) => toast(errorMessage(e), 'danger') });
  const addMore = useMutation({ mutationFn: () => api.post<DiagnosisView>(`/diagnoses/${id}/symptoms`, { text: moreText }), onSuccess: (d) => (set(d), setMoreText(''), toast('Added to the diagnosis')) });
  const retract = useMutation({ mutationFn: (obsId: string) => api.del<DiagnosisView>(`/diagnoses/${id}/observations/${obsId}`), onSuccess: set });
  const complete = useMutation({
    mutationFn: () => api.post<DiagnosisView>(`/diagnoses/${id}/complete`, { save: true }),
    onSuccess: (d) => {
      set(d);
      qc.invalidateQueries({ queryKey: ['diagnoses'] });
      toast('Saved to your repair history');
    },
  });
  const reopen = useMutation({ mutationFn: () => api.post<DiagnosisView>(`/diagnoses/${id}/reopen`), onSuccess: set });

  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const d = q.data!;
  const top = d.hypotheses[0];
  const next = d.nextQuestions[0];
  const closed = d.status === 'completed';

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="eyebrow">Step 3 of 3 · Diagnose</span>
          <span>·</span>
          <span>{d.product ? `${d.product.name} ${d.product.model_number ?? ''}` : d.category.name}</span>
          <span>·</span>
          <span>{dateTime(d.createdAt)}</span>
        </div>
        <h1 className="display text-4xl leading-tight sm:text-5xl">
          {closed ? 'Diagnosis saved' : d.readiness === 'leading_hypothesis' ? 'A likely cause is emerging' : d.hypotheses.length ? "Let's narrow it down" : 'We need more to go on'}
        </h1>
        <JourneyStrip d={d} />
      </div>

      {d.safetyNotice && (
        <SafetyStop title={d.safetyNotice.message} actions={['Unplug the device and stop using it.', 'Do not open the casing.', 'Find a qualified technician.']}>
          <Link to="/technicians" className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-danger">
            Find a technician <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </SafetyStop>
      )}

      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          {!closed && next && <QuestionCard q={next} busy={answer.isPending} onAnswer={(v) => answer.mutate({ probeId: next.probeId, answer: v })} />}
          {!closed && !next && d.hypotheses.length > 0 && (
            <Notice tone={d.readiness === 'leading_hypothesis' ? 'ok' : 'info'} title={d.readiness === 'leading_hypothesis' ? 'You have a leading hypothesis' : 'No further questions would meaningfully change the ranking'}>
              Review the repair outlook, check parts, and compare repairing against replacing. Remember: this is a hypothesis until a repair confirms it.
            </Notice>
          )}
          {d.nextQuestions.length > 1 && !closed && (
            <div className="space-y-2">
              <div className="eyebrow">Other useful checks</div>
              {d.nextQuestions.slice(1).map((nq) => (
                <Disclosure key={nq.probeId} title={nq.prompt} meta={nq.kind === 'test' ? <Badge tone="accent">Test</Badge> : null}>
                  <Segmented options={nq.options} value={null} onChange={(v) => answer.mutate({ probeId: nq.probeId, answer: v })} size="sm" />
                </Disclosure>
              ))}
            </div>
          )}

          <Card className="space-y-1">
            <div className="flex items-center justify-between pb-2">
              <h2 className="font-semibold">Your diagnostic journey</h2>
              <span className="text-xs text-ink-muted">Tap any answer to change it</span>
            </div>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {d.journey.map((j, i) => (
                <li key={j.observationId ?? i} className="relative">
                  <span className={cx('absolute -left-[25px] top-1 flex h-2.5 w-2.5 rounded-full ring-4 ring-paper-raised', j.type === 'test' ? 'bg-accent' : j.type === 'initial' ? 'bg-ink' : j.type === 'symptom' ? 'bg-signal' : 'bg-ink-muted')} />
                  <div className="text-xs uppercase tracking-wider text-ink-faint">{{ initial: 'Initial report', symptom: 'Symptom', question: 'Answer', test: 'Test result' }[j.type as string] ?? j.type}</div>
                  <div className="text-sm font-medium">{j.label}</div>
                  {j.type === 'initial' && <p className="text-sm text-ink-muted">{j.detail}</p>}
                  {j.type === 'symptom' && (
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      {j.origin === 'ai_extracted' && <Bot className="h-3 w-3 text-signal" />}
                      {j.detail}
                      {!closed && (
                        <button className="text-ink-faint hover:text-danger" onClick={() => retract.mutate(j.observationId)}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                  {(j.type === 'question' || j.type === 'test') &&
                    (editing === j.observationId ? (
                      <div className="mt-1.5">
                        <Segmented options={j.options} value={j.answer} onChange={(v) => answer.mutate({ probeId: j.probeId, answer: v })} size="sm" />
                      </div>
                    ) : (
                      <button disabled={closed} className="group mt-0.5 inline-flex items-center gap-1.5 text-sm text-ink-soft" onClick={() => setEditing(j.observationId)}>
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 font-medium">{j.detail}</span>
                        {!closed && <Pencil className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />}
                      </button>
                    ))}
                </li>
              ))}
            </ol>
            {!closed && (
              <div className="space-y-2 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Noticed something else?</span>
                  <VoiceButton onText={(t) => setMoreText((m) => `${m} ${t}`.trim())} />
                </div>
                <Textarea rows={2} value={moreText} onChange={(e) => setMoreText(e.target.value)} placeholder="e.g. it also beeps three times when starting" />
                <Button size="sm" variant="secondary" disabled={moreText.trim().length < 3} loading={addMore.isPending} onClick={() => addMore.mutate()} icon={<MessageSquarePlus className="h-3.5 w-3.5" />}>
                  Add observation
                </Button>
              </div>
            )}
          </Card>
          {d.interpretation?.aiStatus && d.interpretation.aiStatus !== 'used' && (
            <p className="text-xs text-ink-muted">
              Symptoms were matched against the knowledge network vocabulary{d.interpretation.aiStatus === 'not_configured' ? ' (AI language interpretation is not configured in this environment)' : ''}.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="eyebrow">Possible causes</div>
              <div className="text-xs text-ink-muted">Ranked hypotheses · {d.evidenceCount} pieces of evidence</div>
            </div>
          </div>
          {d.hypotheses.length === 0 && (
            <Notice tone="warn" title="Reliable knowledge isn't available for these symptoms yet">
              REPAIRVERSE won't guess. Try describing the problem differently, or ask a technician — their confirmed repair will teach the network.
            </Notice>
          )}
          {d.hypotheses.slice(0, 4).map((h, i) => (
            <HypothesisCard key={h.failureModeId} h={h} rank={i} diagnosisId={d.id} />
          ))}
          {d.unknownProbability >= 0.01 && (
            <div className="rounded-2xl border border-dashed border-line p-4">
              <ConfidenceMeter value={d.unknownProbability} label="A cause not yet in the knowledge network" compact />
            </div>
          )}
          {d.missingInformation.map((m) => (
            <Notice key={m} tone="info">
              {m}
            </Notice>
          ))}
          <p className="text-xs leading-relaxed text-ink-muted">{d.disclaimer}</p>
        </div>
      </div>

      <div className="sticky bottom-20 z-20 md:bottom-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 rounded-full bg-ink/95 p-2 shadow-lift backdrop-blur">
          {top && (
            <Link to={`/diagnose/${d.id}/decision`}>
              <Button variant="accent" icon={<Scale className="h-4 w-4" />}>
                Repair or replace?
              </Button>
            </Link>
          )}
          {top && d.product && (
            <Link to={`/parts?productId=${d.product.id}&componentTypeId=${top.component.id}`}>
              <Button variant="ghost" className="text-paper hover:bg-paper/10 hover:text-paper" icon={<Search className="h-4 w-4" />}>
                Parts
              </Button>
            </Link>
          )}
          <Button variant="ghost" className="text-paper hover:bg-paper/10 hover:text-paper" onClick={() => setShowReport((s) => !s)} icon={<FileText className="h-4 w-4" />}>
            Report
          </Button>
          {closed ? (
            <Button variant="ghost" className="text-paper hover:bg-paper/10 hover:text-paper" onClick={() => reopen.mutate()} icon={<ListChecks className="h-4 w-4" />}>
              Reopen
            </Button>
          ) : (
            <Button variant="ghost" className="text-paper hover:bg-paper/10 hover:text-paper" loading={complete.isPending} onClick={() => complete.mutate()} icon={<CheckCircle2 className="h-4 w-4" />}>
              Save to history
            </Button>
          )}
        </div>
      </div>
      {showReport && <Report d={d} />}
      {d.hypotheses.some((h) => h.knowledge.isDemo) && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <FlaskConical className="h-3.5 w-3.5" /> Some knowledge used here is demonstration data and has not been verified.
        </p>
      )}
    </div>
  );
}
