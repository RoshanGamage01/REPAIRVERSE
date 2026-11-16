export const money = (cents: number | null | undefined, currency = 'USD') =>
  cents == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);

export const pct = (p: number | null | undefined, digits = 0) => (p == null ? '—' : `${(p * 100).toFixed(digits)}%`);

export const date = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export function relative(d: string | Date | null | undefined) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return date(d);
}

export const toCents = (v: string) => {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
