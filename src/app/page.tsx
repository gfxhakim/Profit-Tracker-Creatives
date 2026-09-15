import { resolveRange } from '@/lib/dates';
import { getDashboard } from '@/lib/reporting';
import { safeLoad } from '@/lib/safe';
import { KpiCard } from '@/components/KpiCard';
import { RangePicker } from '@/components/RangePicker';
import { ProfitChart } from '@/components/ProfitChart';
import { StatusBadge } from '@/components/StatusBadge';
import { ErrorPanel, EmptyState } from '@/components/ErrorPanel';
import { AlertList } from '@/components/AlertList';
import { formatMoney, formatNumber, formatPercent, profitClass } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; since?: string; until?: string }>;
}) {
  const params = await searchParams;
  const range = resolveRange({ preset: params.range, since: params.since, until: params.until });
  const loaded = await safeLoad(() => getDashboard(range));

  if (!loaded.ok) {
    return (
      <ErrorPanel
        title="Could not load dashboard data"
        detail={`${loaded.error}\n\nCheck that DATABASE_URL points at a reachable Postgres instance and that migrations have been applied (npm run prisma:deploy).`}
      />
    );
  }

  const { totals, series, alerts, winners, losers, products, projection, breakevenCpd } = loaded.data;
  const hasActivity = totals.counts.total > 0 || totals.costs.adSpend > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Profit dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {loaded.data.range.since} → {loaded.data.range.until} · {loaded.data.range.days} day
            {loaded.data.range.days > 1 ? 's' : ''}
          </p>
        </div>
        <RangePicker />
      </div>

      {!hasActivity ? (
        <EmptyState
          title="No spend or orders in this window"
          detail="Run a Meta sync from Settings to pull ad spend, point your Shopify order webhook at /api/webhooks/shopify, then run an MDM sync to reconcile delivery status."
        />
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Net profit"
          value={formatMoney(totals.netProfit)}
          tone={totals.netProfit > 0 ? 'profit' : totals.netProfit < 0 ? 'loss' : 'default'}
          hint={`${formatPercent(totals.margins.netMarginPercent)} net margin on collected revenue`}
          footer={
            <span>
              Projected with pending orders:{' '}
              <span className={profitClass(projection.projectedNetProfit)}>
                {formatMoney(projection.projectedNetProfit)}
              </span>
            </span>
          }
        />
        <KpiCard
          label="True cost per delivered order"
          value={formatMoney(totals.perOrder.trueCostPerDelivered)}
          tone={totals.status === 'PROFITABLE' ? 'profit' : totals.status === 'WARNING' ? 'warn' : 'loss'}
          hint={`Breakeven CPD ${formatMoney(breakevenCpd)}`}
          footer={<StatusBadge status={totals.status} />}
        />
        <KpiCard
          label="Collected revenue"
          value={formatMoney(totals.revenue)}
          hint={`${formatNumber(totals.counts.delivered)} delivered · AOV ${formatMoney(totals.perOrder.aov)}`}
          footer={<span>ROAS {totals.roas.toFixed(2)}x · breakeven {totals.breakeven.roas.toFixed(2)}x</span>}
        />
        <KpiCard
          label="Ad spend"
          value={formatMoney(totals.costs.adSpend)}
          hint={`CPL ${formatMoney(totals.perOrder.costPerLead)} across ${formatNumber(totals.counts.total)} leads`}
          footer={<span>Operating expenses {formatMoney(totals.costs.operationalExpenses)}</span>}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Confirmation rate" value={formatPercent(totals.rates.confirmationRate)} hint={`${formatNumber(totals.counts.confirmedCumulative)} of ${formatNumber(totals.counts.total)} leads`} />
        <KpiCard label="Delivery rate" value={formatPercent(totals.rates.deliveryRateOnConfirmed)} hint="Of confirmed orders" />
        <KpiCard label="Return rate" value={formatPercent(totals.rates.returnRate)} tone={totals.rates.returnRate > 20 ? 'warn' : 'default'} hint={`${formatNumber(totals.counts.returned)} returned`} />
        <KpiCard label="In flight" value={formatNumber(totals.counts.pending)} hint={`${projection.projectedDeliveries} projected deliveries at ${formatPercent(projection.observedDeliveryRate, 0)}`} />
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-100">Spend, revenue and profit by day</h2>
        <div className="mt-4">
          <ProfitChart data={series} />
        </div>
      </section>

      {alerts.length > 0 ? (
        <section className="panel">
          <h2 className="text-sm font-semibold text-slate-100">Breakeven &amp; inventory alerts</h2>
          <div className="mt-4">
            <AlertList alerts={alerts} />
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <CreativeList title="Winning creatives" subtitle="Scale these" rows={winners} empty="No creative is clearly profitable in this window yet." />
        <CreativeList title="Losing creatives" subtitle="Cut or fix these" rows={losers} empty="Nothing is below breakeven. Good." />
      </section>

      <section className="panel overflow-x-auto">
        <h2 className="text-sm font-semibold text-slate-100">Product economics</h2>
        <table className="mt-4 w-full">
          <thead>
            <tr className="border-b border-edge">
              <th className="table-head">Product</th>
              <th className="table-head">Spend</th>
              <th className="table-head">Revenue</th>
              <th className="table-head">Net profit</th>
              <th className="table-head">True CPD</th>
              <th className="table-head">Breakeven CPD</th>
              <th className="table-head">Delivery</th>
              <th className="table-head">Stock left</th>
              <th className="table-head">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {products.map((product) => (
              <tr key={product.productId} className="hover:bg-ink/40">
                <td className="table-cell">
                  <span className="font-medium text-slate-100">{product.name}</span>
                  <span className="ml-2 text-xs text-muted">{product.sku}</span>
                </td>
                <td className="table-cell tabular-nums">{formatMoney(product.spend)}</td>
                <td className="table-cell tabular-nums">{formatMoney(product.revenue)}</td>
                <td className={`table-cell tabular-nums ${profitClass(product.netProfit)}`}>{formatMoney(product.netProfit)}</td>
                <td className="table-cell tabular-nums">{formatMoney(product.trueCostPerDelivered)}</td>
                <td className="table-cell tabular-nums text-muted">{formatMoney(product.breakevenCpd)}</td>
                <td className="table-cell tabular-nums">{formatPercent(product.deliveryRate, 0)}</td>
                <td className="table-cell tabular-nums">
                  <span className={product.inventory.needsReorder ? 'text-loss' : ''}>
                    {formatNumber(product.inventory.unitsRemaining)}
                  </span>
                  {product.inventory.daysOfStockLeft !== null ? (
                    <span className="ml-1 text-xs text-muted">({product.inventory.daysOfStockLeft}d)</span>
                  ) : null}
                </td>
                <td className="table-cell"><StatusBadge status={product.status} /></td>
              </tr>
            ))}
            {products.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell text-center text-muted">
                  No products yet. Add one under Products to unlock unit economics.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function CreativeList({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: { adId: string; adName: string; netProfit: number; trueCostPerDelivered: number; breakevenCpd: number; delivered: number; spend: number }[];
  empty: string;
}) {
  return (
    <div className="panel">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <span className="text-xs text-muted">{subtitle}</span>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.adId} className="flex items-center justify-between gap-4 border-b border-edge pb-3 last:border-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-100">{row.adName}</p>
              <p className="text-xs text-muted">
                {formatMoney(row.spend)} spent · {row.delivered} delivered · CPD {formatMoney(row.trueCostPerDelivered)} vs {formatMoney(row.breakevenCpd)}
              </p>
            </div>
            <span className={`shrink-0 text-sm font-semibold tabular-nums ${profitClass(row.netProfit)}`}>
              {formatMoney(row.netProfit)}
            </span>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-muted">{empty}</li> : null}
      </ul>
    </div>
  );
}
