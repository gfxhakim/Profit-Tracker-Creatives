import crypto from 'node:crypto';
import { requireSection } from '@/lib/env';
import type { OrderStatus } from '@/lib/profit-engine';

/**
 * Shopify webhook verification and order normalisation.
 *
 * Attribution priority for a creative:
 *   1. `utm_content` on the order's landing-site or referring URL
 *   2. `utm_content` inside note_attributes (set by a theme/pixel snippet)
 *   3. `ad_id` / `fbclid`-derived attributes when present
 */

export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const { SHOPIFY_WEBHOOK_SECRET } = requireSection('shopify') as { SHOPIFY_WEBHOOK_SECRET: string };

  const digest = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');
  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(hmacHeader, 'utf8');
  // Length check first: timingSafeEqual throws on mismatched buffer lengths.
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

export interface ShopifyLineItem {
  sku?: string | null;
  quantity?: number;
  price?: string;
  title?: string;
}

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string;
  order_number?: number;
  phone?: string | null;
  total_price?: string;
  current_total_price?: string;
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  created_at?: string;
  landing_site?: string | null;
  referring_site?: string | null;
  note_attributes?: { name: string; value: string }[];
  customer?: { phone?: string | null };
  shipping_address?: { phone?: string | null; city?: string | null };
  billing_address?: { phone?: string | null; city?: string | null };
  line_items?: ShopifyLineItem[];
}

function utmFromUrl(url: string | null | undefined, key: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = url.startsWith('http') ? new URL(url) : new URL(url, 'https://shop.local');
    const value = parsed.searchParams.get(key);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

export function extractAttribution(order: ShopifyOrderPayload): {
  utmContent?: string;
  utmCampaign?: string;
} {
  const attributes = new Map(
    (order.note_attributes ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]),
  );

  const utmContent =
    utmFromUrl(order.landing_site, 'utm_content') ??
    utmFromUrl(order.referring_site, 'utm_content') ??
    attributes.get('utm_content') ??
    attributes.get('ad_id') ??
    attributes.get('adid') ??
    undefined;

  const utmCampaign =
    utmFromUrl(order.landing_site, 'utm_campaign') ??
    attributes.get('utm_campaign') ??
    undefined;

  return {
    utmContent: utmContent?.trim() || undefined,
    utmCampaign: utmCampaign?.trim() || undefined,
  };
}

/** Shopify only tells us cancelled vs open; MDM owns the delivery lifecycle. */
export function initialStatusFromShopify(order: ShopifyOrderPayload): OrderStatus {
  if (order.cancelled_at) return 'CANCELLED';
  if (order.financial_status === 'refunded') return 'RETURNED';
  return 'NEW';
}

export function orderSaleAmount(order: ShopifyOrderPayload): number {
  const raw = order.current_total_price ?? order.total_price ?? '0';
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function orderPhone(order: ShopifyOrderPayload): string | undefined {
  return (
    order.phone ??
    order.customer?.phone ??
    order.shipping_address?.phone ??
    order.billing_address?.phone ??
    undefined
  ) as string | undefined;
}

export function orderCity(order: ShopifyOrderPayload): string | undefined {
  return (order.shipping_address?.city ?? order.billing_address?.city ?? undefined) as string | undefined;
}

/** Primary line item decides which product the order is booked against. */
export function primaryLineItem(order: ShopifyOrderPayload): ShopifyLineItem | undefined {
  const items = order.line_items ?? [];
  if (items.length === 0) return undefined;
  return [...items].sort((a, b) => (b.quantity ?? 1) - (a.quantity ?? 1))[0];
}

export function totalQuantity(order: ShopifyOrderPayload): number {
  const items = order.line_items ?? [];
  if (items.length === 0) return 1;
  return items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
}
