import clsx from 'clsx';
import type { ReactNode } from 'react';

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'profit' | 'loss' | 'warn';
  footer?: ReactNode;
}

const TONES = {
  default: 'text-slate-100',
  profit: 'text-profit',
  loss: 'text-loss',
  warn: 'text-warn',
} as const;

export function KpiCard({ label, value, hint, tone = 'default', footer }: KpiCardProps) {
  return (
    <div className="panel">
      <p className="label">{label}</p>
      <p className={clsx('mt-2 text-2xl font-semibold tabular-nums', TONES[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {footer ? <div className="mt-3 border-t border-edge pt-3 text-xs text-muted">{footer}</div> : null}
    </div>
  );
}
