import { requireSection } from '@/lib/env';
import type { OrderStatus } from '@/lib/profit-engine';

/**
 * MDM Express fulfilment client.
 *
 * Orders are read through `POST /api/v2/orders/search`, which takes its filters
 * (date range, paging) as a JSON body rather than query parameters.
 *
 * MDM's responses vary in shape (some wrap rows in `data`, some in `results`,
 * some nest a page object inside `data`) and its status vocabulary is
 * localised. Everything is normalised here so the rest of the app only ever
 * sees the six canonical order statuses.
 */

/**
 * Order-list endpoint, relative to MDM_API_BASE_URL. MDM's "Get Orders" is a
 * POST; override the path with MDM_ORDERS_PATH if this default is not it.
 */
export const DEFAULT_ORDERS_PATH = '/api/v2/orders/search';

/** Candidate list paths the probe tries, most likely first. */
export const ORDERS_PATH_CANDIDATES = [
  '/api/v2/orders/search',
  '/api/v2/orders',
  '/api/v2/orders/list',
  '/api/v2/orders/get',
  '/api/v2/orders/filter',
  '/api/v2/orders/all',
] as const;

export function ordersPath(): string {
  return process.env.MDM_ORDERS_PATH?.trim() || DEFAULT_ORDERS_PATH;
}

/** Single order lookup: GET /api/v2/orders/{trackingId}. */
export function orderByTrackingIdPath(trackingId: string): string {
  return `/api/v2/orders/${encodeURIComponent(trackingId)}`;
}

export class MdmApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
    this.name = 'MdmApiError';
  }
}

export interface MdmOrder {
  id: string;
  reference?: string;
  status: string;
  phone?: string;
  city?: string;
  price?: number;
  updatedAt?: string;
  deliveredAt?: string;
  returnedAt?: string;
  confirmedAt?: string;
}

/**
 * Raw MDM status -> canonical status. Keys are compared with accents folded to
 * their base letter, upper-cased, and non-alphanumerics stripped, so both
 * "Livré" and "livree" match LIVRE, and "En cours de livraison" matches
 * ENCOURSDELIVRAISON.
 */
const STATUS_MAP: Record<string, OrderStatus> = {
  NEW: 'NEW',
  NOUVEAU: 'NEW',
  PENDING: 'NEW',
  ENATTENTE: 'NEW',
  RECEIVED: 'NEW',

  CONFIRMED: 'CONFIRMED',
  CONFIRME: 'CONFIRMED',
  CONFIRMEE: 'CONFIRMED',
  PACKED: 'CONFIRMED',
  PREPARATION: 'CONFIRMED',
  READY: 'CONFIRMED',

  SHIPPED: 'SHIPPED',
  EXPEDIE: 'SHIPPED',
  INTRANSIT: 'SHIPPED',
  OUTFORDELIVERY: 'SHIPPED',
  ENCOURSDELIVRAISON: 'SHIPPED',
  ENCOURS: 'SHIPPED',
  PICKEDUP: 'SHIPPED',
  RAMASSE: 'SHIPPED',

  DELIVERED: 'DELIVERED',
  LIVRE: 'DELIVERED',
  LIVREE: 'DELIVERED',
  PAID: 'DELIVERED',
  COMPLETED: 'DELIVERED',

  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
  ANNULE: 'CANCELLED',
  ANNULEE: 'CANCELLED',
  REFUSED: 'CANCELLED',
  REFUSE: 'CANCELLED',
  UNREACHABLE: 'CANCELLED',
  INJOIGNABLE: 'CANCELLED',

  RETURNED: 'RETURNED',
  RETOUR: 'RETURNED',
  RETOURNE: 'RETURNED',
  RETURNEDTOSENDER: 'RETURNED',
  REFUND: 'RETURNED',
};

/**
 * Folds accents to their base letter before stripping punctuation. Deleting the
 * accented character instead would turn "Livré" into "LIVR", which matches
 * nothing and would silently fall back to NEW.
 */
export function statusKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeMdmStatus(raw: string | undefined | null): OrderStatus {
  if (!raw) return 'NEW';
  return STATUS_MAP[statusKey(raw)] ?? 'NEW';
}

/**
 * How the API key is presented. MDM's scheme is set with MDM_AUTH_SCHEME;
 * `npm run mdm:probe` reports which one the live API accepts.
 */
export const AUTH_SCHEMES = [
  'bearer', // Authorization: Bearer <key>   (default)
  'raw', // Authorization: <key>
  'token', // Authorization: Token <key>
  'x-api-key', // X-Api-Key: <key>
  'api-key', // Api-Key: <key>
  'x-auth-token', // X-Auth-Token: <key>
  'body-api_key', // { api_key: <key> } in the JSON body
  'body-token', // { token: <key> } in the JSON body
  'query-api_key', // ?api_key=<key>
] as const;

export type AuthScheme = (typeof AUTH_SCHEMES)[number];

export interface AuthParts {
  headers: Record<string, string>;
  body: Record<string, string>;
  query: Record<string, string>;
}

/**
 * Exactly one credential is sent per request. Sending several at once makes a
 * 401 impossible to attribute, and some gateways reject unexpected auth headers
 * outright.
 */
export function buildAuth(scheme: AuthScheme, apiKey: string): AuthParts {
  const empty = { headers: {}, body: {}, query: {} };
  switch (scheme) {
    case 'bearer':
      return { ...empty, headers: { authorization: `Bearer ${apiKey}` } };
    case 'raw':
      return { ...empty, headers: { authorization: apiKey } };
    case 'token':
      return { ...empty, headers: { authorization: `Token ${apiKey}` } };
    case 'x-api-key':
      return { ...empty, headers: { 'x-api-key': apiKey } };
    case 'api-key':
      return { ...empty, headers: { 'api-key': apiKey } };
    case 'x-auth-token':
      return { ...empty, headers: { 'x-auth-token': apiKey } };
    case 'body-api_key':
      return { ...empty, body: { api_key: apiKey } };
    case 'body-token':
      return { ...empty, body: { token: apiKey } };
    case 'query-api_key':
      return { ...empty, query: { api_key: apiKey } };
  }
}

export function configuredScheme(): AuthScheme {
  const raw = (process.env.MDM_AUTH_SCHEME ?? 'bearer').trim().toLowerCase();
  return (AUTH_SCHEMES as readonly string[]).includes(raw) ? (raw as AuthScheme) : 'bearer';
}

function config() {
  const env = requireSection('mdm') as { MDM_API_BASE_URL: string; MDM_API_KEY: string };
  return {
    baseUrl: env.MDM_API_BASE_URL.replace(/\/$/, ''),
    apiKey: env.MDM_API_KEY,
    scheme: configuredScheme(),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Joins a path onto the configured base URL. If the base already ends with the
 * API prefix (someone set MDM_API_BASE_URL to `https://api.mdm.express/api/v2`),
 * the prefix is not repeated.
 */
export function resolveMdmUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http')) return path;

  const base = baseUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;

  const prefixMatch = /\/api\/v\d+$/.exec(base);
  if (prefixMatch && suffix.startsWith(prefixMatch[0])) {
    return `${base}${suffix.slice(prefixMatch[0].length)}`;
  }
  return `${base}${suffix}`;
}

export interface MdmRequestOptions {
  method?: 'GET' | 'POST';
  /** Sent as the JSON body, with any body-borne credential merged in. */
  body?: Record<string, unknown>;
  /** Overrides MDM_AUTH_SCHEME; used by the auth probe. */
  scheme?: AuthScheme;
}

async function request<T>(path: string, options: MdmRequestOptions = {}): Promise<T> {
  const { baseUrl, apiKey, scheme: configured } = config();
  const scheme = options.scheme ?? configured;
  const auth = buildAuth(scheme, apiKey);

  const url = new URL(resolveMdmUrl(baseUrl, path));
  for (const [key, value] of Object.entries(auth.query)) url.searchParams.set(key, value);

  const method = options.method ?? 'GET';
  const payload = options.body ? { ...options.body, ...auth.body } : undefined;

  let lastError: MdmApiError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url.toString(), {
      method,
      cache: 'no-store',
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...auth.headers,
      },
    });

    if (response.ok) return (await response.json().catch(() => ({}))) as T;

    const body = await response.text().catch(() => '');
    lastError = new MdmApiError(
      response.status === 401 || response.status === 403
        ? `MDM API ${response.status} on ${method} ${path} - rejected using auth scheme "${scheme}". Run "npm run mdm:probe": it checks both the endpoint path (MDM_ORDERS_PATH) and the credential shape (MDM_AUTH_SCHEME).`
        : `MDM API ${response.status} on ${method} ${path}`,
      response.status,
      body,
    );
    if (response.status < 500 && response.status !== 429) throw lastError;
    await sleep(2 ** attempt * 1000);
  }

  throw lastError ?? new MdmApiError('MDM request failed', 500);
}

const ROW_KEYS = ['data', 'results', 'orders', 'items', 'records'] as const;

/**
 * Pulls rows out of whichever envelope MDM used, including a paginator nested
 * one level down (`{ data: { data: [...], last_page } }`).
 */
export function unwrapRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== 'object') return [];

  for (const key of ROW_KEYS) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }

  for (const key of ROW_KEYS) {
    const nested = (payload as Record<string, unknown>)[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const innerKey of ROW_KEYS) {
        const value = (nested as Record<string, unknown>)[innerKey];
        if (Array.isArray(value)) return value as Record<string, unknown>[];
      }
    }
  }

  return [];
}

/**
 * Reads the last page number from whichever pagination envelope MDM used, so
 * paging stops on the API's own count rather than on a short-page guess.
 */
export function lastPageOf(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates: Record<string, unknown>[] = [payload as Record<string, unknown>];
  for (const key of ['data', 'meta', 'pagination']) {
    const nested = (payload as Record<string, unknown>)[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  for (const source of candidates) {
    for (const key of ['last_page', 'total_pages', 'lastPage', 'totalPages', 'pages']) {
      const value = source[key];
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return null;
}

const pick = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return undefined;
};

export function mapMdmOrder(row: Record<string, unknown>): MdmOrder {
  const priceRaw = pick(row, ['price', 'total', 'amount', 'cod_amount', 'montant']);
  const price = priceRaw ? Number.parseFloat(priceRaw) : undefined;
  return {
    // MDM identifies an order by its tracking id - GET /api/v2/orders/{trackingId}.
    id: pick(row, ['tracking_id', 'trackingId', 'tracking_number', 'trackingNumber', 'id', 'order_id', 'orderId', 'code']) ?? '',
    reference: pick(row, ['reference', 'ref', 'external_id', 'order_reference', 'shopify_order_id']),
    status: pick(row, ['status', 'state', 'statut', 'order_status']) ?? 'NEW',
    phone: pick(row, ['phone', 'customer_phone', 'telephone', 'tel']),
    city: pick(row, ['city', 'ville', 'customer_city']),
    price: Number.isFinite(price) ? price : undefined,
    updatedAt: pick(row, ['updated_at', 'updatedAt', 'last_update']),
    deliveredAt: pick(row, ['delivered_at', 'deliveredAt', 'date_livraison']),
    returnedAt: pick(row, ['returned_at', 'returnedAt', 'date_retour']),
    confirmedAt: pick(row, ['confirmed_at', 'confirmedAt', 'date_confirmation']),
  };
}

export interface MdmQuery {
  since?: string; // YYYY-MM-DD
  until?: string;
  page?: number;
  perPage?: number;
  reference?: string;
}

export const DEFAULT_PER_PAGE = 200;
const MAX_PAGES = 25;

/** The JSON body sent to the orders search endpoint. */
export interface MdmSearchBody {
  start_date?: string;
  end_date?: string;
  reference?: string;
  page: number;
  per_page: number;
}

/** Filters travel in the request body, not the query string. */
export function buildSearchBody(query: MdmQuery = {}, page = query.page ?? 1): MdmSearchBody {
  return {
    ...(query.since ? { start_date: query.since } : {}),
    ...(query.until ? { end_date: query.until } : {}),
    ...(query.reference ? { reference: query.reference } : {}),
    page,
    per_page: query.perPage ?? DEFAULT_PER_PAGE,
  };
}

function searchOrders(
  body: MdmSearchBody,
  scheme?: AuthScheme,
  path = ordersPath(),
): Promise<unknown> {
  return request<unknown>(path, { method: 'POST', body: { ...body }, scheme });
}

/**
 * Fetches one order by its MDM tracking id. Documented as
 * GET /api/v2/orders/{trackingId}.
 */
export async function fetchOrderByTrackingId(trackingId: string): Promise<MdmOrder | null> {
  const payload = await request<unknown>(orderByTrackingIdPath(trackingId), { method: 'GET' });
  const rows = unwrapRows(payload);
  if (rows.length > 0) return mapMdmOrder(rows[0]);
  if (payload && typeof payload === 'object') {
    const mapped = mapMdmOrder(payload as Record<string, unknown>);
    return mapped.id ? mapped : null;
  }
  return null;
}

/** Unparsed search response, used by the probe to show MDM's real payload. */
export function rawSearch(body: MdmSearchBody, scheme?: AuthScheme, path?: string): Promise<unknown> {
  return searchOrders(body, scheme, path);
}

/**
 * Tries one candidate list path and reports the status. A 404 means the path is
 * wrong; a 401 with a valid token usually means the path exists but the
 * credential was refused, so the two are reported separately.
 */
export async function probeOrdersPath(
  path: string,
  scheme?: AuthScheme,
): Promise<{ path: string; ok: boolean; status: number | null; rows: number; detail: string }> {
  try {
    const payload = await searchOrders(buildSearchBody({ perPage: 1 }, 1), scheme, path);
    return { path, ok: true, status: 200, rows: unwrapRows(payload).length, detail: 'accepted' };
  } catch (error) {
    if (error instanceof MdmApiError) {
      const body = typeof error.body === 'string' ? error.body.slice(0, 90).replace(/\s+/g, ' ') : '';
      return { path, ok: false, status: error.status, rows: 0, detail: body || error.message.slice(0, 90) };
    }
    return {
      path,
      ok: false,
      status: null,
      rows: 0,
      detail: error instanceof Error ? error.message.slice(0, 90) : 'unknown error',
    };
  }
}

/**
 * Tries one auth scheme against the live search endpoint and reports what came
 * back, so the working scheme is found empirically rather than by guesswork.
 */
export async function probeAuthScheme(
  scheme: AuthScheme,
): Promise<{ scheme: AuthScheme; ok: boolean; status: number | null; detail: string }> {
  try {
    const payload = await searchOrders(buildSearchBody({ perPage: 1 }, 1), scheme);
    const rows = unwrapRows(payload);
    return {
      scheme,
      ok: true,
      status: 200,
      detail: `accepted - ${rows.length} row(s) returned`,
    };
  } catch (error) {
    if (error instanceof MdmApiError) {
      const body = typeof error.body === 'string' ? error.body.slice(0, 120).replace(/\s+/g, ' ') : '';
      return { scheme, ok: false, status: error.status, detail: body || error.message.slice(0, 120) };
    }
    return {
      scheme,
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message.slice(0, 120) : 'unknown error',
    };
  }
}

export async function fetchOrders(query: MdmQuery = {}): Promise<MdmOrder[]> {
  const perPage = query.perPage ?? DEFAULT_PER_PAGE;
  const firstPage = query.page ?? 1;

  const collected: MdmOrder[] = [];
  let lastPage: number | null = null;

  for (let page = firstPage; page < firstPage + MAX_PAGES; page += 1) {
    const payload = await searchOrders(buildSearchBody(query, page));
    const rows = unwrapRows(payload).map(mapMdmOrder).filter((order) => order.id !== '');
    collected.push(...rows);

    // Prefer the API's own page count; fall back to a short page meaning the end.
    lastPage = lastPage ?? lastPageOf(payload);
    if (lastPage !== null ? page >= lastPage : rows.length < perPage) break;
  }

  return collected;
}

export async function fetchOrderByReference(reference: string): Promise<MdmOrder | null> {
  const payload = await searchOrders(buildSearchBody({ reference, perPage: 1 }, 1));

  const rows = unwrapRows(payload);
  if (rows.length > 0) return mapMdmOrder(rows[0]);
  if (payload && typeof payload === 'object' && 'id' in (payload as Record<string, unknown>)) {
    return mapMdmOrder(payload as Record<string, unknown>);
  }
  return null;
}

/** Cheap connectivity probe for the integrations health panel. */
export async function ping(): Promise<{ ok: boolean; message: string }> {
  try {
    await searchOrders(buildSearchBody({ perPage: 1 }, 1));
    return { ok: true, message: 'Reachable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message };
  }
}
