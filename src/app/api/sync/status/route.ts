import { prisma } from '@/lib/db';
import { envSectionStatus } from '@/lib/env';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Integration health panel: credential presence plus the last run per source. */
export async function GET() {
  try {
    const sources = ['META', 'MDM', 'SHOPIFY'] as const;
    const lastRuns = await Promise.all(
      sources.map((source) =>
        prisma.syncLog.findFirst({ where: { source }, orderBy: { startedAt: 'desc' } }),
      ),
    );

    return ok({
      integrations: [
        { source: 'META', env: envSectionStatus('meta'), lastRun: lastRuns[0] },
        { source: 'MDM', env: envSectionStatus('mdm'), lastRun: lastRuns[1] },
        { source: 'SHOPIFY', env: envSectionStatus('shopify'), lastRun: lastRuns[2] },
      ],
    });
  } catch (error) {
    return handleError(error);
  }
}
