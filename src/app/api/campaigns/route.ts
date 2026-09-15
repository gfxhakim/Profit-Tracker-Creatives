import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        product: { select: { id: true, name: true, sku: true } },
        _count: { select: { creatives: true } },
      },
      orderBy: { name: 'asc' },
    });
    return ok({ campaigns });
  } catch (error) {
    return handleError(error);
  }
}
