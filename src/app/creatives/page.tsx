import { resolveRange } from '@/lib/dates';
import { getCreativePerformance } from '@/lib/reporting';
import { safeLoad } from '@/lib/safe';
import { RangePicker } from '@/components/RangePicker';
import { StatusBadge } from '@/components/StatusBadge';
import { ErrorPanel, EmptyState } from '@/components/ErrorPanel';
import { formatMoney, formatNumber, formatPercent, profitClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Creative winner attribution: every ad ranked by the net profit its delivered
 * orders actually produced, with true CPD measured against the breakeven CPD of
 * the product that ad sells.
 */
export default async function CreativesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; since?: string; until?: string; status?: string }>;
}) {
  const params = await searchParams;
  const range = resolveRange({ preset: params.range, since: params.since, until: params.until });
  const loaded = await safeLoad(() => getCreativePerformance(range));

  if (!loaded.ok) {
    return <ErrorPanel title="Could not load creative performance" detail={loaded.error} />;
  }

  const rows = params.status ? loaded.data.filter((row) => row.status === params.status) : loaded.data;
  const totals = rows.reduce(
    (accumulator, row) => ({
      spend: accumulator.spend + row.spend,
      revenue: accumulator.revenue + row.revenue,
      netProfit: accumulator.netProfit + row.netProfit,
      delivered: accumulator.delivered + row.delivered,
      leads: accumulator.leads + row.leads,
    }),
    { spend: 0, revenue: 0, netProfit: 0, delivered: 0, leads: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Creative attribution</h1>
          <p className="mt-1 text-sm text-muted">
            Ranked by net profit. True CPD is ad spend divided by orders that actually reached the customer.
          </p>
        </div>
        <RangePicker />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No creatives to rank yet"
          detail="Creatives appear once a Meta sync has pulled ad-level spend and at least one order carries a matching utm_content."
        />
      ) : (
        <section className="panel overflow-x-auto p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge">
                <th className="table-head">Creative</th>
                <th className="table-head">Product</th>
                <th className="table-head">Spend</th>
                <th className="table-head">Leads</th>
                <th className="table-head">Conf.</th>
                <th className="table-head">Delivered</th>
                <th className="table-head">Revenue</th>
                <th className="table-head">Net profit</th>
                <th className="table-head">True CPD</th>
                <th className="table-head">Breakeven CPD</th>
                <th className="table-head">Headroom</th>
                <th className="table-head">ROAS</th>
                <th className="table-head">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {rows.map((row) => (
                <tr key={row.adId} className="hover:bg-ink/40">
                  <td className="table-cell">
                    <p className="max-w-[220px] truncate font-medium text-slate-100" title={row.adName}>
                      {row.adName}
                    </p>
                    <p className="max-w-[220px] truncate text-xs text-muted" title={row.campaignName}>
                      {row.campaignName}
                    </p>
                  </td>
                  <td className="table-cell text-muted">{row.productName}</td>
                  <td className="table-cell tabular-nums">{formatMoney(row.spend)}</td>
                  <td className="table-cell tabular-nums">{formatNumber(row.leads)}</td>
                  <td className="table-cell tabular-nums">{formatPercent(row.confirmationRate, 0)}</td>
                  <td className="table-cell tabular-nums">
                    {formatNumber(row.delivered)}
                    {row.pending > 0 ? <span className="ml-1 text-xs text-muted">+{row.pending} pending</span> : null}
                  </td>
                  <td className="table-cell tabular-nums">{formatMoney(row.revenue)}</td>
                  <td className={`table-cell font-semibold tabular-nums ${profitClass(row.netProfit)}`}>
                    {formatMoney(row.netProfit)}
                  </td>
                  <td className="table-cell tabular-nums">{formatMoney(row.trueCostPerDelivered)}</td>
                  <td className="table-cell tabular-nums text-muted">{formatMoney(row.breakevenCpd)}</td>
                  <td className={`table-cell tabular-nums ${profitClass(row.headroomPercent)}`}>
                    {formatPercent(row.headroomPercent, 0)}
                  </td>
                  <td className="table-cell tabular-nums">{row.roas.toFixed(2)}x</td>
                  <td className="table-cell"><StatusBadge status={row.status} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-edge bg-ink/40">
                <td className="table-cell font-semibold text-slate-100" colSpan={2}>
                  {rows.length} creative{rows.length === 1 ? '' : 's'}
                </td>
                <td className="table-cell font-semibold tabular-nums">{formatMoney(totals.spend)}</td>
                <td className="table-cell font-semibold tabular-nums">{formatNumber(totals.leads)}</td>
                <td className="table-cell" />
                <td className="table-cell font-semibold tabular-nums">{formatNumber(totals.delivered)}</td>
                <td className="table-cell font-semibold tabular-nums">{formatMoney(totals.revenue)}</td>
                <td className={`table-cell font-semibold tabular-nums ${profitClass(totals.netProfit)}`}>
                  {formatMoney(totals.netProfit)}
                </td>
                <td className="table-cell font-semibold tabular-nums">
                  {formatMoney(totals.delivered > 0 ? totals.spend / totals.delivered : 0)}
                </td>
                <td className="table-cell" colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  );
}
