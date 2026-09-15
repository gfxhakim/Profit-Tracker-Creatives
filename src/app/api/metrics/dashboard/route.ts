import { resolveRange } from '@/lib/dates';
import { getDashboard } from '@/lib/reporting';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = resolveRange({
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
      preset: url.searchParams.get('range'),
    });
    return ok(await getDashboard(range));
  } catch (error) {
    return handleError(error);
  }
}
