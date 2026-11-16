import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Textarea } from '../../ui';
import { ProductPicker } from './common';

export default function NewJobPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ customerName: '', customerContact: '', complaint: '', intakeCondition: '', nickname: '', serialNumber: '' });
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: async () => {
      const job = await api.post('/pro/jobs', {
        customerName: f.customerName,
        customerContact: f.customerContact || undefined,
        complaint: f.complaint,
        intakeCondition: f.intakeCondition || undefined,
        device: { productId: product?.id ?? null, nickname: f.nickname || product?.name || 'Customer device', serialNumber: f.serialNumber || null },
      });
      if (files.length) {
        const up = await api.upload(files, 'job_intake');
        for (const file of up.files) await api.post(`/pro/jobs/${job.id}/attachments`, { fileId: file.id, stage: 'intake', label: file.original_name });
      }
      return job;
    },
    onSuccess: (j) => nav(`/pro/jobs/${j.id}`),
  });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Intake" title="New repair job" description="Record the device, the customer's complaint and its condition on arrival." />
      <Card className="space-y-4">
        <h2 className="font-semibold">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="cn"><Input id="cn" value={f.customerName} onChange={set('customerName')} /></Field>
          <Field label="Contact" optional htmlFor="cc"><Input id="cc" value={f.customerContact} onChange={set('customerContact')} placeholder="Phone or email" /></Field>
        </div>
        <p className="text-xs text-ink-muted">Customer details stay private to your workspace and are never included in knowledge contributions.</p>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Device</h2>
        <Field label="Product" optional hint="Linking the product enables model-specific knowledge and parts.">
          <ProductPicker value={product} onChange={setProduct} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Device label" htmlFor="nick" optional><Input id="nick" value={f.nickname} onChange={set('nickname')} placeholder="e.g. Silver laptop" /></Field>
          <Field label="Serial number" htmlFor="sn" optional><Input id="sn" value={f.serialNumber} onChange={set('serialNumber')} /></Field>
        </div>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-semibold">Complaint & condition</h2>
        <Field label="Customer complaint" htmlFor="cp"><Textarea id="cp" value={f.complaint} onChange={set('complaint')} placeholder="In the customer's words" /></Field>
        <Field label="Incoming condition" optional htmlFor="ic"><Textarea id="ic" rows={3} value={f.intakeCondition} onChange={set('intakeCondition')} placeholder="Scratches, missing screws, liquid indicators…" /></Field>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles((x) => [...x, ...Array.from(e.target.files ?? [])].slice(0, 8))} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} icon={<ImagePlus className="h-3.5 w-3.5" />}>Intake photos</Button>
          {files.map((file, i) => (
            <Badge key={i}>{file.name.slice(0, 16)}<button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button></Badge>
          ))}
        </div>
      </Card>
      <ErrorNote error={create.error ? new Error(errorMessage(create.error)) : null} />
      <Button variant="accent" size="lg" disabled={!f.customerName.trim() || f.complaint.trim().length < 3} loading={create.isPending} onClick={() => create.mutate()}>Create job</Button>
    </div>
  );
}
