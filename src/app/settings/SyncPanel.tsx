'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface SyncOutcome {
  source: string;
  ok: boolean;
  summary: string;
}

export function SyncPanel() {
  const router = useRouter();
  const [range, setRange] = useState('7d');
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const run = async (source: 'meta' | 'mdm') => {
    setBusy(source);
    setOutcome(null);

    const response = await fetch(`/api/sync/${source}?range=${range}`, { method: 'POST' }).catch(() => null);
    const body = await response?.json().catch(() => null);

    if (!response || !response.ok) {
      setOutcome({
        source,
        ok: false,
        summary: body?.error ?? 'Request failed. Check credentials and network access.',
      });
      setBusy(null);
      return;
    }

    setOutcome({
      source,
      ok: true,
      summary:
        source === 'meta'
          ? `${body.campaignsSynced} campaigns, ${body.creativesSynced} creatives, ${body.insightRowsSynced} insight rows, ${body.spendTotal} spend.${
              body.unmappedCampaigns?.length ? ` ${body.unmappedCampaigns.length} campaign(s) still need a product.` : ''
            }`
          : `${body.ordersRead} MDM orders read, ${body.ordersMatched} matched, ${body.ordersUpdated} updated.${
              body.unmatched?.length ? ` ${body.unmatched.length} unmatched.` : ''
            }${
              body.unmappedStatuses?.length
                ? ` Unmapped status(es) treated as NEW: ${body.unmappedStatuses.join(', ')} - these need adding to STATUS_MAP.`
                : ''
            }`,
    });
    setBusy(null);
    router.refresh();
  };

  return (
    <section className="panel">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Manual sync</h2>
          <p className="mt-1 text-sm text-muted">
            Meta pulls day-level ad spend; MDM reconciles delivery status onto existing orders.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="sync-range">Window</label>
            <select
              id="sync-range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              className="input mt-1 w-40"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="14d">Last 14 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </div>
          <button type="button" onClick={() => run('meta')} disabled={busy !== null} className="btn-primary">
            {busy === 'meta' ? 'Syncing Meta…' : 'Sync Meta spend'}
          </button>
          <button type="button" onClick={() => run('mdm')} disabled={busy !== null} className="btn-ghost">
            {busy === 'mdm' ? 'Syncing MDM…' : 'Sync MDM status'}
          </button>
        </div>
      </div>

      {outcome ? (
        <p className={`mt-4 text-sm ${outcome.ok ? 'text-profit' : 'text-loss'}`}>
          <span className="font-medium uppercase">{outcome.source}</span> — {outcome.summary}
        </p>
      ) : null}
    </section>
  );
}
