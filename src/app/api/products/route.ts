import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ratesSchema = z.object({
  confirmationFee: z.number().min(0).default(0),
  deliveryFee: z.number().min(0).default(0),
  returnFee: z.number().min(0).default(0),
  codGatewayFeePercent: z.number().min(0).max(100).default(0),
});

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  cogsUnitPrice: z.number().min(0),
  batchQuantity: z.number().int().min(0),
  productionLeadTimeDays: z.number().int().min(0),
  sellingPrice: z.number().min(0),
  deadStockUnits: z.number().int().min(0).default(0),
  fulfillmentRates: ratesSchema.optional(),
});

export async function GET() {
  try {
    const products = await prisma.product.findMany({
      include: { fulfillmentRates: true, _count: { select: { orders: true, campaigns: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return ok({ products });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = productSchema.parse(await request.json());
    const { fulfillmentRates, ...product } = body;

    const created = await prisma.product.create({
      data: {
        ...product,
        fulfillmentRates: { create: fulfillmentRates ?? ratesSchema.parse({}) },
      },
      include: { fulfillmentRates: true },
    });

    return ok({ product: created }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
