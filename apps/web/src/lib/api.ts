/** Typed fetch wrapper for the REPAIRVERSE API. Cookie session + anti-CSRF header. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: { 'X-Requested-With': 'repairverse', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (data as any)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, body?: unknown) => request<T>('POST', p, body ?? {}),
  put: <T = any>(p: string, body?: unknown) => request<T>('PUT', p, body ?? {}),
  patch: <T = any>(p: string, body?: unknown) => request<T>('PATCH', p, body ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(files: File[], purpose = 'general') => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('purpose', purpose);
    return request<T>('POST', '/files', fd);
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const fieldErrors = (e.details as any)?.fieldErrors;
    if (fieldErrors) {
      const first = Object.entries(fieldErrors)[0] as [string, string[]] | undefined;
      if (first) return `${first[0]}: ${first[1][0]}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
