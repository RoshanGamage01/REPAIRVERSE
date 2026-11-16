import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, X } from 'lucide-react';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { EmptyState, PageHeader, Section, Skeleton } from '../../ui';

const groups = [
  { type: 'product', title: 'Products', href: (s: any) => `/products/${s.slug ?? s.entity_id}` },
  { type: 'repair_procedure', title: 'Repair procedures', href: (s: any) => `/procedures/${s.entity_id}` },
  { type: 'part', title: 'Parts', href: (s: any) => `/parts/${s.entity_id}` },
  { type: 'failure_mode', title: 'Failure knowledge', href: () => '/discover' },
];

export default function SavedPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['saved'], queryFn: () => api.get('/saved') });
  const unsave = useMutation({
    mutationFn: (s: any) => api.post('/saved', { entityType: s.entity_type, entityId: s.entity_id, saved: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  });
  if (q.isLoading) return <Skeleton className="h-40" />;
  const saved = q.data?.saved ?? [];
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Saved knowledge" title="Saved" description="Products, procedures and parts you want to come back to." />
      {!saved.length && <EmptyState icon={<BookMarked className="h-8 w-8" />} title="Nothing saved yet" description="Use the Save button on any product, procedure or part." />}
      {groups.map((g) => {
        const items = saved.filter((s: any) => s.entity_type === g.type);
        if (!items.length) return null;
        return (
          <Section key={g.type} title={g.title}>
            <div className="space-y-2">
              {items.map((s: any) => (
                <div key={s.entity_id} className="surface flex items-center justify-between gap-3 p-4">
                  <Link to={g.href(s)} className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.title ?? 'Removed item'}</div>
                    <div className="text-xs text-ink-muted">Saved {relative(s.created_at)}</div>
                  </Link>
                  <button className="rounded-full p-2 text-ink-muted hover:bg-ink/5" aria-label="Remove" onClick={() => unsave.mutate(s)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
