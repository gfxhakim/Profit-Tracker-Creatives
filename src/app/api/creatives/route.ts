import { resolveRange } from '@/lib/dates';
import { getCreativePerformance } from '@/lib/reporting';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Creative leaderboard: ranked winners and losers by net profit and true CPD. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const range = resolveRange({
      since: url.searchParams.get('since'),
      until: url.searchParams.get('until'),
      preset: url.searchParams.get('range'),
    });

    const creatives = await getCreativePerformance(range);
    const productId = url.searchParams.get('productId');
    const status = url.searchParams.get('status');

    const filtered = creatives.filter((creative) => {
      if (productId && creative.productId !== productId) return false;
      if (status && creative.status !== status) return false;
      return true;
    });

    return ok({ range, creatives: filtered });
  } catch (error) {
    return handleError(error);
  }
}
