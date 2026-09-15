import crypto from 'node:crypto';
import { requireSection } from '@/lib/env';

/**
 * Minimal Meta Marketing API client covering the endpoints this app needs:
 * campaign metadata, ad metadata (for utm_content attribution) and ad-level
 * insights. Requests are signed with `appsecret_proof`, paged to exhaustion and
 * retried with backoff on Meta's transient rate-limit codes.
 */

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export interface MetaGraphError {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly graphError?: MetaGraphError,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  account_id?: string;
  promoted_object?: { pixel_id?: string };
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  adset?: { name?: string };
  creative?: { id?: string; url_tags?: string; thumbnail_url?: string };
}

export interface MetaAdInsight {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name?: string;
  adset_name?: string;
  spend: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  date_start: string;
  date_stop: string;
}

function config() {
  const env = requireSection('meta') as {
    META_ACCESS_TOKEN: string;
    META_AD_ACCOUNT_ID: string;
    META_APP_SECRET: string;
    META_API_VERSION: string;
  };
  return {
    token: env.META_ACCESS_TOKEN,
    accountId: env.META_AD_ACCOUNT_ID,
    appSecret: env.META_APP_SECRET,
    version: env.META_API_VERSION ?? 'v21.0',
  };
}

/** Meta requires proof-of-secret alongside the token for server-side calls. */
function appSecretProof(token: string, appSecret: string) {
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function graphRequest<T>(path: string, params: Record<string, string>): Promise<T> {
  const { token, appSecret, version } = config();
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', token);
  url.searchParams.set('appsecret_proof', appSecretProof(token, appSecret));

  let lastError: MetaApiError | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as { error?: MetaGraphError } & T;

    if (response.ok && !payload.error) return payload;

    const graphError = payload.error;
    lastError = new MetaApiError(
      graphError?.message ?? `Meta API returned ${response.status}`,
      response.status,
      graphError,
    );

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      (graphError?.code !== undefined && TRANSIENT_CODES.has(graphError.code));
    if (!retryable) throw lastError;

    await sleep(2 ** attempt * 1000);
  }

  throw lastError ?? new MetaApiError('Meta API request failed', 500);
}

/** Follows `paging.next` cursors until the edge is exhausted. */
async function graphPaged<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const results: T[] = [];
  let page = await graphRequest<{ data: T[]; paging?: { cursors?: { after?: string } } }>(path, {
    ...params,
    limit: params.limit ?? '200',
  });
  results.push(...(page.data ?? []));

  let after = page.paging?.cursors?.after;
  let guard = 0;
  while (after && (page.data?.length ?? 0) > 0 && guard < 50) {
    page = await graphRequest<{ data: T[]; paging?: { cursors?: { after?: string } } }>(path, {
      ...params,
      limit: params.limit ?? '200',
      after,
    });
    results.push(...(page.data ?? []));
    after = page.paging?.cursors?.after;
    guard += 1;
  }

  return results;
}

export function fetchCampaigns(): Promise<MetaCampaign[]> {
  const { accountId } = config();
  return graphPaged<MetaCampaign>(`${accountId}/campaigns`, {
    fields: 'id,name,status,daily_budget,lifetime_budget,account_id,promoted_object{pixel_id}',
    effective_status: '["ACTIVE","PAUSED"]',
  });
}

export function fetchAds(): Promise<MetaAd[]> {
  const { accountId } = config();
  return graphPaged<MetaAd>(`${accountId}/ads`, {
    fields: 'id,name,status,campaign_id,adset{name},creative{id,url_tags,thumbnail_url}',
  });
}

export interface InsightsRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

/** Ad-level insights broken down by day, which is what the dashboard charts. */
export function fetchAdInsights(range: InsightsRange): Promise<MetaAdInsight[]> {
  const { accountId } = config();
  return graphPaged<MetaAdInsight>(`${accountId}/insights`, {
    level: 'ad',
    fields: 'ad_id,ad_name,campaign_id,campaign_name,adset_name,spend,impressions,clicks,reach',
    time_range: JSON.stringify({ since: range.since, until: range.until }),
    time_increment: '1',
  });
}

/**
 * Attribution key for an ad. Meta ads normally carry `utm_content={{ad.id}}` in
 * their URL tags, so the ad id is the fallback when no explicit tag is set.
 */
export function resolveUtmContent(ad: MetaAd): string {
  const tags = ad.creative?.url_tags;
  if (tags) {
    const parsed = new URLSearchParams(tags.replace(/^\?/, ''));
    const value = parsed.get('utm_content');
    // Unresolved Meta macros ({{ad.id}}) are useless as a stored key.
    if (value && !value.includes('{{')) return value;
  }
  return ad.id;
}

export const metaNumber = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Meta reports budgets in minor units (cents). */
export const metaBudgetToMajor = (value: string | undefined) => metaNumber(value) / 100;
