import clsx from 'clsx';
import type { BreakevenStatus } from '@/lib/profit-engine';

const STYLES: Record<BreakevenStatus, { label: string; className: string }> = {
  PROFITABLE: { label: 'Profitable', className: 'bg-profit/15 text-profit border-profit/40' },
  WARNING: { label: 'Near breakeven', className: 'bg-warn/15 text-warn border-warn/40' },
  LOSS: { label: 'Below breakeven', className: 'bg-loss/15 text-loss border-loss/40' },
  NO_DATA: { label: 'No data', className: 'bg-slate-500/10 text-muted border-edge' },
};

export function StatusBadge({ status }: { status: BreakevenStatus }) {
  const style = STYLES[status];
  return (
    <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', style.className)}>
      {style.label}
    </span>
  );
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-slate-500/15 text-slate-300 border-edge',
  CONFIRMED: 'bg-accent/15 text-accent border-accent/40',
  SHIPPED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  DELIVERED: 'bg-profit/15 text-profit border-profit/40',
  CANCELLED: 'bg-slate-600/20 text-slate-400 border-edge',
  RETURNED: 'bg-loss/15 text-loss border-loss/40',
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        ORDER_STATUS_STYLES[status] ?? ORDER_STATUS_STYLES.NEW,
      )}
    >
      {status}
    </span>
  );
}
