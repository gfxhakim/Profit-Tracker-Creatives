import { resolveRange } from '@/lib/dates';
import { syncMdm } from '@/lib/sync/mdm-sync';
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
      preset: url.searchParams.get('range') ?? '30d',
    });
    return ok(await syncMdm(range));
  } catch (error) {
    return handleError(error);
  }
}

export const GET = POST;
