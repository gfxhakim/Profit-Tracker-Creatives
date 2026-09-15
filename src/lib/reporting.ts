import { prisma } from '@/lib/db';
import { eachDay, toIsoDate, type DateRange } from '@/lib/dates';
import {
  breakevenCostPerDelivered,
  breakevenStatus,
  calculateProfit,
  countStatuses,
  operationalExpenseForRange,
  projectPendingOutcome,
  rankCreatives,
  round,
  safeDiv,
  type BreakevenStatus,
  type OrderStatus,
  type ProductEconomics,
  type ProfitResult,
} from '@/lib/profit-engine';

/**
 * Reporting layer: reads the database once per request, then hands plain
 * objects to the pure profit engine. Aggregation happens in memory because a
 * COD catalogue is small (tens of products, hundreds of creatives) and the
 * alternative - a SQL view per metric - would duplicate the engine's rules.
 */

const DEFAULT_RATES = {
  confirmationFee: 0,
  deliveryFee: 0,
  returnFee: 0,
  codGatewayFeePercent: 0,
};

type OrderRow = {
  shopifyOrderId: string;
  productId: string;
  adId: string | null;
  orderStatus: string;
  saleAmount: number;
  quantity: number;
  createdAt: Date;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  cogsUnitPrice: number;
  sellingPrice: number;
  batchQuantity: number;
  productionLeadTimeDays: number;
  deadStockUnits: number;
  fulfillmentRates: {
    confirmationFee: number;
    deliveryFee: number;
    returnFee: number;
    codGatewayFeePercent: number;
  } | null;
};

function economicsFor(product: ProductRow): ProductEconomics {
  return {
    cogsUnitPrice: product.cogsUnitPrice,
    sellingPrice: product.sellingPrice,
    rates: product.fulfillmentRates ?? DEFAULT_RATES,
  };
}

/** Weighted blend used when a slice spans several products. */
function blendEconomics(products: ProductRow[], weights: Map<string, number>): ProductEconomics {
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (products.length === 0) {
    return { cogsUnitPrice: 0, sellingPrice: 0, rates: DEFAULT_RATES };
  }
  if (totalWeight === 0) return economicsFor(products[0]);

  const blended: ProductEconomics = {
    cogsUnitPrice: 0,
    sellingPrice: 0,
    rates: { ...DEFAULT_RATES },
  };

  for (const product of products) {
    const share = (weights.get(product.id) ?? 0) / totalWeight;
    if (share === 0) continue;
    const economics = economicsFor(product);
    blended.cogsUnitPrice += economics.cogsUnitPrice * share;
    blended.sellingPrice += economics.sellingPrice * share;
    blended.rates.confirmationFee += economics.rates.confirmationFee * share;
    blended.rates.deliveryFee += economics.rates.deliveryFee * share;
    blended.rates.returnFee += economics.rates.returnFee * share;
    blended.rates.codGatewayFeePercent += economics.rates.codGatewayFeePercent * share;
  }

  return blended;
}

const asStatus = (value: string): OrderStatus => value as OrderStatus;

const toOrderInput = (order: OrderRow) => ({
  status: asStatus(order.orderStatus),
  saleAmount: order.saleAmount,
  quantity: order.quantity,
});

async function loadRangeData(range: DateRange) {
  const [products, orders, dailyStats, expenses] = await Promise.all([
    prisma.product.findMany({
      include: { fulfillmentRates: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: range.since, lte: range.until } },
      select: {
        shopifyOrderId: true,
        productId: true,
        adId: true,
        orderStatus: true,
        saleAmount: true,
        quantity: true,
        createdAt: true,
      },
    }),
    prisma.adCreativeDailyStat.findMany({
      where: { date: { gte: range.since, lte: range.until } },
      include: {
        adCreative: {
          include: { campaign: { select: { id: true, name: true, productId: true, dailyBudget: true } } },
        },
      },
    }),
    prisma.operationalExpense.findMany({
      where: {
        AND: [
          { OR: [{ endedAt: null }, { endedAt: { gte: range.since } }] },
          { startedAt: { lte: range.until } },
        ],
      },
    }),
  ]);

  return { products: products as ProductRow[], orders: orders as OrderRow[], dailyStats, expenses };
}

type RangeData = Awaited<ReturnType<typeof loadRangeData>>;

/** Ad spend per creative within the range, from the day-level Meta stats. */
function spendByAd(dailyStats: RangeData['dailyStats']): Map<string, number> {
  const spend = new Map<string, number>();
  for (const stat of dailyStats) {
    spend.set(stat.adId, (spend.get(stat.adId) ?? 0) + stat.spend);
  }
  return spend;
}

export interface CreativeRow {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  productId: string;
  productName: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  confirmed: number;
  delivered: number;
  returned: number;
  cancelled: number;
  pending: number;
  revenue: number;
  netProfit: number;
  trueCostPerDelivered: number;
  breakevenCpd: number;
  costPerLead: number;
  confirmationRate: number;
  deliveryRate: number;
  returnRate: number;
  roas: number;
  profitPerDelivered: number;
  status: BreakevenStatus;
  /** Headroom between breakeven CPD and true CPD, as a percentage. */
  headroomPercent: number;
}

export async function getCreativePerformance(range: DateRange, data?: RangeData): Promise<CreativeRow[]> {
  const { products, orders, dailyStats, expenses } = data ?? (await loadRangeData(range));
  const productById = new Map(products.map((product) => [product.id, product]));
  const totalOpex = operationalExpenseForRange(expenses, range.days);

  const spendPerAd = spendByAd(dailyStats);
  const creativeMeta = new Map<
    string,
    { adName: string; campaignId: string; campaignName: string; productId: string; impressions: number; clicks: number }
  >();

  for (const stat of dailyStats) {
    const existing = creativeMeta.get(stat.adId);
    const impressions = (existing?.impressions ?? 0) + stat.impressions;
    const clicks = (existing?.clicks ?? 0) + stat.clicks;
    creativeMeta.set(stat.adId, {
      adName: stat.adCreative.adName,
      campaignId: stat.adCreative.campaignId,
      campaignName: stat.adCreative.campaign.name,
      productId: stat.adCreative.campaign.productId,
      impressions,
      clicks,
    });
  }

  const ordersByAd = new Map<string, OrderRow[]>();
  for (const order of orders) {
    if (!order.adId) continue;
    const bucket = ordersByAd.get(order.adId);
    if (bucket) bucket.push(order);
    else ordersByAd.set(order.adId, [order]);
  }

  // Creatives with orders but no spend rows still deserve a line in the table.
  const missingMeta = [...ordersByAd.keys()].filter((adId) => !creativeMeta.has(adId));
  if (missingMeta.length > 0) {
    const creatives = await prisma.adCreative.findMany({
      where: { adId: { in: missingMeta } },
      include: { campaign: { select: { id: true, name: true, productId: true } } },
    });
    for (const creative of creatives) {
      creativeMeta.set(creative.adId, {
        adName: creative.adName,
        campaignId: creative.campaignId,
        campaignName: creative.campaign.name,
        productId: creative.campaign.productId,
        impressions: 0,
        clicks: 0,
      });
    }
  }

  const totalRevenue = orders
    .filter((order) => order.orderStatus === 'DELIVERED')
    .reduce((sum, order) => sum + order.saleAmount, 0);

  const rows: CreativeRow[] = [];

  for (const [adId, meta] of creativeMeta) {
    const product = productById.get(meta.productId);
    if (!product) continue;

    const adOrders = ordersByAd.get(adId) ?? [];
    const adSpend = spendPerAd.get(adId) ?? 0;
    const adRevenue = adOrders
      .filter((order) => order.orderStatus === 'DELIVERED')
      .reduce((sum, order) => sum + order.saleAmount, 0);

    // Fixed costs follow revenue; creatives that collected nothing carry none.
    const opexShare = totalRevenue > 0 ? totalOpex * (adRevenue / totalRevenue) : 0;

    const result = calculateProfit({
      orders: adOrders.map(toOrderInput),
      economics: economicsFor(product),
      adSpend,
      operationalExpenses: opexShare,
    });

    const breakevenCpd = result.breakeven.cpd;
    rows.push({
      adId,
      adName: meta.adName,
      campaignId: meta.campaignId,
      campaignName: meta.campaignName,
      productId: product.id,
      productName: product.name,
      spend: round(adSpend),
      impressions: meta.impressions,
      clicks: meta.clicks,
      leads: result.counts.total,
      confirmed: result.counts.confirmedCumulative,
      delivered: result.counts.delivered,
      returned: result.counts.returned,
      cancelled: result.counts.cancelled,
      pending: result.counts.pending,
      revenue: result.revenue,
      netProfit: result.netProfit,
      trueCostPerDelivered: result.perOrder.trueCostPerDelivered,
      breakevenCpd,
      costPerLead: result.perOrder.costPerLead,
      confirmationRate: result.rates.confirmationRate,
      deliveryRate: result.rates.deliveryRateOnLeads,
      returnRate: result.rates.returnRate,
      roas: result.roas,
      profitPerDelivered: result.perOrder.profitPerDelivered,
      status: result.status,
      headroomPercent:
        breakevenCpd > 0
          ? round((1 - safeDiv(result.perOrder.trueCostPerDelivered, breakevenCpd)) * 100)
          : 0,
    });
  }

  return rankCreatives(rows);
}

export interface ProductRowMetrics {
  productId: string;
  name: string;
  sku: string;
  sellingPrice: number;
  cogsUnitPrice: number;
  spend: number;
  revenue: number;
  netProfit: number;
  leads: number;
  delivered: number;
  trueCostPerDelivered: number;
  breakevenCpd: number;
  deliveryRate: number;
  confirmationRate: number;
  returnRate: number;
  status: BreakevenStatus;
  inventory: {
    unitsRemaining: number;
    unitsSoldInRange: number;
    dailyBurnRate: number;
    daysOfStockLeft: number | null;
    reorderBy: string | null;
    needsReorder: boolean;
  };
}

export async function getProductPerformance(range: DateRange, data?: RangeData): Promise<ProductRowMetrics[]> {
  const { products, orders, dailyStats, expenses } = data ?? (await loadRangeData(range));
  const totalOpex = operationalExpenseForRange(expenses, range.days);

  const spendByProduct = new Map<string, number>();
  for (const stat of dailyStats) {
    const productId = stat.adCreative.campaign.productId;
    spendByProduct.set(productId, (spendByProduct.get(productId) ?? 0) + stat.spend);
  }

  const totalRevenue = orders
    .filter((order) => order.orderStatus === 'DELIVERED')
    .reduce((sum, order) => sum + order.saleAmount, 0);

  return products.map((product) => {
    const productOrders = orders.filter((order) => order.productId === product.id);
    const adSpend = spendByProduct.get(product.id) ?? 0;
    const productRevenue = productOrders
      .filter((order) => order.orderStatus === 'DELIVERED')
      .reduce((sum, order) => sum + order.saleAmount, 0);
    const opexShare = totalRevenue > 0 ? totalOpex * (productRevenue / totalRevenue) : 0;

    const result = calculateProfit({
      orders: productOrders.map(toOrderInput),
      economics: economicsFor(product),
      adSpend,
      operationalExpenses: opexShare,
    });

    const unitsSold = result.units.delivered;
    const dailyBurnRate = safeDiv(unitsSold, range.days);
    const unitsRemaining = Math.max(0, product.batchQuantity - unitsSold - product.deadStockUnits);
    const daysOfStockLeft = dailyBurnRate > 0 ? unitsRemaining / dailyBurnRate : null;
    const reorderBy =
      daysOfStockLeft !== null
        ? toIsoDate(new Date(Date.now() + Math.max(0, daysOfStockLeft - product.productionLeadTimeDays) * 86_400_000))
        : null;

    return {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      sellingPrice: product.sellingPrice,
      cogsUnitPrice: product.cogsUnitPrice,
      spend: round(adSpend),
      revenue: result.revenue,
      netProfit: result.netProfit,
      leads: result.counts.total,
      delivered: result.counts.delivered,
      trueCostPerDelivered: result.perOrder.trueCostPerDelivered,
      breakevenCpd: result.breakeven.cpd,
      deliveryRate: result.rates.deliveryRateOnLeads,
      confirmationRate: result.rates.confirmationRate,
      returnRate: result.rates.returnRate,
      status: result.status,
      inventory: {
        unitsRemaining,
        unitsSoldInRange: unitsSold,
        dailyBurnRate: round(dailyBurnRate, 2),
        daysOfStockLeft: daysOfStockLeft === null ? null : round(daysOfStockLeft, 1),
        reorderBy,
        needsReorder: daysOfStockLeft !== null && daysOfStockLeft <= product.productionLeadTimeDays,
      },
    };
  });
}

export interface DailyPoint {
  date: string;
  spend: number;
  revenue: number;
  netProfit: number;
  leads: number;
  delivered: number;
}

export function buildDailySeries(range: DateRange, data: RangeData): DailyPoint[] {
  const { orders, dailyStats, products, expenses } = data;
  const productById = new Map(products.map((product) => [product.id, product]));
  const opexPerDay = safeDiv(operationalExpenseForRange(expenses, range.days), range.days);

  const spendByDate = new Map<string, number>();
  for (const stat of dailyStats) {
    const key = toIsoDate(stat.date);
    spendByDate.set(key, (spendByDate.get(key) ?? 0) + stat.spend);
  }

  const ordersByDate = new Map<string, OrderRow[]>();
  for (const order of orders) {
    const key = toIsoDate(order.createdAt);
    const bucket = ordersByDate.get(key);
    if (bucket) bucket.push(order);
    else ordersByDate.set(key, [order]);
  }

  return eachDay(range).map((day) => {
    const key = toIsoDate(day);
    const dayOrders = ordersByDate.get(key) ?? [];
    const spend = spendByDate.get(key) ?? 0;

    let revenue = 0;
    let netProfit = -spend - opexPerDay;
    const byProduct = new Map<string, OrderRow[]>();
    for (const order of dayOrders) {
      const bucket = byProduct.get(order.productId);
      if (bucket) bucket.push(order);
      else byProduct.set(order.productId, [order]);
    }

    for (const [productId, productOrders] of byProduct) {
      const product = productById.get(productId);
      if (!product) continue;
      const result = calculateProfit({
        orders: productOrders.map(toOrderInput),
        economics: economicsFor(product),
        adSpend: 0,
      });
      revenue += result.revenue;
      netProfit += result.contributionMargin;
    }

    const counts = countStatuses(dayOrders.map(toOrderInput));

    return {
      date: key,
      spend: round(spend),
      revenue: round(revenue),
      netProfit: round(netProfit),
      leads: counts.total,
      delivered: counts.delivered,
    };
  });
}

export interface Alert {
  level: 'critical' | 'warning' | 'info';
  scope: 'creative' | 'product' | 'inventory' | 'integration';
  title: string;
  detail: string;
  reference?: string;
}

export function buildAlerts(creatives: CreativeRow[], products: ProductRowMetrics[]): Alert[] {
  const alerts: Alert[] = [];

  for (const creative of creatives) {
    if (creative.spend <= 0) continue;

    if (creative.status === 'LOSS') {
      alerts.push({
        level: 'critical',
        scope: 'creative',
        title: `${creative.adName} is below breakeven`,
        detail:
          creative.delivered === 0
            ? `Spent ${creative.spend.toFixed(2)} with no delivered order yet (breakeven CPD ${creative.breakevenCpd.toFixed(2)}).`
            : `True CPD ${creative.trueCostPerDelivered.toFixed(2)} exceeds breakeven CPD ${creative.breakevenCpd.toFixed(2)}. Net ${creative.netProfit.toFixed(2)}.`,
        reference: creative.adId,
      });
    } else if (creative.status === 'WARNING') {
      alerts.push({
        level: 'warning',
        scope: 'creative',
        title: `${creative.adName} is approaching breakeven`,
        detail: `True CPD ${creative.trueCostPerDelivered.toFixed(2)} is within ${Math.abs(creative.headroomPercent).toFixed(0)}% of breakeven CPD ${creative.breakevenCpd.toFixed(2)}.`,
        reference: creative.adId,
      });
    }

    if (creative.delivered >= 5 && creative.returnRate > 25) {
      alerts.push({
        level: 'warning',
        scope: 'creative',
        title: `High return rate on ${creative.adName}`,
        detail: `${creative.returnRate.toFixed(0)}% of settled orders came back. Check the offer or the audience.`,
        reference: creative.adId,
      });
    }
  }

  for (const product of products) {
    if (product.inventory.needsReorder) {
      alerts.push({
        level: 'critical',
        scope: 'inventory',
        title: `Reorder ${product.name} now`,
        detail: `${product.inventory.unitsRemaining} units left, burning ${product.inventory.dailyBurnRate}/day, and production takes time. Stock runs out in ${product.inventory.daysOfStockLeft ?? 0} days.`,
        reference: product.sku,
      });
    }
    if (product.leads >= 10 && product.confirmationRate < 50) {
      alerts.push({
        level: 'warning',
        scope: 'product',
        title: `Low confirmation rate on ${product.name}`,
        detail: `Only ${product.confirmationRate.toFixed(0)}% of leads are confirmed. Call-centre follow-up is leaking margin.`,
        reference: product.sku,
      });
    }
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.level] - order[b.level]);
}

export interface DashboardPayload {
  range: { since: string; until: string; days: number };
  totals: ProfitResult;
  projection: ReturnType<typeof projectPendingOutcome>;
  breakevenCpd: number;
  series: DailyPoint[];
  creatives: CreativeRow[];
  products: ProductRowMetrics[];
  alerts: Alert[];
  winners: CreativeRow[];
  losers: CreativeRow[];
}

export async function getDashboard(range: DateRange): Promise<DashboardPayload> {
  const data = await loadRangeData(range);
  const { products, orders, dailyStats, expenses } = data;

  const totalSpend = dailyStats.reduce((sum, stat) => sum + stat.spend, 0);
  const totalOpex = operationalExpenseForRange(expenses, range.days);

  // Blend product economics by delivered revenue so portfolio-level breakeven
  // reflects the mix actually being sold, not a flat average of the catalogue.
  const revenueWeights = new Map<string, number>();
  for (const order of orders) {
    if (order.orderStatus !== 'DELIVERED') continue;
    revenueWeights.set(order.productId, (revenueWeights.get(order.productId) ?? 0) + order.saleAmount);
  }
  if (revenueWeights.size === 0) {
    for (const order of orders) {
      revenueWeights.set(order.productId, (revenueWeights.get(order.productId) ?? 0) + 1);
    }
  }
  const blended = blendEconomics(products, revenueWeights);

  const totals = calculateProfit({
    orders: orders.map(toOrderInput),
    economics: blended,
    adSpend: totalSpend,
    operationalExpenses: totalOpex,
  });

  const [creatives, productMetrics] = await Promise.all([
    getCreativePerformance(range, data),
    getProductPerformance(range, data),
  ]);

  const scored = creatives.filter((creative) => creative.spend > 0);

  return {
    range: { since: toIsoDate(range.since), until: toIsoDate(range.until), days: range.days },
    totals,
    projection: projectPendingOutcome(totals, blended),
    breakevenCpd: breakevenCostPerDelivered(blended),
    series: buildDailySeries(range, data),
    creatives,
    products: productMetrics,
    alerts: buildAlerts(creatives, productMetrics),
    winners: scored.filter((creative) => creative.status === 'PROFITABLE').slice(0, 5),
    losers: [...scored].filter((creative) => creative.status === 'LOSS').reverse().slice(0, 5),
  };
}

export { breakevenStatus };
