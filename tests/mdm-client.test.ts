import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_SCHEMES,
  ORDERS_SEARCH_PATH,
  buildAuth,
  configuredScheme,
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
    expect(resolveMdmUrl('https://api.mdm.express', ORDERS_SEARCH_PATH)).toBe(
      'https://api.mdm.express/api/v2/orders/search',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(resolveMdmUrl('https://api.mdm.express/', ORDERS_SEARCH_PATH)).toBe(
      'https://api.mdm.express/api/v2/orders/search',
    );
  });

  it('does not repeat an api prefix already present in the base url', () => {
    expect(resolveMdmUrl('https://api.mdm.express/api/v2', ORDERS_SEARCH_PATH)).toBe(
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
    expect(calls[0].headers.authorization).toBe('Bearer test-key');
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
    expect(buildAuth('x-api-key', 'k').headers).toEqual({ 'x-api-key': 'k' });
    expect(buildAuth('x-auth-token', 'k').headers).toEqual({ 'x-auth-token': 'k' });
    expect(buildAuth('body-api_key', 'k').body).toEqual({ api_key: 'k' });
    expect(buildAuth('query-api_key', 'k').query).toEqual({ api_key: 'k' });
  });
});

describe('configuredScheme', () => {
  it('defaults to bearer and ignores an unrecognised value', () => {
    delete process.env.MDM_AUTH_SCHEME;
    expect(configuredScheme()).toBe('bearer');
    process.env.MDM_AUTH_SCHEME = 'nonsense';
    expect(configuredScheme()).toBe('bearer');
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
