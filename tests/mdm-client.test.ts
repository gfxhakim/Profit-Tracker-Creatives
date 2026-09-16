import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_SCHEMES,
  DEFAULT_ORDERS_PATH,
  buildAuth,
  configuredScheme,
  fetchOrderByTrackingId,
  mapMdmOrder,
  orderByTrackingIdPath,
  ordersPath,
  normalizeMdmStatus,
  isKnownMdmStatus,
  buildSearchBody,
  fetchOrderByReference,
  fetchOrders,
  lastPageOf,
  resolveMdmUrl,
  unwrapRows,
} from '@/lib/mdm';

/** Captures what the client sent, so the wire format is asserted, not assumed. */
function stubFetch(responder: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];

  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return {
      ok: true,
      status: 200,
      json: async () => responder(url, init),
      text: async () => '',
    } as Response;
  });

  return calls;
}

beforeEach(() => {
  process.env.MDM_API_BASE_URL = 'https://api.mdm.express';
  process.env.MDM_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildSearchBody', () => {
  it('puts the date range and paging in the body', () => {
    expect(buildSearchBody({ since: '2026-09-01', until: '2026-09-15', perPage: 50 }, 2)).toEqual({
      start_date: '2026-09-01',
      end_date: '2026-09-15',
      page: 2,
      per_page: 50,
    });
  });

  it('omits dates that were not supplied rather than sending empty strings', () => {
    expect(buildSearchBody({})).toEqual({ page: 1, per_page: 200 });
  });
});

describe('resolveMdmUrl', () => {
  it('joins the search path onto the base url', () => {
    expect(resolveMdmUrl('https://api.mdm.express', DEFAULT_ORDERS_PATH)).toBe(
      'https://api.mdm.express/api/v2/orders/search',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(resolveMdmUrl('https://api.mdm.express/', DEFAULT_ORDERS_PATH)).toBe(
      'https://api.mdm.express/api/v2/orders/search',
    );
  });

  it('does not repeat an api prefix already present in the base url', () => {
    expect(resolveMdmUrl('https://api.mdm.express/api/v2', DEFAULT_ORDERS_PATH)).toBe(
      'https://api.mdm.express/api/v2/orders/search',
    );
  });
});

describe('fetchOrders', () => {
  it('POSTs to the search endpoint with the range in the body', async () => {
    const calls = stubFetch(() => ({ data: [{ id: 'MDM-1', status: 'Livré' }] }));

    await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.mdm.express/api/v2/orders/search');
    expect(calls[0].body).toEqual({
      start_date: '2026-09-01',
      end_date: '2026-09-15',
      page: 1,
      per_page: 200,
    });
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].headers['X-API-Key']).toBe('test-key');
  });

  it('pages until the API reports the last page', async () => {
    const calls = stubFetch(() => ({
      data: [{ id: 'MDM-1', status: 'Delivered' }],
      last_page: 3,
    }));

    const orders = await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls.map((call) => call.body)).toMatchObject([{ page: 1 }, { page: 2 }, { page: 3 }]);
    expect(orders).toHaveLength(3);
  });

  it('stops on a short page when the API reports no page count', async () => {
    const calls = stubFetch(() => ({ data: [{ id: 'MDM-1', status: 'Delivered' }] }));

    await fetchOrders({ perPage: 200 });

    expect(calls).toHaveLength(1);
  });

  it('sends the reference in the body when looking up one order', async () => {
    const calls = stubFetch(() => ({ data: [{ id: 'MDM-9', reference: '#1042', status: 'Livré' }] }));

    const order = await fetchOrderByReference('#1042');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ reference: '#1042', page: 1, per_page: 1 });
    expect(order?.id).toBe('MDM-9');
  });
});

describe('unwrapRows', () => {
  it('reads a bare array, and each common envelope key', () => {
    const rows = [{ id: '1' }];
    expect(unwrapRows(rows)).toEqual(rows);
    expect(unwrapRows({ data: rows })).toEqual(rows);
    expect(unwrapRows({ results: rows })).toEqual(rows);
    expect(unwrapRows({ orders: rows })).toEqual(rows);
  });

  it('reads a paginator nested one level down', () => {
    const rows = [{ id: '1' }];
    expect(unwrapRows({ data: { data: rows, last_page: 2 } })).toEqual(rows);
  });

  it('returns nothing for a payload with no rows', () => {
    expect(unwrapRows({ message: 'no results' })).toEqual([]);
    expect(unwrapRows(null)).toEqual([]);
  });
});

describe('lastPageOf', () => {
  it('finds the page count at the top level or nested in data/meta', () => {
    expect(lastPageOf({ last_page: 4 })).toBe(4);
    expect(lastPageOf({ total_pages: 7 })).toBe(7);
    expect(lastPageOf({ meta: { last_page: 2 } })).toBe(2);
    expect(lastPageOf({ data: { last_page: 5 } })).toBe(5);
  });

  it('returns null when the response says nothing about paging', () => {
    expect(lastPageOf({ data: [] })).toBeNull();
  });
});

describe('buildAuth', () => {
  it('sends exactly one credential per scheme', () => {
    const count = (parts: { headers: object; body: object; query: object }) =>
      Object.keys(parts.headers).length + Object.keys(parts.body).length + Object.keys(parts.query).length;

    for (const scheme of AUTH_SCHEMES) {
      expect(count(buildAuth(scheme, 'k'))).toBe(1);
    }
  });

  it('places the key where each scheme expects it', () => {
    expect(buildAuth('bearer', 'k').headers).toEqual({ authorization: 'Bearer k' });
    expect(buildAuth('raw', 'k').headers).toEqual({ authorization: 'k' });
    expect(buildAuth('token', 'k').headers).toEqual({ authorization: 'Token k' });
    expect(buildAuth('x-api-key', 'k').headers).toEqual({ 'X-API-Key': 'k' });
    expect(buildAuth('x-auth-token', 'k').headers).toEqual({ 'x-auth-token': 'k' });
    expect(buildAuth('body-api_key', 'k').body).toEqual({ api_key: 'k' });
    expect(buildAuth('query-api_key', 'k').query).toEqual({ api_key: 'k' });
  });
});

describe('configuredScheme', () => {
  it('defaults to the verified scheme and ignores an unrecognised value', () => {
    delete process.env.MDM_AUTH_SCHEME;
    expect(configuredScheme()).toBe('x-api-key');
    process.env.MDM_AUTH_SCHEME = 'nonsense';
    expect(configuredScheme()).toBe('x-api-key');
  });

  it('accepts a configured scheme case-insensitively', () => {
    process.env.MDM_AUTH_SCHEME = 'X-Auth-Token';
    expect(configuredScheme()).toBe('x-auth-token');
    delete process.env.MDM_AUTH_SCHEME;
  });
});

describe('auth scheme on the wire', () => {
  it('sends the configured credential and no others', async () => {
    process.env.MDM_AUTH_SCHEME = 'x-auth-token';
    const calls = stubFetch(() => ({ data: [] }));

    await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls[0].headers['x-auth-token']).toBe('test-key');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers['x-api-key']).toBeUndefined();
    delete process.env.MDM_AUTH_SCHEME;
  });

  it('merges a body-borne credential into the search body', async () => {
    process.env.MDM_AUTH_SCHEME = 'body-api_key';
    const calls = stubFetch(() => ({ data: [] }));

    await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls[0].body).toMatchObject({ api_key: 'test-key', start_date: '2026-09-01', page: 1 });
    expect(calls[0].headers.authorization).toBeUndefined();
    delete process.env.MDM_AUTH_SCHEME;
  });
});

describe('ordersPath', () => {
  afterEach(() => {
    delete process.env.MDM_ORDERS_PATH;
  });

  it('defaults to the documented search path', () => {
    expect(ordersPath()).toBe(DEFAULT_ORDERS_PATH);
  });

  it('is overridable without a code change', () => {
    process.env.MDM_ORDERS_PATH = '/api/v2/orders';
    expect(ordersPath()).toBe('/api/v2/orders');
  });

  it('builds the single-order path from a tracking id', () => {
    expect(orderByTrackingIdPath('MDM 123/4')).toBe('/api/v2/orders/MDM%20123%2F4');
  });
});

describe('mapMdmOrder tracking ids', () => {
  it('reads the order id from MDM tracking-id field names', () => {
    expect(mapMdmOrder({ tracking_id: 'MDM123' }).id).toBe('MDM123');
    expect(mapMdmOrder({ trackingId: 'MDM124' }).id).toBe('MDM124');
    expect(mapMdmOrder({ tracking_number: 'MDM125' }).id).toBe('MDM125');
    expect(mapMdmOrder({ id: 'MDM126' }).id).toBe('MDM126');
  });
});

describe('fetchOrderByTrackingId', () => {
  it('GETs the documented single-order path', async () => {
    const calls = stubFetch(() => ({ tracking_id: 'MDM123', status: 'Livré' }));

    const order = await fetchOrderByTrackingId('MDM123');

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://api.mdm.express/api/v2/orders/MDM123');
    expect(order?.id).toBe('MDM123');
  });
});

/**
 * These three facts are confirmed against MDM's API reference. They are pinned
 * so a refactor cannot quietly change the contract.
 */
describe('confirmed MDM contract', () => {
  it('defaults to POST /api/v2/orders/search', () => {
    expect(DEFAULT_ORDERS_PATH).toBe('/api/v2/orders/search');
    expect(ordersPath()).toBe('/api/v2/orders/search');
  });

  it('posts to the confirmed endpoint', async () => {
    const calls = stubFetch(() => ({ list: [] }));

    await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.mdm.express/api/v2/orders/search');
  });

  it('identifies an order by its tracking id ahead of any other field', () => {
    // A payload carrying several id-ish fields must resolve to the tracking id.
    expect(mapMdmOrder({ id: '7', order_id: '9', tracking_id: 'MDM123' }).id).toBe('MDM123');
    expect(mapMdmOrder({ id: '7', trackingId: 'MDM124' }).id).toBe('MDM124');
  });

  it('matches a synced order back by its stored tracking id', () => {
    // mdm-sync stores mapMdmOrder().id as Order.mdmOrderId and matches on it.
    const mapped = mapMdmOrder({ trackingId: 'MDM999', reference: '#1042', statut: 'Livré' });
    expect(mapped.id).toBe('MDM999');
    expect(mapped.reference).toBe('#1042');
    expect(normalizeMdmStatus(mapped.status)).toBe('DELIVERED');
  });
});

/**
 * The contract verified against the live MDM API: X-API-Key, a `list`
 * envelope, and orders keyed by trackingId with nested client/destination.
 */
describe('live MDM contract', () => {
  const liveRow = {
    trackingId: 'MDM-AA-001',
    reference: '#1042',
    status: 'delivered',
    statusDate: '2026-09-14T09:30:00Z',
    updatedAt: '2026-09-14T09:31:00Z',
    destination: { cityName: 'Casablanca', streetAddress: '12 Rue des Fleurs' },
    client: { firstName: 'Yassine', phone: '0600112233' },
    price: 349,
  };

  it('authenticates with X-API-Key by default', async () => {
    delete process.env.MDM_AUTH_SCHEME;
    const calls = stubFetch(() => ({ list: [] }));

    await fetchOrders({ since: '2026-09-01', until: '2026-09-15' });

    expect(calls[0].headers['X-API-Key']).toBe('test-key');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].url).toBe('https://api.mdm.express/api/v2/orders/search');
  });

  it('reads orders out of the list envelope', () => {
    expect(unwrapRows({ list: [liveRow], total: 1, page: 1 })).toEqual([liveRow]);
  });

  it('maps every confirmed field, including the nested ones', () => {
    expect(mapMdmOrder(liveRow)).toMatchObject({
      id: 'MDM-AA-001',
      reference: '#1042',
      status: 'delivered',
      statusDate: '2026-09-14T09:30:00Z',
      phone: '0600112233',
      clientName: 'Yassine',
      city: 'Casablanca',
      address: '12 Rue des Fleurs',
      price: 349,
    });
  });

  it('falls back to updatedAt when statusDate is absent', () => {
    const { statusDate, ...withoutStatusDate } = liveRow;
    expect(mapMdmOrder(withoutStatusDate).statusDate).toBe('2026-09-14T09:31:00Z');
  });

  it('maps MDM lowercase statuses', () => {
    expect(normalizeMdmStatus('delivered')).toBe('DELIVERED');
    expect(normalizeMdmStatus('cancelled')).toBe('CANCELLED');
    expect(isKnownMdmStatus('delivered')).toBe(true);
  });

  it('flags an unrecognised status rather than passing it off as NEW', () => {
    // Silently defaulting would hold a delivered order out of revenue.
    expect(normalizeMdmStatus('awaitingWarehouse')).toBe('NEW');
    expect(isKnownMdmStatus('awaitingWarehouse')).toBe(false);
  });

  it('survives a row missing its nested objects entirely', () => {
    const mapped = mapMdmOrder({ trackingId: 'MDM-X', status: 'delivered' });
    expect(mapped.id).toBe('MDM-X');
    expect(mapped.city).toBeUndefined();
    expect(mapped.phone).toBeUndefined();
  });
});
