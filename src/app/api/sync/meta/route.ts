import { resolveRange } from '@/lib/dates';
import { syncMeta } from '@/lib/sync/meta-sync';
import { assertSyncAuthorized, handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = await assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const range = resolveRange({
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
      preset: url.searchParams.get('range') ?? '7d',
    });
    return ok(await syncMeta(range));
  } catch (error) {
    return handleError(error);
  }
}

/** Convenience for schedulers that can only issue GET requests. */
export const GET = POST;
