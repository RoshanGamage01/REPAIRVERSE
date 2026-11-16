import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, Check, FileVideo, ImagePlus, Loader2, ScanLine, Search, Sparkles, Type, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { pct } from '../../lib/format';
import { Badge, Button, Card, ConfidenceMeter, cx, DemoBadge, Dialog, EmptyState, ErrorNote, Field, Input, Notice, PageHeader, Select, Spinner, Textarea, useToast } from '../../ui';

export interface Candidate {
  productId: string;
  slug: string;
  name: string;
  modelNumber: string | null;
  category: string;
  isDemo: boolean;
  confidence: number;
  matchedBy: string[];
  variantId?: string | null;
  variantName?: string | null;
}

interface Attached {
  file: File;
  preview: string | null;
  kind: 'image' | 'video';
}

/** Live barcode scanning using the browser BarcodeDetector API when available. */
function BarcodeScanner({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  useEffect(() => {
    if (!open || !supported) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128'] });
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]?.rawValue) {
              onDetected(codes[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError('Camera unavailable. Check permissions or enter the code manually.');
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, supported, onDetected]);
  return (
    <Dialog open={open} onClose={onClose} title="Scan barcode or QR code">
      {!supported ? (
        <Notice tone="warn" title="Live scanning isn't supported in this browser">
          Type the number printed under the barcode instead.
        </Notice>
      ) : (
        <div className="relative overflow-hidden rounded-2xl bg-ink">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-accent shadow-[0_0_12px_rgb(var(--accent))]" />
        </div>
      )}
      {error && <ErrorNote error={new Error(error)} />}
    </Dialog>
  );
}

/** The primary repair entry point: capture or describe the object. */
export function CaptureEntry({ compact }: { compact?: boolean }) {
  const nav = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [barcode, setBarcode] = useState('');
  const [more, setMore] = useState(false);
  const [scanning, setScanning] = useState(false);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next: Attached[] = [];
    for (const f of Array.from(list)) {
      const kind = f.type.startsWith('video') ? 'video' : 'image';
      if (kind === 'video' && f.size > 50 * 1024 * 1024) {
        toast('Videos must be under 50 MB', 'danger');
        continue;
      }
      next.push({ file: f, preview: kind === 'image' ? URL.createObjectURL(f) : null, kind });
    }
    setFiles((cur) => [...cur, ...next].slice(0, 8));
  };

  const go = () => {
    if (!files.length && !text.trim() && !modelNumber.trim() && !barcode.trim()) {
      toast('Add a photo, a description, a model number or a barcode', 'info');
      return;
    }
    nav('/identify', { state: { files: files.map((f) => f.file), text, modelNumber, barcode } });
  };

  return (
    <div className={cx('surface overflow-hidden shadow-lift', compact ? 'p-4' : 'p-5 sm:p-7')}>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => add(e.target.files)} />
      <input ref={fileInput} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <button
          onClick={() => cameraInput.current?.click()}
          className="group relative flex min-h-[148px] flex-col items-start justify-between overflow-hidden rounded-2xl bg-ink p-5 text-left text-paper transition hover:shadow-lift"
        >
          <span className="absolute -right-6 -top-6 h-32 w-32 rounded-full border-[10px] border-accent/90 transition group-hover:scale-110" />
          <span className="absolute -right-6 -top-6 h-32 w-32 animate-ring rounded-full border-2 border-accent/60" />
          <Camera className="relative h-7 w-7" />
          <span className="relative">
            <span className="block text-lg font-semibold">Point your camera at it</span>
            <span className="text-sm text-paper/60">Photograph the object or its rating label</span>
          </span>
        </button>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
          <button onClick={() => fileInput.current?.click()} className="flex items-center gap-3 rounded-2xl bg-paper-sunken p-4 text-left text-sm font-medium transition hover:bg-ink/10">
            <ImagePlus className="h-5 w-5 shrink-0" /> Upload photos or a short video
          </button>
          <button onClick={() => setScanning(true)} className="flex items-center gap-3 rounded-2xl bg-paper-sunken p-4 text-left text-sm font-medium transition hover:bg-ink/10">
            <ScanLine className="h-5 w-5 shrink-0" /> Scan a barcode or QR code
          </button>
        </div>
      </div>

      {files.length > 0 && (
        <div className="scroll-x mt-4">
          {files.map((f, i) => (
            <div key={i} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-paper-sunken ring-1 ring-line">
              {f.preview ? <img src={f.preview} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><FileVideo className="h-6 w-6 text-ink-muted" /></div>}
              <button onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-ink/70 p-0.5 text-paper" aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="relative">
          <Type className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
          <Input className="pl-10" placeholder="Or describe it — e.g. “14-inch laptop that won’t show a picture”" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
        {(more || barcode) && (
          <div className="grid animate-fade-up gap-3 sm:grid-cols-2">
            <Input placeholder="Model number (from the label)" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
            <Input placeholder="Barcode / GTIN" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!more && !barcode ? (
            <button className="text-sm font-medium text-ink-muted hover:text-ink" onClick={() => setMore(true)}>
              I know the model number
            </button>
          ) : (
            <span />
          )}
          <Button variant="accent" size="lg" onClick={go} icon={<Sparkles className="h-4 w-4" />}>
            Identify it
          </Button>
        </div>
      </div>
      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(code) => {
          setScanning(false);
          setBarcode(code);
          toast(`Scanned ${code}`);
        }}
      />
    </div>
  );
}

function CorrectionDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: any) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({ queryKey: ['product-search', q], queryFn: () => api.get(`/products${qs({ q, limit: 12 })}`), enabled: q.trim().length > 1 });
  return (
    <Dialog open={open} onClose={onClose} title="Choose the correct product">
      <div className="relative">
        <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-ink-faint" />
        <Input autoFocus className="pl-10" placeholder="Search by name or model number" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isFetching && <Spinner />}
      <div className="divide-y divide-line">
        {data?.products?.map((p: any) => (
          <button key={p.id} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-ink/[.02]" onClick={() => onPick(p)}>
            <div>
              <div className="font-medium">
                {p.brand_name} {p.name} <span className="text-ink-muted">{p.model_number}</span>
              </div>
              <div className="text-xs text-ink-muted">{p.category_name}</div>
            </div>
            {p.is_demo && <DemoBadge />}
          </button>
        ))}
        {data && !data.products.length && <p className="py-4 text-sm text-ink-muted">No products found. You can continue with just the category, or register the product in your Devices.</p>}
      </div>
      <p className="text-xs text-ink-muted">Your correction is stored as structured knowledge so future identifications improve.</p>
    </Dialog>
  );
}

export default function IdentifyPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const location = useLocation();
  const initial = (location.state ?? {}) as { files?: File[]; text?: string; modelNumber?: string; barcode?: string };
  const [result, setResult] = useState<any>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [variantId, setVariantId] = useState<string>('');
  const [correcting, setCorrecting] = useState(false);
  const [saveDevice, setSaveDevice] = useState(true);
  const started = useRef(false);

  const identify = useMutation({
    mutationFn: async (input: typeof initial) => {
      let fileIds: string[] = [];
      if (input.files?.length) {
        const up = await api.upload(input.files, 'identification');
        fileIds = up.files.map((f: any) => f.id);
      }
      return api.post('/identifications', { text: input.text || undefined, modelNumber: input.modelNumber || undefined, barcode: input.barcode || undefined, fileIds });
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.candidates?.[0]) setSelected(r.candidates[0]);
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial.files?.length || initial.text || initial.modelNumber || initial.barcode) identify.mutate(initial);
    else if (params.get('q')) identify.mutate({ text: params.get('q')! });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const product = useQuery({ queryKey: ['product', selected?.productId], queryFn: () => api.get(`/products/${selected!.productId}`), enabled: !!selected });
  useEffect(() => {
    if (selected?.variantId) setVariantId(selected.variantId);
    else setVariantId('');
  }, [selected]);

  const confirm = useMutation({
    mutationFn: async () => {
      const r = await api.post(`/identifications/${result.id}/confirm`, { productId: selected!.productId, variantId: variantId || null });
      let deviceId: string | null = null;
      if (saveDevice) {
        const d = await api.post('/library/devices', { productId: selected!.productId, variantId: variantId || null, nickname: `${selected!.name}${selected!.modelNumber ? ` ${selected!.modelNumber}` : ''}` });
        deviceId = d.id;
      }
      return { ...r, deviceId };
    },
    onSuccess: (r) => {
      toast(r.corrected ? 'Thanks — your correction improves future identifications' : 'Product confirmed');
      nav(`/diagnose/new${qs({ productId: selected!.productId, variantId: variantId || undefined, deviceId: r.deviceId ?? undefined })}`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (!result && !identify.isPending && !identify.isError) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader eyebrow="Step 1 of 3 · Identify" title="What are we looking at?" description="Photos, a label, a barcode, the model number or a short description — any of these helps." />
        <CaptureEntry />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Step 1 of 3 · Identify" title={identify.isPending ? 'Looking closely…' : result?.status === 'candidates' ? 'Is this it?' : 'Help us narrow it down'} />
      {identify.isPending && (
        <Card className="flex items-center gap-4">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <div>
            <div className="font-medium">Matching against the knowledge network</div>
            <div className="text-sm text-ink-muted">Checking identifiers, model numbers, confirmed corrections{initial.files?.length ? ' and your photos' : ''}.</div>
          </div>
        </Card>
      )}
      <ErrorNote error={identify.error ? new Error(errorMessage(identify.error)) : null} />

      {result && (
        <>
          {result.candidates.length > 0 ? (
            <div className="space-y-3">
              {result.candidates.map((c: Candidate) => (
                <button
                  key={c.productId}
                  onClick={() => setSelected(c)}
                  className={cx('surface w-full p-5 text-left transition', selected?.productId === c.productId ? 'ring-2 ring-ink' : 'hover:ring-ink/30')}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold">{c.name}</span>
                        {c.modelNumber && <span className="font-mono text-sm text-ink-muted">{c.modelNumber}</span>}
                        {c.isDemo && <DemoBadge />}
                      </div>
                      <div className="text-sm text-ink-muted">{c.category}{c.variantName ? ` · ${c.variantName}` : ''}</div>
                    </div>
                    {selected?.productId === c.productId && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-paper">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-4 max-w-sm">
                    <ConfidenceMeter value={c.confidence} label="Identification confidence" compact />
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                    {c.matchedBy.map((m) => (
                      <li key={m}>• {m}</li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Search className="h-8 w-8" />} title="No confident match yet" description="We won't guess. Add more detail below, or continue with just the product category." />
          )}

          {result.ai?.status === 'used' && (
            <Card className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-signal" /> What the photo analysis observed <Badge tone="signal">AI · unconfirmed</Badge>
              </div>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                {result.ai.visible_components?.length > 0 && (
                  <div>
                    <div className="eyebrow mb-1">Visible components</div>
                    {result.ai.visible_components.join(', ')}
                  </div>
                )}
                <div>
                  <div className="eyebrow mb-1">Physical condition</div>
                  {result.ai.physical_condition}
                </div>
                {result.ai.possible_damage?.length > 0 && (
                  <div>
                    <div className="eyebrow mb-1">Possible damage</div>
                    {result.ai.possible_damage.join(', ')}
                  </div>
                )}
                {result.ai.label_text?.length > 0 && (
                  <div>
                    <div className="eyebrow mb-1">Label text read</div>
                    <span className="font-mono text-xs">{result.ai.label_text.join(' · ')}</span>
                  </div>
                )}
              </div>
              <div className="text-xs text-ink-muted">Overall photo confidence: {pct(result.ai.confidence)}</div>
            </Card>
          )}
          {result.observations?.map((o: string) => (
            <Notice key={o} tone="info">
              {o}
            </Notice>
          ))}
          {result.needs?.length > 0 && (
            <Notice tone="warn" title="To identify it with confidence:">
              <ul className="mt-1 space-y-0.5">
                {result.needs.map((n: string) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            </Notice>
          )}

          {selected && product.data && (
            <Card className="space-y-4">
              {product.data.variants.length > 0 && (
                <Field label="Which variant?" hint="Variants can use different parts. Check the label if unsure.">
                  <Select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                    <option value="">Not sure</option>
                    {product.data.variants.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.notes ? `— ${v.notes}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={saveDevice} onChange={(e) => setSaveDevice(e.target.checked)} className="accent-ink" /> Save to My Devices
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="accent" size="lg" loading={confirm.isPending} onClick={() => confirm.mutate()} icon={<Check className="h-4 w-4" />}>
                  Yes, that's it
                </Button>
                <Button variant="secondary" size="lg" onClick={() => setCorrecting(true)}>
                  No, it's something else
                </Button>
              </div>
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5 text-sm">
            {!selected && (
              <Button variant="secondary" onClick={() => setCorrecting(true)} icon={<Search className="h-4 w-4" />}>
                Search for the product
              </Button>
            )}
            {result.categoryHint && (
              <Link className="link" to={`/diagnose/new${qs({ categoryId: result.categoryHint.id })}`}>
                Continue as “{result.categoryHint.name}” without the exact model <ArrowRight className="inline h-3.5 w-3.5" />
              </Link>
            )}
            <button className="text-ink-muted hover:text-ink" onClick={() => setResult(null)}>
              Start over
            </button>
          </div>
        </>
      )}
      <CorrectionDialog
        open={correcting}
        onClose={() => setCorrecting(false)}
        onPick={(p) => {
          setCorrecting(false);
          setSelected({ productId: p.id, slug: p.slug, name: p.name, modelNumber: p.model_number, category: p.category_name, isDemo: p.is_demo, confidence: 1, matchedBy: ['Selected by you'] });
        }}
      />
      {!result && identify.isError && (
        <Button variant="secondary" onClick={() => identify.mutate(initial)}>
          Try again
        </Button>
      )}
    </div>
  );
}

