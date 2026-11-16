import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Gauge, Wrench } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Card, DemoBadge, ErrorNote, FullPageSpinner, Notice, PageHeader, ProvenanceBadge, RiskBadge, SafetyStop, Section, VerificationBadge } from '../../ui';
import { FeedbackActions, SaveButton, SourcesList } from './components';

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <Section title={title}>
      <Card>
        <ul className="space-y-1.5 text-sm text-ink-soft">
          {items.map((i) => (
            <li key={i}>— {i}</li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export default function ProcedurePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['procedure', id], queryFn: () => api.get(`/procedures/${id}`) });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const p = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow={`Resolves: ${p.failureMode.name}`} title={p.title} description={p.objective} actions={<SaveButton entityType="repair_procedure" entityId={p.id} />} />
      <div className="flex flex-wrap gap-1.5">
        <RiskBadge level={p.riskLevel} />
        <ProvenanceBadge provenance={p.provenance} />
        {p.isDemo ? <DemoBadge /> : <VerificationBadge status={p.verificationStatus} />}
        <span className="text-xs text-ink-muted">Version {p.version}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <Gauge className="mb-1 h-4 w-4 text-ink-muted" />
          <div className="text-xs text-ink-muted">Difficulty</div>
          <div className="font-semibold">{p.difficulty}/5</div>
        </Card>
        <Card className="p-4">
          <Clock className="mb-1 h-4 w-4 text-ink-muted" />
          <div className="text-xs text-ink-muted">Time</div>
          <div className="font-semibold">{p.estimatedMinutes ? `${p.estimatedMinutes[0]}–${p.estimatedMinutes[1]} min` : 'Unknown'}</div>
        </Card>
        <Card className="p-4">
          <Wrench className="mb-1 h-4 w-4 text-ink-muted" />
          <div className="text-xs text-ink-muted">Tools</div>
          <div className="text-sm font-semibold">{p.tools.length}</div>
        </Card>
      </div>
      {p.stepsWithheld ? (
        <SafetyStop title={p.professionalGuidance.title} reasons={[...p.safety.hazards.map((h: any) => `${h.label}: ${h.guidance}`), ...p.professionalGuidance.reasons]} actions={p.professionalGuidance.whatYouCanDo}>
          <Link to="/technicians" className="inline-flex rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-danger">
            Find a technician
          </Link>
        </SafetyStop>
      ) : (
        <>
          {p.safety.hazards.length > 0 && (
            <Notice tone="warn" title="Hazards">
              {p.safety.hazards.map((h: any) => (
                <div key={h.id}>• {h.label}: {h.guidance}</div>
              ))}
            </Notice>
          )}
          <List title="Tools" items={p.tools.map((t: any) => t.name)} />
          <List title="Safety requirements" items={p.safetyNotes} />
          <List title="Preparation" items={p.preparation} />
          <Section title="Steps">
            <ol className="space-y-3">
              {p.steps.map((s: any) => (
                <li key={s.position} className="surface space-y-2 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-muted">Step {s.position}</span>
                    <ProvenanceBadge provenance={s.provenance} />
                  </div>
                  <div className="font-semibold">{s.title}</div>
                  <p className="text-sm leading-relaxed text-ink-soft">{s.body}</p>
                  {s.caution && <Notice tone="warn">{s.caution}</Notice>}
                  {s.expected_observation && <p className="text-sm text-ink-muted">You should see: {s.expected_observation}</p>}
                  {s.source_title && <p className="text-xs text-ink-muted">Source: {s.source_title}</p>}
                </li>
              ))}
            </ol>
          </Section>
          <List title="Verification" items={p.verification} />
          <List title="Reassembly" items={p.reassembly} />
        </>
      )}
      <Section title="Sources">
        <Card>
          <SourcesList sources={p.sources} />
        </Card>
      </Section>
      <FeedbackActions entityType="repair_procedure" entityId={p.id} title={p.title} />
    </div>
  );
}
