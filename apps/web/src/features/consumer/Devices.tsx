import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Boxes, Plus, ScanSearch } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { relative, toCents } from '../../lib/format';
import { Badge, Button, DemoBadge, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Skeleton, useToast } from '../../ui';
import { ProductPicker } from './components';

function AddDeviceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [product, setProduct] = useState<any>(null);
  const [f, setF] = useState({ nickname: '', variantId: '', serialNumber: '', purchaseDate: '', warrantyExpires: '', price: '' });
  const set = (k: keyof typeof f) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const profile = useQuery({ queryKey: ['product', product?.id], queryFn: () => api.get(`/products/${product.id}`), enabled: !!product });
  const m = useMutation({
    mutationFn: () =>
      api.post('/library/devices', {
        productId: product?.id ?? null,
        variantId: f.variantId || null,
        nickname: f.nickname || (product ? `${product.name} ${product.model_number ?? ''}`.trim() : ''),
        serialNumber: f.serialNumber || null,
        purchaseDate: f.purchaseDate || null,
        warrantyExpires: f.warrantyExpires || null,
        purchasePriceCents: f.price ? toCents(f.price) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast('Device added');
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a device"
      footer={
        <Button loading={m.isPending} disabled={!f.nickname && !product} onClick={() => m.mutate()}>
          Add device
        </Button>
      }
    >
      <Field label="Product" optional hint="Link it to the knowledge network for model-specific help.">
        <ProductPicker value={product} onChange={setProduct} />
      </Field>
      {profile.data?.variants?.length > 0 && (
        <Field label="Variant">
          <Select value={f.variantId} onChange={set('variantId')}>
            <option value="">Not sure</option>
            {profile.data.variants.map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Nickname">
        <Input value={f.nickname} onChange={set('nickname')} placeholder={product ? product.name : 'e.g. Kitchen coffee maker'} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Serial number" optional>
          <Input value={f.serialNumber} onChange={set('serialNumber')} />
        </Field>
        <Field label="Purchase price" optional>
          <Input inputMode="decimal" value={f.price} onChange={set('price')} />
        </Field>
        <Field label="Purchase date" optional>
          <Input type="date" value={f.purchaseDate} onChange={set('purchaseDate')} />
        </Field>
        <Field label="Warranty expires" optional>
          <Input type="date" value={f.warrantyExpires} onChange={set('warrantyExpires')} />
        </Field>
      </div>
      <ErrorNote error={m.error ? new Error(errorMessage(m.error)) : null} />
    </Dialog>
  );
}

export default function DevicesPage() {
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['devices'], queryFn: () => api.get('/library/devices') });
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal repair library"
        title="My Devices"
        description="Everything you own, with its full repair and maintenance history."
        actions={
          <>
            <Link to="/identify">
              <Button variant="secondary" icon={<ScanSearch className="h-4 w-4" />}>
                Identify a device
              </Button>
            </Link>
            <Button onClick={() => setAdding(true)} icon={<Plus className="h-4 w-4" />}>
              Add device
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.data?.devices?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.devices.map((d: any) => {
            const warranty = d.warranty_expires ? new Date(d.warranty_expires) > new Date() : null;
            return (
              <Link key={d.id} to={`/devices/${d.id}`} className="surface flex flex-col gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper-sunken">
                    <Boxes className="h-5 w-5" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {d.product_is_demo && <DemoBadge />}
                    {d.due_reminders > 0 && (
                      <Badge tone="accent" icon={<BellRing className="h-3 w-3" />}>
                        {d.due_reminders} due
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="font-semibold">{d.nickname}</div>
                  <div className="text-sm text-ink-muted">{d.product_name ? `${d.product_name} ${d.model_number ?? ''}${d.variant_name ? ` · ${d.variant_name}` : ''}` : 'Not linked to a product'}</div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>{d.repair_count} repairs</span>
                  {warranty !== null && <span className={warranty ? 'text-ok' : ''}>{warranty ? 'Under warranty' : 'Warranty expired'}</span>}
                  <span>Updated {relative(d.last_event_at ?? d.created_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<Boxes className="h-8 w-8" />} title="No devices yet" description="Add the things you own to track repairs, warranties and maintenance." action={<Button onClick={() => setAdding(true)}>Add your first device</Button>} />
      )}
      <AddDeviceDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
