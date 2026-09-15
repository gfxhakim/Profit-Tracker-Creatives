import clsx from 'clsx';
import type { Alert } from '@/lib/reporting';

const LEVEL_STYLES = {
  critical: 'border-loss/40 bg-loss/10',
  warning: 'border-warn/40 bg-warn/10',
  info: 'border-edge bg-ink/60',
} as const;

const LEVEL_LABEL = {
  critical: 'text-loss',
  warning: 'text-warn',
  info: 'text-muted',
} as const;

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return <p className="text-sm text-muted">Nothing needs attention right now.</p>;
  }

  return (
    <ul className="space-y-2">
      {alerts.map((alert, index) => (
        <li key={`${alert.scope}-${alert.reference ?? index}`} className={clsx('rounded-lg border px-4 py-3', LEVEL_STYLES[alert.level])}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('text-xs font-semibold uppercase tracking-wide', LEVEL_LABEL[alert.level])}>
              {alert.level}
            </span>
            <span className="text-xs text-muted">{alert.scope}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-100">{alert.title}</p>
          <p className="mt-0.5 text-sm text-muted">{alert.detail}</p>
        </li>
      ))}
    </ul>
  );
}
