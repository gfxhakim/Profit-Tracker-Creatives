import { prisma } from '@/lib/db';
import { resolveRange } from '@/lib/dates';
import { safeLoad } from '@/lib/safe';
import { ErrorPanel } from '@/components/ErrorPanel';
import { RangePicker } from '@/components/RangePicker';
import { OrderStatusBadge } from '@/components/StatusBadge';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ORDER_STATUSES } from '@/lib/profit-engine';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; since?: string; until?: string; status?: string }>;
}) {
  const params = await searchParams;
  const range = resolveRange({ preset: params.range, since: params.since, until: params.until });
  const status = params.status && ORDER_STATUSES.includes(params.status as never) ? params.status : undefined;

  const loaded = await safeLoad(() =>
    prisma.order.findMany({
      where: {
        createdAt: { gte: range.since, lte: range.until },
        ...(status ? { orderStatus: status } : {}),
      },
      include: {
        product: { select: { name: true, sku: true } },
        adCreative: { select: { adName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  );

  if (!loaded.ok) return <ErrorPanel title="Could not load orders" detail={loaded.error} />;

  const orders = loaded.data;
  const unattributed = orders.filter((order) => order.adId === null).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Orders</h1>
          <p className="mt-1 text-sm text-muted">
            Shopify creates the order, MDM Express owns its delivery status. {orders.length} shown
            {unattributed > 0 ? ` · ${unattributed} without creative attribution` : ''}.
          </p>
        </div>
        <RangePicker />
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-edge">
              <th className="table-head">Order</th>
              <th className="table-head">Created</th>
              <th className="table-head">Product</th>
              <th className="table-head">Creative</th>
              <th className="table-head">utm_content</th>
              <th className="table-head">Qty</th>
              <th className="table-head">Amount</th>
              <th className="table-head">MDM id</th>
              <th className="table-head">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {orders.map((order) => (
              <tr key={order.shopifyOrderId} className="hover:bg-ink/40">
                <td className="table-cell">
                  <span className="font-medium text-slate-100">{order.orderNumber ?? order.shopifyOrderId}</span>
                  {order.customerCity ? <span className="ml-2 text-xs text-muted">{order.customerCity}</span> : null}
                </td>
                <td className="table-cell text-muted">{formatDateTime(order.createdAt)}</td>
                <td className="table-cell">{order.product.name}</td>
                <td className="table-cell">
                  {order.adCreative ? (
                    <span className="max-w-[200px] truncate" title={order.adCreative.adName}>
                      {order.adCreative.adName}
                    </span>
                  ) : (
                    <span className="text-xs text-warn">Unattributed</span>
                  )}
                </td>
                <td className="table-cell text-xs text-muted">{order.utmContent ?? '—'}</td>
                <td className="table-cell tabular-nums">{order.quantity}</td>
                <td className="table-cell tabular-nums">{formatMoney(order.saleAmount)}</td>
                <td className="table-cell text-xs text-muted">{order.mdmOrderId ?? '—'}</td>
                <td className="table-cell"><OrderStatusBadge status={order.orderStatus} /></td>
              </tr>
            ))}
            {orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell text-center text-muted">
                  No orders in this window. Confirm the Shopify webhook is registered against
                  /api/webhooks/shopify.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
