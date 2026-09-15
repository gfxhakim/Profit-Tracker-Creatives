import { z } from 'zod';
import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ratesSchema = z.object({
  confirmationFee: z.number().min(0),
  deliveryFee: z.number().min(0),
  returnFee: z.number().min(0),
  codGatewayFeePercent: z.number().min(0).max(100),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  cogsUnitPrice: z.number().min(0).optional(),
  batchQuantity: z.number().int().min(0).optional(),
  productionLeadTimeDays: z.number().int().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  deadStockUnits: z.number().int().min(0).optional(),
  fulfillmentRates: ratesSchema.partial().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: { fulfillmentRates: true, campaigns: true },
    });
    if (!product) return fail('Product not found', 404);
    return ok({ product });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { fulfillmentRates, ...fields } = patchSchema.parse(await request.json());

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...fields,
        ...(fulfillmentRates
          ? {
              fulfillmentRates: {
                upsert: {
                  create: {
                    confirmationFee: fulfillmentRates.confirmationFee ?? 0,
                    deliveryFee: fulfillmentRates.deliveryFee ?? 0,
                    returnFee: fulfillmentRates.returnFee ?? 0,
                    codGatewayFeePercent: fulfillmentRates.codGatewayFeePercent ?? 0,
                  },
                  update: fulfillmentRates,
                },
              },
            }
          : {}),
      },
      include: { fulfillmentRates: true },
    });

    return ok({ product });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const orderCount = await prisma.order.count({ where: { productId: id } });
    if (orderCount > 0) {
      return fail(
        `Cannot delete a product with ${orderCount} order(s); deleting it would erase historic profit data.`,
        409,
      );
    }
    await prisma.product.delete({ where: { id } });
    return ok({ deleted: id });
  } catch (error) {
    return handleError(error);
  }
}
