import { prisma } from '@/lib/db';
import { toIsoDate, type DateRange } from '@/lib/dates';
import { fetchOrders, normalizeMdmStatus, type MdmOrder } from '@/lib/mdm';
import type { OrderStatus } from '@/lib/profit-engine';

/**
 * Reconciles MDM Express fulfilment state onto local orders.
 *
 * MDM is the source of truth for the delivery lifecycle; Shopify only tells us
 * an order exists. Matching is attempted in descending order of confidence:
 * stored MDM id, then MDM's reference field against the Shopify id / order
 * number, then the customer phone number of a still-open order.
 */

export interface MdmSyncResult {
  ordersRead: number;
  ordersMatched: number;
  ordersUpdated: number;
  unmatched: { mdmOrderId: string; reference?: string; phone?: string }[];
  range: { since: string; until: string };
}

const digitsOnly = (value: string | undefined | null) => (value ?? '').replace(/\D/g, '');

/** Local numbers are stored in mixed formats; compare on the last 9 digits. */
const phoneKey = (value: string | undefined | null) => {
  const digits = digitsOnly(value);
  return digits.length >= 9 ? digits.slice(-9) : digits;
};

function timestampsFor(status: OrderStatus, mdmOrder: MdmOrder) {
  const parse = (value?: string) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  return {
    confirmedAt: parse(mdmOrder.confirmedAt) ?? (status === 'CONFIRMED' ? new Date() : undefined),
    deliveredAt: parse(mdmOrder.deliveredAt) ?? (status === 'DELIVERED' ? new Date() : undefined),
    returnedAt: parse(mdmOrder.returnedAt) ?? (status === 'RETURNED' ? new Date() : undefined),
  };
}

export async function syncMdm(range: DateRange): Promise<MdmSyncResult> {
  const log = await prisma.syncLog.create({ data: { source: 'MDM', status: 'RUNNING' } });

  try {
    const mdmOrders = await fetchOrders({ since: toIsoDate(range.since), until: toIsoDate(range.until) });

    const localOrders = await prisma.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: range.since, lte: range.until } },
          { orderStatus: { in: ['NEW', 'CONFIRMED', 'SHIPPED'] } },
        ],
      },
      select: {
        shopifyOrderId: true,
        orderNumber: true,
        mdmOrderId: true,
        customerPhone: true,
        orderStatus: true,
      },
    });

    const byMdmId = new Map(localOrders.filter((o) => o.mdmOrderId).map((o) => [o.mdmOrderId!, o]));
    const byShopifyId = new Map(localOrders.map((o) => [o.shopifyOrderId, o]));
    const byOrderNumber = new Map(
      localOrders.filter((o) => o.orderNumber).map((o) => [o.orderNumber!.replace(/^#/, ''), o]),
    );
    const byPhone = new Map<string, (typeof localOrders)[number]>();
    for (const order of localOrders) {
      const key = phoneKey(order.customerPhone);
      // Keep the first open order for a phone number: re-orders would otherwise
      // overwrite each other and produce a wrong match.
      if (key && !byPhone.has(key)) byPhone.set(key, order);
    }

    let ordersMatched = 0;
    let ordersUpdated = 0;
    const unmatched: MdmSyncResult['unmatched'] = [];

    for (const mdmOrder of mdmOrders) {
      const reference = (mdmOrder.reference ?? '').replace(/^#/, '');
      const local =
        byMdmId.get(mdmOrder.id) ??
        byShopifyId.get(reference) ??
        byOrderNumber.get(reference) ??
        byPhone.get(phoneKey(mdmOrder.phone));

      if (!local) {
        unmatched.push({ mdmOrderId: mdmOrder.id, reference: mdmOrder.reference, phone: mdmOrder.phone });
        continue;
      }

      ordersMatched += 1;
      const status = normalizeMdmStatus(mdmOrder.status);
      const timestamps = timestampsFor(status, mdmOrder);

      const unchanged =
        local.orderStatus === status && local.mdmOrderId === mdmOrder.id;
      if (unchanged) continue;

      await prisma.order.update({
        where: { shopifyOrderId: local.shopifyOrderId },
        data: {
          mdmOrderId: mdmOrder.id,
          orderStatus: status,
          mdmStatusRaw: mdmOrder.status,
          ...(mdmOrder.city ? { customerCity: mdmOrder.city } : {}),
          ...(timestamps.confirmedAt ? { confirmedAt: timestamps.confirmedAt } : {}),
          ...(timestamps.deliveredAt ? { deliveredAt: timestamps.deliveredAt } : {}),
          ...(timestamps.returnedAt ? { returnedAt: timestamps.returnedAt } : {}),
        },
      });
      ordersUpdated += 1;
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: unmatched.length > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsRead: mdmOrders.length,
        recordsWritten: ordersUpdated,
        message: unmatched.length > 0 ? `${unmatched.length} MDM order(s) had no local match` : null,
        finishedAt: new Date(),
      },
    });

    return {
      ordersRead: mdmOrders.length,
      ordersMatched,
      ordersUpdated,
      unmatched: unmatched.slice(0, 50),
      range: { since: toIsoDate(range.since), until: toIsoDate(range.until) },
    };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
