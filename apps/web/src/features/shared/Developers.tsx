import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, ExternalLink } from 'lucide-react';
import { API_SCOPES } from '@repairverse/shared';
import { api, errorMessage } from '../../lib/api';
import { relative } from '../../lib/format';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorNote, Field, Input, Notice, PageHeader, Section, useToast } from '../../ui';

const scopeHelp: Record<string, string> = {
  'products:read': 'Product profiles and component breakdowns',
  'knowledge:read': 'Failure patterns, procedures and verified knowledge feed',
  'compatibility:read': 'Part compatibility checks with evidence',
  'diagnosis:write': 'Start and answer diagnoses',
  'outcomes:write': 'Submit repair outcomes (enter moderation)',
  'identify:write': 'Identify products by barcode or model number',
};

export default function DevelopersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['products:read', 'knowledge:read']);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const clients = useQuery({ queryKey: ['api-clients'], queryFn: () => api.get('/developer/clients') });
  const create = useMutation({
    mutationFn: () => api.post('/developer/clients', { name, scopes }),
    onSuccess: (r) => {
      setNewKey(r.apiKey);
      setName('');
      qc.invalidateQueries({ queryKey: ['api-clients'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/developer/clients/${id}/revoke`),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['api-clients'] }), toast('Key revoked')),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Repair Intelligence API"
        title="Developers"
        description="Integrate REPAIRVERSE product intelligence, failure knowledge, compatibility and diagnosis into your own systems."
        actions={
          <a href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
            <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
              OpenAPI spec
            </Button>
          </a>
        }
      />
      <Notice tone="info" title="Trust model">
        Responses carry provenance and verification status. Diagnoses are ranked hypotheses. High-risk procedure steps are withheld. Rows marked is_demo are demonstration data.
      </Notice>
      <Section title="Create an API key">
        <Card className="space-y-4">
          <Field label="Key name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shop management integration" />
          </Field>
          <div className="space-y-2">
            <div className="text-sm font-medium">Scopes</div>
            {API_SCOPES.map((s) => (
              <Checkbox key={s} label={<span className="font-mono text-xs">{s}</span>} description={scopeHelp[s]} checked={scopes.includes(s)} onChange={(v) => setScopes((x) => (v ? [...x, s] : x.filter((y) => y !== s)))} />
            ))}
          </div>
          <ErrorNote error={create.error ? new Error(errorMessage(create.error)) : null} />
          <Button loading={create.isPending} disabled={!name || !scopes.length} onClick={() => create.mutate()} icon={<KeyRound className="h-4 w-4" />}>
            Create key
          </Button>
        </Card>
        {newKey && (
          <div className="space-y-2 rounded-2xl bg-ink p-5 text-paper">
            <div className="text-sm font-semibold">Your new API key — copy it now. It won't be shown again.</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-paper/10 px-3 py-2 font-mono text-xs">{newKey}</code>
              <Button
                variant="accent"
                size="sm"
                icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                onClick={async () => {
                  await navigator.clipboard?.writeText(newKey);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Your keys">
        {clients.data?.clients?.length ? (
          <div className="space-y-2">
            {clients.data.clients.map((c: any) => (
              <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status}</Badge>
                  </div>
                  <div className="font-mono text-xs text-ink-muted">{c.key_prefix}_••••</div>
                  <div className="text-xs text-ink-muted">
                    {c.month_requests.toLocaleString()} / {c.monthly_quota.toLocaleString()} requests this month · {c.rate_limit_per_minute}/min · last used {c.last_used_at ? relative(c.last_used_at) : 'never'}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.scopes.map((s: string) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </div>
                </div>
                {c.status === 'active' && (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => confirm('Revoke this key? Integrations using it will stop working.') && revoke.mutate(c.id)}>
                    Revoke
                  </Button>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={<KeyRound className="h-8 w-8" />} title="No API keys yet" />
        )}
      </Section>
      <Section title="Quick start">
        <pre className="overflow-x-auto rounded-2xl bg-ink p-5 text-xs leading-relaxed text-paper">
{`curl -H "X-API-Key: $REPAIRVERSE_KEY" \\
  ${origin}/api/public/v1/products?q=aurora

curl -H "X-API-Key: $REPAIRVERSE_KEY" \\
  "${origin}/api/public/v1/compatibility?partId=…&productId=…"`}
        </pre>
      </Section>
    </div>
  );
}
