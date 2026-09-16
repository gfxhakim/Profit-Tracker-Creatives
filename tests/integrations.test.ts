import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  extractAttribution,
  initialStatusFromShopify,
  orderPhone,
  orderSaleAmount,
  primaryLineItem,
  totalQuantity,
  verifyShopifyHmac,
  type ShopifyOrderPayload,
} from '@/lib/shopify';
import { mapMdmOrder, normalizeMdmStatus, statusKey } from '@/lib/mdm';
import { resolveUtmContent, metaBudgetToMajor, metaNumber } from '@/lib/meta';
import { eachDay, previousRange, resolveRange, toIsoDate } from '@/lib/dates';

const SECRET = 'test-webhook-signing-secret';

beforeAll(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
});

const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');

describe('verifyShopifyHmac', () => {
  it('accepts a correctly signed body', () => {
    const body = JSON.stringify({ id: 1, total_price: '349.00' });
    expect(verifyShopifyHmac(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = JSON.stringify({ id: 1, total_price: '349.00' });
    const signature = sign(body);
    expect(verifyShopifyHmac(body.replace('349', '34'), signature)).toBe(false);
  });

  it('rejects a missing or wrong-length signature without throwing', () => {
    const body = '{}';
    expect(verifyShopifyHmac(body, null)).toBe(false);
    expect(verifyShopifyHmac(body, 'short')).toBe(false);
  });
});

describe('extractAttribution', () => {
  const base: ShopifyOrderPayload = { id: 5 };

  it('reads utm_content from the landing site', () => {
    expect(
      extractAttribution({ ...base, landing_site: '/products/watch?utm_content=120210001&utm_campaign=cold' }),
    ).toEqual({ utmContent: '120210001', utmCampaign: 'cold' });
  });

  it('falls back to the referring site, then note attributes', () => {
    expect(extractAttribution({ ...base, referring_site: 'https://l.facebook.com/?utm_content=abc' }).utmContent).toBe('abc');
    expect(
      extractAttribution({ ...base, note_attributes: [{ name: 'ad_id', value: '999' }] }).utmContent,
    ).toBe('999');
  });

  it('returns nothing when the order carries no attribution', () => {
    expect(extractAttribution(base).utmContent).toBeUndefined();
  });
});

describe('shopify order normalisation', () => {
  const order: ShopifyOrderPayload = {
    id: 12,
    cancelled_at: null,
    current_total_price: '698.00',
    total_price: '700.00',
    shipping_address: { phone: '+212600000000', city: 'Casablanca' },
    line_items: [
      { sku: 'A', quantity: 1 },
      { sku: 'B', quantity: 3 },
    ],
  };

  it('prefers the current total, which reflects edits', () => {
    expect(orderSaleAmount(order)).toBe(698);
  });

  it('books the order against the largest line item', () => {
    expect(primaryLineItem(order)?.sku).toBe('B');
    expect(totalQuantity(order)).toBe(4);
  });

  it('finds a phone number across the address fallbacks', () => {
    expect(orderPhone(order)).toBe('+212600000000');
  });

  it('marks cancelled and refunded orders from Shopify state', () => {
    expect(initialStatusFromShopify(order)).toBe('NEW');
    expect(initialStatusFromShopify({ ...order, cancelled_at: '2026-01-01' })).toBe('CANCELLED');
    expect(initialStatusFromShopify({ ...order, financial_status: 'refunded' })).toBe('RETURNED');
  });
});

describe('normalizeMdmStatus', () => {
  it('maps English, French and spaced variants onto canonical statuses', () => {
    expect(normalizeMdmStatus('Delivered')).toBe('DELIVERED');
    expect(normalizeMdmStatus('livrée')).toBe('DELIVERED');
    expect(normalizeMdmStatus('En cours de livraison')).toBe('SHIPPED');
    expect(normalizeMdmStatus('RETOUR')).toBe('RETURNED');
    expect(normalizeMdmStatus('Injoignable')).toBe('CANCELLED');
  });

  it('folds accents rather than deleting them', () => {
    // Deleting the accent would key "Livré" as LIVR, which matches nothing and
    // would silently mark every delivered order as NEW.
    expect(normalizeMdmStatus('Livré')).toBe('DELIVERED');
    expect(normalizeMdmStatus('Expédié')).toBe('SHIPPED');
    expect(normalizeMdmStatus('Annulé')).toBe('CANCELLED');
    expect(normalizeMdmStatus('Retourné')).toBe('RETURNED');
    expect(normalizeMdmStatus('Confirmé')).toBe('CONFIRMED');
  });

  it('keys accented and unaccented spellings identically', () => {
    expect(statusKey('Livré')).toBe(statusKey('livre'));
    expect(statusKey('En cours de livraison')).toBe('ENCOURSDELIVRAISON');
  });

  it('defaults an unknown or missing status to NEW rather than guessing', () => {
    expect(normalizeMdmStatus('something-else')).toBe('NEW');
    expect(normalizeMdmStatus(undefined)).toBe('NEW');
  });
});

describe('mapMdmOrder', () => {
  it('reads whichever field name MDM used for each value', () => {
    const mapped = mapMdmOrder({
      order_id: 'MDM-1',
      order_reference: '#1042',
      statut: 'Livré',
      telephone: '0600000000',
      ville: 'Rabat',
      montant: '349.5',
    });

    expect(mapped).toMatchObject({
      id: 'MDM-1',
      reference: '#1042',
      status: 'Livré',
      phone: '0600000000',
      city: 'Rabat',
      price: 349.5,
    });
  });
});

describe('resolveUtmContent', () => {
  it('uses the creative url tag when it is a resolved value', () => {
    expect(
      resolveUtmContent({
        id: '123',
        name: 'ad',
        status: 'ACTIVE',
        campaign_id: 'c1',
        creative: { url_tags: 'utm_source=facebook&utm_content=creative-a' },
      }),
    ).toBe('creative-a');
  });

  it('falls back to the ad id for an unresolved Meta macro', () => {
    expect(
      resolveUtmContent({
        id: '123',
        name: 'ad',
        status: 'ACTIVE',
        campaign_id: 'c1',
        creative: { url_tags: 'utm_content={{ad.id}}' },
      }),
    ).toBe('123');
  });

  it('falls back to the ad id when there are no tags at all', () => {
    expect(resolveUtmContent({ id: '123', name: 'ad', status: 'ACTIVE', campaign_id: 'c1' })).toBe('123');
  });
});

describe('meta numbers', () => {
  it('parses spend strings and converts minor-unit budgets', () => {
    expect(metaNumber('12.34')).toBe(12.34);
    expect(metaNumber(undefined)).toBe(0);
    expect(metaBudgetToMajor('40000')).toBe(400);
  });
});

describe('date ranges', () => {
  it('builds an inclusive range from explicit dates', () => {
    const range = resolveRange({ since: '2026-01-01', until: '2026-01-07' });
    expect(range.days).toBe(7);
    expect(eachDay(range)).toHaveLength(7);
    expect(toIsoDate(range.since)).toBe('2026-01-01');
  });

  it('falls back to the 7-day preset for a malformed preset', () => {
    expect(resolveRange({ preset: 'nonsense' }).days).toBe(7);
  });

  it('returns the immediately preceding window of equal length', () => {
    const range = resolveRange({ since: '2026-01-08', until: '2026-01-14' });
    const previous = previousRange(range);
    expect(toIsoDate(previous.since)).toBe('2026-01-01');
    expect(previous.days).toBe(7);
  });
});
