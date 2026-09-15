import { prisma } from '@/lib/db';
import {
  extractAttribution,
  initialStatusFromShopify,
  orderCity,
  orderPhone,
  orderSaleAmount,
  primaryLineItem,
  totalQuantity,
  type ShopifyOrderPayload,
} from '@/lib/shopify';

/**
 * Turns a Shopify order webhook into a local order row, attributing it to the
 * Meta creative that produced it.
 */

export interface IngestResult {
  status: 'created' | 'updated' | 'skipped';
  shopifyOrderId: string;
  productId?: string;
  adId?: string | null;
  reason?: string;
}

/**
 * Attribution: `utm_content` is matched against stored creatives first by tag,
 * then by ad id, since Meta's default tag is the ad id itself.
 */
async function resolveAdId(utmContent: string | undefined): Promise<string | null> {
  if (!utmContent) return null;

  const byTag = await prisma.adCreative.findUnique({ where: { utmContent } });
  if (byTag) return byTag.adId;

  if (/^\d+$/.test(utmContent)) {
    const byAdId = await prisma.adCreative.findUnique({ where: { adId: utmContent } });
    if (byAdId) return byAdId.adId;
  }

  return null;
}

/**
 * Product resolution: SKU from the largest line item, then the product a
 * matched creative's campaign sells, then the only product in a single-product
 * store. An order we cannot book against a product has no economics, so it is
 * skipped rather than stored with wrong numbers.
 */
async function resolveProductId(order: ShopifyOrderPayload, adId: string | null): Promise<string | null> {
  const sku = primaryLineItem(order)?.sku?.trim();
  if (sku) {
    const bySku = await prisma.product.findUnique({ where: { sku } });
    if (bySku) return bySku.id;
  }

  if (adId) {
    const creative = await prisma.adCreative.findUnique({
      where: { adId },
      include: { campaign: { select: { productId: true } } },
    });
    if (creative) return creative.campaign.productId;
  }

  const products = await prisma.product.findMany({ select: { id: true }, take: 2 });
  return products.length === 1 ? products[0].id : null;
}

export async function ingestShopifyOrder(payload: ShopifyOrderPayload): Promise<IngestResult> {
  const shopifyOrderId = String(payload.id);
  const { utmContent } = extractAttribution(payload);
  const adId = await resolveAdId(utmContent);
  const productId = await resolveProductId(payload, adId);

  if (!productId) {
    return {
      status: 'skipped',
      shopifyOrderId,
      reason: 'No product matched the order SKU, and the store has more than one product.',
    };
  }

  const existing = await prisma.order.findUnique({ where: { shopifyOrderId } });
  const saleAmount = orderSaleAmount(payload);
  const quantity = totalQuantity(payload);
  const shopifyStatus = initialStatusFromShopify(payload);

  const shared = {
    orderNumber: payload.name ?? (payload.order_number ? `#${payload.order_number}` : null),
    customerPhone: orderPhone(payload) ?? null,
    customerCity: orderCity(payload) ?? null,
    productId,
    quantity,
    adId,
    utmContent: utmContent ?? null,
    saleAmount,
  };

  if (!existing) {
    await prisma.order.create({
      data: {
        shopifyOrderId,
        ...shared,
        orderStatus: shopifyStatus,
        createdAt: payload.created_at ? new Date(payload.created_at) : undefined,
      },
    });
    return { status: 'created', shopifyOrderId, productId, adId };
  }

  // MDM owns the delivery lifecycle once it has taken over; a later Shopify
  // webhook must not drag a delivered order back to NEW. Only a cancellation
  // or refund from Shopify overrides an in-flight status.
  const mdmHasOwnership = existing.mdmOrderId !== null;
  const overrideStatus =
    shopifyStatus === 'CANCELLED' || shopifyStatus === 'RETURNED'
      ? shopifyStatus
      : mdmHasOwnership
        ? existing.orderStatus
        : existing.orderStatus === 'NEW'
          ? shopifyStatus
          : existing.orderStatus;

  await prisma.order.update({
    where: { shopifyOrderId },
    data: {
      ...shared,
      // Never clear an attribution that a previous webhook already established.
      adId: adId ?? existing.adId,
      utmContent: utmContent ?? existing.utmContent,
      orderStatus: overrideStatus,
    },
  });

  return { status: 'updated', shopifyOrderId, productId, adId: adId ?? existing.adId };
}

export async function markOrderCancelled(shopifyOrderId: string): Promise<IngestResult> {
  const existing = await prisma.order.findUnique({ where: { shopifyOrderId } });
  if (!existing) return { status: 'skipped', shopifyOrderId, reason: 'Unknown order' };

  await prisma.order.update({
    where: { shopifyOrderId },
    data: { orderStatus: 'CANCELLED' },
  });
  return { status: 'updated', shopifyOrderId, productId: existing.productId, adId: existing.adId };
}
