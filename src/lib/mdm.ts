import { requireSection } from '@/lib/env';
import type { OrderStatus } from '@/lib/profit-engine';

/**
 * MDM Express fulfilment client.
 *
 * MDM's REST responses vary by endpoint (some wrap rows in `data`, some in
 * `results`, some return a bare array) and its status vocabulary is localised.
 * Everything is normalised here so the rest of the app only ever sees the six
 * canonical order statuses.
 */

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
 * Raw MDM status -> canonical status. Keys are compared upper-cased with
 * non-alphanumerics stripped, so "En cours de livraison" matches "ENCOURSDELIVRAISON".
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

export function normalizeMdmStatus(raw: string | undefined | null): OrderStatus {
  if (!raw) return 'NEW';
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return STATUS_MAP[key] ?? 'NEW';
}

function config() {
  const env = requireSection('mdm') as { MDM_API_BASE_URL: string; MDM_API_KEY: string };
  return { baseUrl: env.MDM_API_BASE_URL.replace(/\/$/, ''), apiKey: env.MDM_API_KEY };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, apiKey } = config();
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

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
    lastError = new MdmApiError(`MDM API ${response.status} on ${path}`, response.status, body);
    if (response.status < 500 && response.status !== 429) throw lastError;
    await sleep(2 ** attempt * 1000);
  }

  throw lastError ?? new MdmApiError('MDM request failed', 500);
}

/** Pulls rows out of whichever envelope MDM used. */
function unwrapRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'results', 'orders', 'items', 'records']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
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
}

export async function fetchOrders(query: MdmQuery = {}): Promise<MdmOrder[]> {
  const params = new URLSearchParams();
  if (query.since) params.set('start_date', query.since);
  if (query.until) params.set('end_date', query.until);
  params.set('per_page', String(query.perPage ?? 200));

  const collected: MdmOrder[] = [];
  const maxPages = 25;
  for (let page = query.page ?? 1; page <= maxPages; page += 1) {
    params.set('page', String(page));
    const payload = await request<unknown>(`/orders?${params.toString()}`);
    const rows = unwrapRows(payload).map(mapMdmOrder).filter((order) => order.id !== '');
    collected.push(...rows);
    if (rows.length < (query.perPage ?? 200)) break;
  }

  return collected;
}

export async function fetchOrderByReference(reference: string): Promise<MdmOrder | null> {
  const payload = await request<unknown>(`/orders?reference=${encodeURIComponent(reference)}`);
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
    await request<unknown>('/orders?per_page=1&page=1');
    return { ok: true, message: 'Reachable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, message };
  }
}
