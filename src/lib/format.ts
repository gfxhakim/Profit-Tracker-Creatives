/** Display formatting shared by every table and card. */

export function formatMoney(value: number, currencyCode = process.env.NEXT_PUBLIC_CURRENCY ?? 'MAD'): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} ${currencyCode}`;
}

export function formatCompactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export const formatPercent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

export const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);

export function formatDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const profitClass = (value: number) =>
  value > 0 ? 'text-profit' : value < 0 ? 'text-loss' : 'text-slate-300';
