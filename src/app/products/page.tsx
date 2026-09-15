import { prisma } from '@/lib/db';
import { safeLoad } from '@/lib/safe';
import { ErrorPanel } from '@/components/ErrorPanel';
import { ProductManager } from './ProductManager';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const loaded = await safeLoad(() =>
    prisma.product.findMany({
      include: { fulfillmentRates: true, _count: { select: { orders: true, campaigns: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );

  if (!loaded.ok) return <ErrorPanel title="Could not load products" detail={loaded.error} />;

  const products = loaded.data.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    cogsUnitPrice: product.cogsUnitPrice,
    batchQuantity: product.batchQuantity,
    productionLeadTimeDays: product.productionLeadTimeDays,
    sellingPrice: product.sellingPrice,
    deadStockUnits: product.deadStockUnits,
    orderCount: product._count.orders,
    campaignCount: product._count.campaigns,
    rates: {
      confirmationFee: product.fulfillmentRates?.confirmationFee ?? 0,
      deliveryFee: product.fulfillmentRates?.deliveryFee ?? 0,
      returnFee: product.fulfillmentRates?.returnFee ?? 0,
      codGatewayFeePercent: product.fulfillmentRates?.codGatewayFeePercent ?? 0,
    },
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Products &amp; fulfilment rates</h1>
        <p className="mt-1 text-sm text-muted">
          Cost inputs here drive every breakeven number in the app: goods cost, selling price, and the fees
          MDM Express charges per confirmation, delivery and return.
        </p>
      </div>
      <ProductManager initialProducts={products} />
    </div>
  );
}
