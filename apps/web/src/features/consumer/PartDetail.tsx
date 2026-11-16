import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { Badge, Card, DemoBadge, Disclosure, ErrorNote, FullPageSpinner, PageHeader, Section, VerificationBadge } from '../../ui';
import { classificationLabel, compatLabel, compatTone, OffersList, SaveButton } from './components';

export default function PartDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['part', id], queryFn: () => api.get(`/parts/${id}`) });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const { part, compatibility, offers } = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow={part.component_type} title={part.name} description={part.description} actions={<SaveButton entityType="part" entityId={part.id} />} />
      <div className="flex flex-wrap gap-1.5">
        <Badge>{classificationLabel[part.classification]}</Badge>
        {part.part_number && <Badge>PN {part.part_number}</Badge>}
        {part.manufacturer && <Badge>{part.manufacturer}</Badge>}
        {part.is_demo ? <DemoBadge /> : <VerificationBadge status={part.verification_status} />}
      </div>
      <Section title="Attributes" description="Compatibility is judged on recorded attributes and explicit evidence — never on names or appearance.">
        <Card className="divide-y divide-line py-2 text-sm">
          {Object.entries(part.attributes ?? {}).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2">
              <span className="text-ink-muted">
                {k.replace(/_/g, ' ')}
                {part.compat_attributes?.includes(k) && <span className="ml-1 text-[11px] text-signal">compared</span>}
              </span>
              <span className="font-medium">{String(v)}</span>
            </div>
          ))}
        </Card>
      </Section>
      <Section title="Compatibility records">
        <div className="space-y-2">
          {compatibility.map((c: any) => (
            <Card key={c.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/products/${c.product_slug}`} className="font-medium hover:underline">
                  {c.product_name} <span className="font-mono text-xs text-ink-muted">{c.model_number}</span>
                  {c.variant_name && <span className="text-sm text-ink-muted"> · {c.variant_name}</span>}
                </Link>
                <div className="flex gap-1.5">
                  <Badge tone={compatTone[c.state]}>{compatLabel[c.state]}</Badge>
                  {c.verification_status === 'demo' ? <DemoBadge /> : <VerificationBadge status={c.verification_status} />}
                </div>
              </div>
              <Disclosure title="Evidence" meta={<span className="text-xs text-ink-muted">{c.evidence.length}</span>}>
                <ul className="space-y-1 text-sm">
                  {c.evidence.map((e: any, i: number) => (
                    <li key={i}>
                      <Badge>{e.kind.replace(/_/g, ' ')}</Badge> {e.description} {e.sourceTitle && <span className="text-xs text-ink-muted">— {e.sourceTitle}</span>}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            </Card>
          ))}
          {!compatibility.length && <p className="text-sm text-ink-muted">No recorded compatibility relationships.</p>}
        </div>
      </Section>
      <Section title="Offers">
        <Card>
          <OffersList offers={offers} />
        </Card>
      </Section>
    </div>
  );
}
