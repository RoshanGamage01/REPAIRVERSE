import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ImagePlus, Mic, Square, Stethoscope, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { Badge, Button, Card, cx, DemoBadge, ErrorNote, Field, Notice, PageHeader, Select, Textarea, useToast } from '../../ui';

/** Voice input: records audio in the browser and sends it to the configured transcription capability. */
export function VoiceButton({ onText }: { onText: (t: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const toast = useToast();
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window;
  if (!supported) return null;
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        try {
          const fd = new FormData();
          fd.append('audio', new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }), 'voice.webm');
          const res = await fetch('/api/v1/ai/transcribe', { method: 'POST', body: fd, credentials: 'include', headers: { 'X-Requested-With': 'repairverse' } });
          const data = await res.json();
          if (!res.ok) throw new ApiError(res.status, data.error?.code, data.error?.message ?? 'Transcription failed');
          onText(data.text);
        } catch (e) {
          toast(e instanceof ApiError && e.status === 503 ? 'Voice input needs a speech-transcription provider to be configured.' : errorMessage(e), 'info');
        } finally {
          setBusy(false);
        }
      };
      r.start();
      rec.current = r;
      setRecording(true);
    } catch {
      toast('Microphone unavailable', 'danger');
    }
  };
  return (
    <Button
      type="button"
      variant={recording ? 'danger' : 'secondary'}
      size="sm"
      loading={busy}
      onClick={() => {
        if (recording) {
          rec.current?.stop();
          setRecording(false);
        } else void start();
      }}
      icon={recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    >
      {recording ? 'Stop' : 'Speak'}
    </Button>
  );
}

export default function StartDiagnosisPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const productId = params.get('productId');
  const [categoryId, setCategoryId] = useState(params.get('categoryId') ?? '');
  const [deviceId, setDeviceId] = useState(params.get('deviceId') ?? '');
  const [description, setDescription] = useState('');
  const [symptomIds, setSymptomIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const product = useQuery({ queryKey: ['product', productId], queryFn: () => api.get(`/products/${productId}`), enabled: !!productId });
  useEffect(() => {
    if (product.data) setCategoryId(product.data.product.category.id);
  }, [product.data]);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories') });
  const symptoms = useQuery({ queryKey: ['symptoms', categoryId], queryFn: () => api.get(`/symptoms?categoryId=${categoryId}`), enabled: !!categoryId });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get('/library/devices') });

  const start = useMutation({
    mutationFn: async () => {
      const fileIds = files.length ? (await api.upload(files, 'diagnosis')).files.map((f: any) => f.id) : [];
      return api.post('/diagnoses', { productId: productId || null, categoryId: categoryId || null, deviceId: deviceId || null, description, symptomIds, fileIds });
    },
    onSuccess: (d) => nav(`/diagnose/${d.id}`),
  });

  const matchingDevices = devices.data?.devices?.filter((d: any) => !productId || d.product_id === productId) ?? [];
  const toggle = (id: string) => setSymptomIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Step 2 of 3 · Describe" title="What's going wrong?" description="Describe it in your own words — what happens, what still works, and when it started. The more specific, the better." />
      {product.data && (
        <Card className="flex items-center justify-between gap-3 py-4">
          <div>
            <div className="text-xs text-ink-muted">Diagnosing</div>
            <div className="font-semibold">
              {product.data.product.brand} {product.data.product.name} <span className="font-mono text-sm font-normal text-ink-muted">{product.data.product.modelNumber}</span>
            </div>
          </div>
          {product.data.product.isDemo && <DemoBadge />}
        </Card>
      )}
      {!productId && (
        <Field label="What kind of product is it?">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category</option>
            {cats.data?.categories?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.parent_id ? '— ' : ''}
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="desc" className="text-sm font-medium">
            The problem
          </label>
          <VoiceButton onText={(t) => setDescription((d) => (d ? `${d} ${t}` : t))} />
        </div>
        <Textarea id="desc" rows={5} placeholder="e.g. My laptop turns on, but the screen stays black. The keyboard lights are working." value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {symptoms.data?.symptoms?.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            Or tap what you've noticed <span className="font-normal text-ink-muted">(optional)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {symptoms.data.symptoms.map((s: any) => (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={cx('rounded-full px-3 py-1.5 text-sm ring-1 transition', symptomIds.includes(s.id) ? 'bg-ink text-paper ring-ink' : 'bg-paper-raised ring-line hover:ring-ink/30')}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 8))} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} icon={<ImagePlus className="h-3.5 w-3.5" />}>
            Add photos or video of the problem
          </Button>
          {files.map((f, i) => (
            <Badge key={i}>
              {f.name.slice(0, 18)}
              <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>
      {matchingDevices.length > 0 && (
        <Field label="Link to one of your devices" optional hint="Keeps this diagnosis in the device's repair timeline.">
          <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Don't link</option>
            {matchingDevices.map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.nickname}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Notice tone="info">If you smell burning, see smoke, or a battery looks swollen: unplug the device, stop using it, and keep it away from anything flammable.</Notice>
      <ErrorNote error={start.error ? new Error(errorMessage(start.error)) : null} />
      <Button variant="accent" size="lg" className="w-full sm:w-auto" disabled={!categoryId || (description.trim().length < 3 && !symptomIds.length)} loading={start.isPending} onClick={() => start.mutate()} icon={<Stethoscope className="h-4 w-4" />}>
        Start diagnosis
      </Button>
    </div>
  );
}
