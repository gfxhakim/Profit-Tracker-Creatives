import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  category: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  planDetails: z.string().nullable().optional(),
  amount: z.number().min(0).optional(),
  billingCycle: z.string().min(1).optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const data = patchSchema.parse(await request.json());
    const expense = await prisma.operationalExpense.update({ where: { id }, data });
    return ok({ expense });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await prisma.operationalExpense.delete({ where: { id } });
    return ok({ deleted: id });
  } catch (error) {
    return handleError(error);
  }
}
