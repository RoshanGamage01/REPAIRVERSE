import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, CircuitBoard, Stethoscope } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { pct } from '../../lib/format';
import { Badge, Button, Card, cx, DemoBadge, EmptyState, ErrorNote, FullPageSpinner, PageHeader, ProvenanceBadge, RiskBadge, Section, Tabs, VerificationBadge } from '../../ui';
import { classificationLabel, compatLabel, compatTone, FeedbackActions, SaveButton, SourcesList } from './components';

function TreeNode({ node, depth, selected, onSelect, open, toggle }: { node: any; depth: number; selected: string | null; onSelect: (n: any) => void; open: Set<string>; toggle: (id: string) => void }) {
  const hasChildren = node.children?.length > 0;
  const isOpen = open.has(node.id);
  return (
    <li>
      <div className={cx('flex items-center gap-1 rounded-xl pr-2 transition', selected === node.id ? 'bg-ink text-paper' : 'hover:bg-ink/5')} style={{ paddingLeft: depth * 16 + 4 }}>
        <button className={cx('flex h-7 w-7 items-center justify-center', !hasChildren && 'invisible')} onClick={() => toggle(node.id)} aria-label={isOpen ? 'Collapse' : 'Expand'} aria-expanded={isOpen}>
          <ChevronRight className={cx('h-4 w-4 transition', isOpen && 'rotate-90')} />
        </button>
        <button className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 text-left text-sm" onClick={() => onSelect(node)}>
          <span className="truncate font-medium">{node.name}</span>
          {node.variant_name && <span className={cx('shrink-0 text-[11px]', selected === node.id ? 'text-paper/70' : 'text-ink-muted')}>{node.variant_name}</span>}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul>
          {node.children.map((c: any) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ComponentExplorer({ components, typical }: { components: any; typical: any[] }) {
  const [selected, setSelected] = useState<any>(components.tree[0] ?? null);
  const [open, setOpen] = useState<Set<string>>(new Set(components.tree.map((n: any) => n.id)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  if (!components.tree.length) {
    return (
      <Card className="space-y-3">
        <Badge tone="warn">Typical for this category — not model-specific</Badge>
        <div className="flex flex-wrap gap-2">
          {typical.map((t) => (
            <span key={t.id} className="rounded-full bg-paper-sunken px-3 py-1.5 text-sm">
              {t.name}
            </span>
          ))}
        </div>
        <p className="text-xs text-ink-muted">No verified component breakdown is recorded for this model yet.</p>
      </Card>
    );
  }
  const rels = components.relationships.filter((r: any) => selected && (r.from_component_id === selected.id || r.to_component_id === selected.id));
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
      <Card className="p-3">
        <ul aria-label="Component tree">
          {components.tree.map((n: any) => (
            <TreeNode key={n.id} node={n} depth={0} selected={selected?.id ?? null} onSelect={setSelected} open={open} toggle={toggle} />
          ))}
        </ul>
      </Card>
      {selected && (
        <Card className="space-y-4 md:sticky md:top-20 md:self-start">
          <div>
            <div className="eyebrow">{selected.component_type}</div>
            <h3 className="text-lg font-semibold">{selected.name}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <RiskBadge level={selected.default_risk} />
              <VerificationBadge status={selected.verification_status} />
              {selected.variant_name && <Badge>Variant: {selected.variant_name}</Badge>}
            </div>
          </div>
          {Object.keys(selected.attributes ?? {}).length > 0 ? (
            <dl className="divide-y divide-line text-sm">
              {Object.entries(selected.attributes).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-ink-muted">{k.replace(/_/g, ' ')}</dt>
                  <dd className="font-medium">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-ink-muted">No recorded attributes.</p>
          )}
          {rels.length > 0 && (
            <div>
              <div className="eyebrow mb-1">Relationships</div>
              <ul className="space-y-1 text-sm">
                {rels.map((r: any) => (
                  <li key={r.id}>
                    {r.from_name} <span className="text-ink-muted">{r.relation.replace(/_/g, ' ')}</span> {r.to_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link to={`/components/${selected.id}`} className="inline-flex items-center gap-1 text-sm font-medium">
            Component profile <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      )}
    </div>
  );
}

export default function ProductProfilePage() {
  const { slug } = useParams();
  const [tab, setTab] = useState<'overview' | 'components' | 'failures' | 'repairs' | 'parts' | 'sources'>('overview');
  const q = useQuery({ queryKey: ['product', slug], queryFn: () => api.get(`/products/${slug}`) });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorNote error={new Error(errorMessage(q.error))} />;
  const d = q.data;
  const p = d.product;
  const stats = d.repairStatistics;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${p.category.name}${p.manufacturer ? ` · ${p.manufacturer}` : ''}`}
        title={
          <>
            {p.brand} {p.name} {p.modelNumber && <span className="font-mono text-2xl text-ink-muted sm:text-3xl">{p.modelNumber}</span>}
          </>
        }
        description={p.description}
        actions={
          <>
            <SaveButton entityType="product" entityId={p.id} saved={d.saved} />
            <Link to={`/diagnose/new?productId=${p.id}`}>
              <Button variant="accent" size="sm" icon={<Stethoscope className="h-3.5 w-3.5" />}>
                Diagnose a problem with this
              </Button>
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        {p.isDemo ? <DemoBadge label="Fictional demonstration product" /> : <VerificationBadge status={p.verificationStatus} />}
        {p.releaseYear && <Badge>Released {p.releaseYear}</Badge>}
        {!p.isPublic && <Badge tone="warn">Private draft</Badge>}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'components', label: 'Components', count: d.components.count },
          { value: 'failures', label: 'Failure patterns', count: d.failureModes.length },
          { value: 'repairs', label: 'Repairs', count: d.procedures.length },
          { value: 'parts', label: 'Parts', count: d.compatibleParts.length },
          { value: 'sources', label: 'Sources', count: d.sources.length },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
          <Section title="Specifications">
            {d.specifications.length ? (
              <Card className="divide-y divide-line py-2">
                {d.specifications.map((s: any) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="text-sm text-ink-muted">{s.key}</span>
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {s.value} {s.unit}
                      {s.is_estimate ? <Badge tone="warn">Estimate</Badge> : s.verification_status === 'demo' ? <DemoBadge /> : <VerificationBadge status={s.verification_status} />}
                      {s.sources?.length > 0 && <span className="text-xs font-normal text-ink-muted">· {s.sources.map((x: any) => x.title).join(', ')}</span>}
                    </span>
                  </div>
                ))}
              </Card>
            ) : (
              <p className="text-sm text-ink-muted">No specifications backed by a source have been recorded.</p>
            )}
          </Section>
          <div className="space-y-4">
            {d.variants.length > 0 && (
              <Section title="Variants">
                <Card className="space-y-3">
                  {d.variants.map((v: any) => (
                    <div key={v.id}>
                      <div className="text-sm font-medium">
                        {v.name} <span className="font-mono text-xs text-ink-muted">{v.variant_code}</span>
                      </div>
                      <div className="text-xs text-ink-muted">
                        {v.hardware_revision}
                        {v.notes ? ` · ${v.notes}` : ''}
                      </div>
                    </div>
                  ))}
                </Card>
              </Section>
            )}
            <Section title="Identifiers">
              <Card className="space-y-1.5 text-sm">
                {d.identifiers.map((i: any) => (
                  <div key={`${i.kind}${i.value}`} className="flex justify-between gap-3">
                    <span className="uppercase text-ink-muted">{i.kind.replace('_', ' ')}</span>
                    <span className="font-mono">{i.value}</span>
                  </div>
                ))}
              </Card>
            </Section>
            <Section title="Repair statistics">
              <Card className="text-sm">
                {stats.insufficientData ? (
                  <p className="text-ink-muted">
                    Insufficient data: {stats.verifiedRepairs} verified repair{stats.verifiedRepairs === 1 ? '' : 's'} recorded (statistics are shown from {stats.minimumSample}).
                  </p>
                ) : (
                  <p>
                    {pct(stats.success.rate)} success across {stats.verifiedRepairs} verified repairs (95% interval {pct(stats.success.low)}–{pct(stats.success.high)}).
                  </p>
                )}
              </Card>
            </Section>
          </div>
        </div>
      )}

      {tab === 'components' && <ComponentExplorer components={d.components} typical={d.typicalComponents} />}

      {tab === 'failures' &&
        (d.failureModes.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {d.failureModes.map((f: any) => (
              <Card key={f.id} className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <RiskBadge level={f.risk_level} />
                  {f.is_demo ? <DemoBadge /> : <VerificationBadge status={f.verification_status} />}
                  <Badge>{f.model_specific ? 'Model-specific' : 'Category-wide'}</Badge>
                </div>
                <div>
                  <h3 className="font-semibold">{f.name}</h3>
                  <div className="text-xs text-ink-muted">Component: {f.component_name}</div>
                </div>
                <p className="text-sm text-ink-soft">{f.description}</p>
                {f.symptoms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {f.symptoms.map((s: any) => (
                      <span key={s.id} className="rounded-full bg-paper-sunken px-2.5 py-1 text-xs">
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-ink-muted">
                  {f.statistics.insufficientData
                    ? `Frequency and success rates not shown: ${f.statistics.verifiedCases} of ${f.statistics.minimumSample} verified cases needed.`
                    : `${pct(f.statistics.repairSuccess.rate)} repair success over ${f.statistics.verifiedCases} verified cases.`}
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No known failure patterns yet" description="Failure knowledge appears here as repairs are verified." />
        ))}

      {tab === 'repairs' &&
        (d.procedures.length ? (
          <div className="space-y-2">
            {d.procedures.map((r: any) => (
              <Link key={r.id} to={`/procedures/${r.id}`} className="surface flex flex-wrap items-center justify-between gap-3 p-4 transition hover:shadow-soft">
                <div className="min-w-0">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-ink-muted">Resolves: {r.failure_mode_name} · Difficulty {r.difficulty}/5</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <RiskBadge level={r.risk_level} />
                  <ProvenanceBadge provenance={r.provenance} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No documented repair procedures" />
        ))}

      {tab === 'parts' && (
        <div className="space-y-3">
          {d.compatibleParts.length ? (
            d.compatibleParts.map((c: any, i: number) => (
              <Link key={`${c.id}${i}`} to={`/parts/${c.id}`} className="surface flex flex-wrap items-center justify-between gap-3 p-4 hover:shadow-soft">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-ink-muted">
                    {c.component_type} · <span className="font-mono">{c.part_number}</span> · {classificationLabel[c.classification]}
                    {c.variant_id ? ' · variant-specific' : ''}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Badge tone={compatTone[c.state]}>{compatLabel[c.state]}</Badge>
                  {c.verification_status === 'demo' ? <DemoBadge /> : <VerificationBadge status={c.verification_status} />}
                </div>
              </Link>
            ))
          ) : (
            <EmptyState title="No compatibility records yet" />
          )}
          <Link to={`/parts?productId=${p.id}`}>
            <Button variant="secondary" icon={<CircuitBoard className="h-4 w-4" />}>
              Check compatibility for a component
            </Button>
          </Link>
        </div>
      )}

      {tab === 'sources' && (
        <Card>
          <SourcesList sources={d.sources} />
        </Card>
      )}

      <div className="border-t border-line pt-4">
        <FeedbackActions entityType="product" entityId={p.id} title={`${p.name} ${p.modelNumber ?? ''}`} />
      </div>
    </div>
  );
}
