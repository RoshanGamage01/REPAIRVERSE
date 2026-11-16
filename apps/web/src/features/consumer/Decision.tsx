import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CircleHelp, Minus, Scale, TrendingDown, TrendingUp, UserRound } from 'lucide-react';
import { REPAIR_RECOMMENDATION_LABELS } from '@repairverse/shared';
import { api, errorMessage } from '../../lib/api';
import { money, toCents } from '../../lib/format';
import { Button, Card, cx, ErrorNote, Field, Input, Notice, PageHeader, Segmented } from '../../ui';

const directionIcon: Record<string, any> = {
  favours_repair: <TrendingUp className="h-4 w-4 text-ok" />,
  favours_replacement: <TrendingDown className="h-4 w-4 text-danger" />,
  favours_professional: <UserRound className="h-4 w-4 text-warn" />,
  neutral: <Minus className="h-4 w-4 text-ink-faint" />,
  unknown: <CircleHelp className="h-4 w-4 text-ink-faint" />,
};
const recTone: Record<string, string> = {
  repair_recommended: 'bg-ok text-white',
  professional_repair_recommended: 'bg-warn text-white',
  more_diagnosis_required: 'bg-ink text-paper',
  replacement_may_be_more_economical: 'bg-danger text-white',
};

export default function DecisionPage() {
  const { id } = useParams();
  const diagnosis = useQuery({ queryKey: ['diagnosis', id], queryFn: () => api.get(`/diagnoses/${id}`) });
  const [failureModeId, setFm] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const [replacementSource, setReplacementSource] = useState('');
  const [labor, setLabor] = useState('');
  const [age, setAge] = useState('');
  const [warranty, setWarranty] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const decide = useMutation({
    mutationFn: () =>
      api.post('/decisions', {
        diagnosisId: id,
        failureModeId: failureModeId ?? undefined,
        replacementCostCents: replacement ? toCents(replacement) : null,
        replacementCostSource: replacementSource || null,
        laborCostCents: labor ? toCents(labor) : null,
        productAgeYears: age ? Number(age) : null,
        underWarranty: warranty === 'unknown' ? null : warranty === 'yes',
      }),
  });
  const r = decide.data;
  const hyps = diagnosis.data?.hypotheses ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/diagnose/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to diagnosis
      </Link>
      <PageHeader eyebrow="Repair vs replace" title="Is it worth repairing?" description="A transparent comparison using only sourced figures or numbers you provide. Nothing is estimated behind your back." />
      <Card className="space-y-5">
        {hyps.length > 1 && (
          <Field label="Which hypothesis are you weighing?">
            <Segmented options={hyps.slice(0, 3).map((h: any) => ({ value: h.failureModeId, label: `${h.name} · ${Math.round(h.probability * 100)}%` }))} value={failureModeId ?? hyps[0]?.failureModeId} onChange={setFm} size="sm" />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price of a comparable replacement" optional hint="New or refurbished — what you'd actually pay.">
            <Input inputMode="decimal" placeholder="e.g. 899" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </Field>
          <Field label="Where's that price from?" optional>
            <Input placeholder="e.g. retailer listing" value={replacementSource} onChange={(e) => setReplacementSource(e.target.value)} />
          </Field>
          <Field label="Labour quote" optional hint="If a technician quoted you.">
            <Input inputMode="decimal" placeholder="e.g. 60" value={labor} onChange={(e) => setLabor(e.target.value)} />
          </Field>
          <Field label="Product age (years)" optional hint="Uses your device's purchase date if linked.">
            <Input inputMode="decimal" value={age} onChange={(e) => setAge(e.target.value)} />
          </Field>
        </div>
        <Field label="Is it still under warranty?">
          <Segmented options={[{ value: 'unknown', label: 'Not sure' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={warranty} onChange={setWarranty} size="sm" />
        </Field>
        <Button variant="accent" size="lg" loading={decide.isPending} onClick={() => decide.mutate()} icon={<Scale className="h-4 w-4" />}>
          Compare
        </Button>
        <ErrorNote error={decide.error ? new Error(errorMessage(decide.error)) : null} />
      </Card>

      {r && (
        <div className="animate-fade-up space-y-4">
          <div className={cx('rounded-3xl p-6 sm:p-8', recTone[r.recommendation])}>
            <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Recommendation</div>
            <div className="display mt-1 text-4xl">{REPAIR_RECOMMENDATION_LABELS[r.recommendation as keyof typeof REPAIR_RECOMMENDATION_LABELS]}</div>
            <p className="mt-2 opacity-90">{r.headline}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="text-xs text-ink-muted">Known repair costs</div>
              <div className="text-2xl font-semibold">{r.estimatedRepairCost ? money(r.estimatedRepairCost.highCents, r.currency) : 'Unknown'}</div>
              <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                {r.estimatedRepairCost?.components.map((c: any, i: number) => (
                  <li key={i}>
                    {money(c.amountCents, r.currency)} — {c.origin}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <div className="text-xs text-ink-muted">Replacement</div>
              <div className="text-2xl font-semibold">{r.replacementCost ? money(r.replacementCost.amountCents, r.currency) : 'Not provided'}</div>
              {r.replacementCost && <div className="mt-2 text-xs text-ink-muted">{r.replacementCost.origin}</div>}
            </Card>
          </div>
          <Card className="space-y-1">
            <h3 className="pb-2 font-semibold">How we reasoned</h3>
            {r.factors.map((f: any) => (
              <div key={f.factor} className="flex gap-3 border-t border-line py-3 first:border-0">
                <div className="mt-0.5">{directionIcon[f.direction]}</div>
                <div>
                  <div className="text-sm font-medium">{f.factor}</div>
                  <div className="text-sm text-ink-muted">{f.assessment}</div>
                </div>
              </div>
            ))}
          </Card>
          {r.missingInformation.length > 0 && (
            <Notice tone="warn" title="Missing information">
              <ul className="space-y-0.5">
                {r.missingInformation.map((m: string) => (
                  <li key={m}>• {m}</li>
                ))}
              </ul>
            </Notice>
          )}
          {r.caveats.map((c: string) => (
            <p key={c} className="text-xs text-ink-muted">
              {c}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {r.failureMode && (
              <Link to={`/diagnose/${id}/guide/${r.failureMode.id}`}>
                <Button variant="secondary">View repair guide</Button>
              </Link>
            )}
            <Link to="/technicians">
              <Button variant="ghost">Find a technician</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
