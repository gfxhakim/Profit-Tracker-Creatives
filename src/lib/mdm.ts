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

/** Search endpoint, relative to MDM_API_BASE_URL. */
export const ORDERS_SEARCH_PATH = '/api/v2/orders/search';

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

function config() {
  const env = requireSection('mdm') as { MDM_API_BASE_URL: string; MDM_API_KEY: string };
  return { baseUrl: env.MDM_API_BASE_URL.replace(/\/$/, ''), apiKey: env.MDM_API_KEY };
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = config();
  const url = resolveMdmUrl(baseUrl, path);

  let lastError: MdmApiError | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        ...(init.headers ?? {}),
      },
    });

    if (response.ok) return (await response.json().catch(() => ({}))) as T;

    const body = await response.text().catch(() => '');
    lastError = new MdmApiError(
      `MDM API ${response.status} on ${init.method ?? 'GET'} ${path}`,
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
    id: pick(row, ['id', 'order_id', 'orderId', 'tracking_number', 'code']) ?? '',
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

function searchOrders(body: MdmSearchBody): Promise<unknown> {
  return request<unknown>(ORDERS_SEARCH_PATH, { method: 'POST', body: JSON.stringify(body) });
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
