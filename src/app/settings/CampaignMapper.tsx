'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatMoney, formatNumber } from '@/lib/format';

interface CampaignView {
  id: string;
  name: string;
  status: string;
  dailyBudget: number;
  creativeCount: number;
  productId: string;
  productName: string;
}

export function CampaignMapper({
  campaigns,
  products,
}: {
  campaigns: CampaignView[];
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remap = async (campaignId: string, productId: string) => {
    setBusyId(campaignId);
    setError(null);

    const response = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId }),
    }).catch(() => null);

    if (!response || !response.ok) {
      const body = await response?.json().catch(() => null);
      setError(body?.error ?? 'Could not update the campaign mapping.');
    }

    setBusyId(null);
    router.refresh();
  };

  return (
    <section className="panel overflow-x-auto p-0">
      <div className="px-5 pt-5">
        <h2 className="text-sm font-semibold text-slate-100">Campaign → product mapping</h2>
        <p className="mt-1 text-sm text-muted">
          A campaign inherits its product&apos;s costs. Remap here when one campaign starts selling a different SKU.
        </p>
        {error ? <p className="mt-2 text-sm text-loss">{error}</p> : null}
      </div>

      <table className="mt-4 w-full">
        <thead>
          <tr className="border-b border-edge">
            <th className="table-head">Campaign</th>
            <th className="table-head">Status</th>
            <th className="table-head">Daily budget</th>
            <th className="table-head">Creatives</th>
            <th className="table-head">Product</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="hover:bg-ink/40">
              <td className="table-cell">
                <span className="font-medium text-slate-100">{campaign.name}</span>
                <span className="ml-2 text-xs text-muted">{campaign.id}</span>
              </td>
              <td className="table-cell text-muted">{campaign.status}</td>
              <td className="table-cell tabular-nums">{formatMoney(campaign.dailyBudget)}</td>
              <td className="table-cell tabular-nums">{formatNumber(campaign.creativeCount)}</td>
              <td className="table-cell">
                <select
                  value={campaign.productId}
                  disabled={busyId === campaign.id}
                  onChange={(event) => remap(campaign.id, event.target.value)}
                  className="input w-56"
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {campaigns.length === 0 ? (
            <tr>
              <td colSpan={5} className="table-cell text-center text-muted">
                No campaigns yet. Run a Meta sync once at least one product exists.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
