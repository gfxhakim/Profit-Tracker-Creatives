'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { RANGE_PRESETS } from '@/lib/dates';

const LABELS: Record<string, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get('range') ?? '7d';

  const select = (preset: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', preset);
    // Explicit dates would otherwise win over the preset just clicked.
    params.delete('since');
    params.delete('until');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-edge bg-panel p-1">
      {Object.keys(RANGE_PRESETS).map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => select(preset)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-xs font-medium transition',
            active === preset ? 'bg-accent text-white' : 'text-muted hover:text-slate-100',
          )}
        >
          {LABELS[preset]}
        </button>
      ))}
    </div>
  );
}
