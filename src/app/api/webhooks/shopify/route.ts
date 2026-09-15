import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyShopifyHmac, type ShopifyOrderPayload } from '@/lib/shopify';
import { ingestShopifyOrder, markOrderCancelled } from '@/lib/orders';
import { MissingEnvError } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Shopify order webhooks.
 *
 * The raw body must be read before parsing so the HMAC is computed over exactly
 * the bytes Shopify signed. Shopify retries on any non-2xx, so unexpected
 * processing failures return 500 (retry me) while genuinely unusable payloads
 * return 200 (do not retry) with the reason recorded in the sync log.
 */

const HANDLED_TOPICS = new Set([
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/fulfilled',
  'orders/cancelled',
]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  const topic = request.headers.get('x-shopify-topic') ?? 'unknown';
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  try {
    if (!verifyShopifyHmac(rawBody, hmac)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  if (!HANDLED_TOPICS.has(topic)) {
    return NextResponse.json({ ignored: true, topic });
  }

  let payload: ShopifyOrderPayload;
  try {
    payload = JSON.parse(rawBody) as ShopifyOrderPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 200 });
  }

  try {
    const result =
      topic === 'orders/cancelled'
        ? await markOrderCancelled(String(payload.id))
        : await ingestShopifyOrder(payload);

    await prisma.syncLog.create({
      data: {
        source: 'SHOPIFY',
        status: result.status === 'skipped' ? 'PARTIAL' : 'SUCCESS',
        recordsRead: 1,
        recordsWritten: result.status === 'skipped' ? 0 : 1,
        message: `${topic}: ${result.status}${result.reason ? ` - ${result.reason}` : ''}`,
        finishedAt: new Date(),
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await prisma.syncLog
      .create({
        data: {
          source: 'SHOPIFY',
          status: 'FAILED',
          recordsRead: 1,
          message: `${topic}: ${message}`,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);

    // Non-2xx asks Shopify to redeliver, which is what we want for a transient
    // database failure.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
