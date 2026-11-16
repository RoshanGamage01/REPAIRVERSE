import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Button, Card, ErrorNote, Field, PageHeader, Select, Textarea } from '../../ui';
import { CopilotPanel, DiagnosisWorkbench, ProductPicker } from './common';

export default function ProDiagnosticsPage() {
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const start = useMutation({
    mutationFn: () => api.post('/diagnoses', { productId: product?.id ?? null, categoryId: product ? null : categoryId || null, description }),
    onSuccess: setDiagnosis,
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Diagnostics" description="A diagnostic workbench without a job — explore hypotheses, run tests, and ask the copilot. Verified technicians see higher-risk tests." />
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card className="space-y-4">
            <Field label="Product" optional>
              <ProductPicker value={product} onChange={setProduct} />
            </Field>
            {!product && (
              <Field label="Or category">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Choose…</option>
                  {cats.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Symptoms">
              <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Technical symptoms, observations and measurements" />
            </Field>
            <ErrorNote error={start.error ? new Error(errorMessage(start.error)) : null} />
            <Button variant="accent" disabled={(!product && !categoryId) || description.trim().length < 3} loading={start.isPending} onClick={() => start.mutate()} icon={<Stethoscope className="h-4 w-4" />}>
              {diagnosis ? 'Start new diagnosis' : 'Diagnose'}
            </Button>
          </Card>
          {diagnosis && (
            <Card>
              <DiagnosisWorkbench diagnosis={diagnosis} onUpdate={setDiagnosis} />
            </Card>
          )}
        </div>
        <CopilotPanel />
      </div>
    </div>
  );
}
