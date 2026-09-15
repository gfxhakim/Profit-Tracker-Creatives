import { z } from 'zod';
import { prisma } from '@/lib/db';
import { resolveRange } from '@/lib/dates';
import { handleError, ok } from '@/lib/api';
import { ORDER_STATUSES } from '@/lib/profit-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = resolveRange({
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
      preset: url.searchParams.get('range'),
    });
    const status = url.searchParams.get('status');
    const take = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 500);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: range.since, lte: range.until },
        ...(status && ORDER_STATUSES.includes(status as never) ? { orderStatus: status } : {}),
      },
      include: {
        product: { select: { name: true, sku: true } },
        adCreative: { select: { adName: true, campaignId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return ok({ range, orders, count: orders.length });
  } catch (error) {
    return handleError(error);
  }
}

const patchSchema = z.object({
  shopifyOrderId: z.string().min(1),
  orderStatus: z.enum(ORDER_STATUSES),
  adId: z.string().nullable().optional(),
});

/** Manual override for orders MDM could not match or attribute. */
export async function PATCH(request: Request) {
  try {
    const { shopifyOrderId, orderStatus, adId } = patchSchema.parse(await request.json());
    const order = await prisma.order.update({
      where: { shopifyOrderId },
      data: {
        orderStatus,
        ...(adId !== undefined ? { adId } : {}),
        ...(orderStatus === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
        ...(orderStatus === 'RETURNED' ? { returnedAt: new Date() } : {}),
        ...(orderStatus === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
      },
    });
    return ok({ order });
  } catch (error) {
    return handleError(error);
  }
}
