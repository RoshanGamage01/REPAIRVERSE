import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Badge, Card, DemoBadge, ErrorNote, FullPageSpinner, PageHeader, RiskBadge, Section, VerificationBadge } from '../../ui';
import { classificationLabel, compatLabel, compatTone, SourcesList } from './components';

export default function ComponentProfilePage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['component', id], queryFn: () => api.get(`/components/${id}`) });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const { component: c, children, relationships, failureModes, parts, sources } = q.data;
  return (
    <div className="space-y-6">
      <Link to={`/products/${c.product.slug}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {c.product.name}
      </Link>
      <PageHeader eyebrow={c.type.name} title={c.name} description={c.type.description ?? c.notes} />
      <div className="flex flex-wrap gap-1.5">
        <RiskBadge level={c.type.defaultRisk} />
        {c.verificationStatus === 'demo' ? <DemoBadge /> : <VerificationBadge status={c.verificationStatus} />}
        {c.variant && <Badge>Variant: {c.variant}</Badge>}
        {c.parent && (
          <Link to={`/components/${c.parent.id}`}>
            <Badge>Part of: {c.parent.name}</Badge>
          </Link>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Attributes" description={c.type.compatAttributes.length ? `Compatibility is assessed on: ${c.type.compatAttributes.join(', ').replace(/_/g, ' ')}` : undefined}>
          <Card className="divide-y divide-line py-2 text-sm">
            {Object.entries(c.attributes ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2">
                <span className="text-ink-muted">{k.replace(/_/g, ' ')}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
            {!Object.keys(c.attributes ?? {}).length && <p className="py-2 text-ink-muted">No recorded attributes.</p>}
          </Card>
        </Section>
        <Section title="Structure">
          <Card className="space-y-3 text-sm">
            {children.length > 0 && (
              <div>
                <div className="eyebrow mb-1">Contains</div>
                <div className="flex flex-wrap gap-1.5">
                  {children.map((ch: any) => (
                    <Link key={ch.id} to={`/components/${ch.id}`} className="rounded-full bg-paper-sunken px-3 py-1 hover:bg-ink/10">
                      {ch.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {relationships.length > 0 ? (
              <ul className="space-y-1">
                {relationships.map((r: any, i: number) => (
                  <li key={i}>
                    {r.from_name} <span className="text-ink-muted">{r.relation.replace(/_/g, ' ')}</span> {r.to_name}
                  </li>
                ))}
              </ul>
            ) : (
              !children.length && <p className="text-ink-muted">No recorded relationships.</p>
            )}
          </Card>
        </Section>
      </div>
      <Section title="Known failure modes">
        <div className="grid gap-3 md:grid-cols-2">
          {failureModes.map((f: any) => (
            <Card key={f.id} className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <RiskBadge level={f.risk_level} />
                {f.is_demo ? <DemoBadge /> : <VerificationBadge status={f.verification_status} />}
              </div>
              <div className="font-semibold">{f.name}</div>
              <p className="text-sm text-ink-soft">{f.description}</p>
            </Card>
          ))}
          {!failureModes.length && <p className="text-sm text-ink-muted">No known failure modes for this component type.</p>}
        </div>
      </Section>
      <Section title="Candidate parts" description="Recorded compatibility state for this product. Parts without a record still need checking.">
        <div className="space-y-2">
          {parts.map((p: any) => (
            <Link key={p.id} to={`/parts/${p.id}`} className="surface flex flex-wrap items-center justify-between gap-2 p-4 hover:shadow-soft">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-ink-muted">
                  <span className="font-mono">{p.part_number}</span> · {classificationLabel[p.classification]}
                </div>
              </div>
              <Badge tone={p.state ? compatTone[p.state] : 'neutral'}>{p.state ? compatLabel[p.state] : 'No record — check compatibility'}</Badge>
            </Link>
          ))}
          {!parts.length && <p className="text-sm text-ink-muted">No parts registered for this component type.</p>}
          <Link className="link text-sm" to={`/parts?productId=${c.product.id}&componentTypeId=${c.type.id}`}>
            Run the compatibility checker
          </Link>
        </div>
      </Section>
      <Section title="Sources">
        <Card>
          <SourcesList sources={sources} />
        </Card>
      </Section>
    </div>
  );
}
