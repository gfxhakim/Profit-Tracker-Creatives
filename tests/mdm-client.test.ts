import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDERS_SEARCH_PATH,
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
