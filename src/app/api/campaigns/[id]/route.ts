import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mapping a campaign to a product is what gives its creatives unit economics. */
const patchSchema = z.object({
  productId: z.string().uuid().optional(),
  dailyBudget: z.number().min(0).optional(),
  pixelId: z.string().optional(),
  adAccountName: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = patchSchema.parse(await request.json());
    const campaign = await prisma.campaign.update({
      where: { id },
      data,
      include: { product: { select: { id: true, name: true } } },
    });
    return ok({ campaign });
  } catch (error) {
    return handleError(error);
  }
}
