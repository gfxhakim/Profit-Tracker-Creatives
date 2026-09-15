/**
 * COD unit-economics engine.
 *
 * Pure functions only - no database, no network - so the maths can be unit
 * tested and reused by API routes, server components and background syncs.
 *
 * Accounting model (Cash On Delivery):
 *  - Revenue is recognised on DELIVERY only. A confirmed-but-undelivered order
 *    has collected nothing.
 *  - COGS is charged on delivered units. Units on returned orders come back to
 *    stock, so they cost a return fee rather than their goods value. Stock that
 *    never comes back is tracked separately as `deadStockUnits`.
 *  - Call-centre confirmation fees are charged on every confirmed order, whether
 *    or not it eventually delivers.
 *  - Delivery fees are charged on delivered orders, return fees on returned ones.
 *  - The COD gateway takes a percentage of cash actually collected.
 */

export const ORDER_STATUSES = [
  'NEW',
  'CONFIRMED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that have passed call-centre confirmation (fee already incurred). */
export const CONFIRMED_STATUSES: OrderStatus[] = ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
/** Statuses whose financial outcome is not yet known. */
export const PENDING_STATUSES: OrderStatus[] = ['NEW', 'CONFIRMED', 'SHIPPED'];

export interface FulfillmentRates {
  confirmationFee: number;
  deliveryFee: number;
  returnFee: number;
  /** Percentage, e.g. 5 means 5% of collected cash. */
  codGatewayFeePercent: number;
}

export interface ProductEconomics {
  cogsUnitPrice: number;
  sellingPrice: number;
  rates: FulfillmentRates;
}

export interface OrderInput {
  status: OrderStatus;
  saleAmount: number;
  quantity: number;
}

export interface StatusCounts {
  total: number;
  new: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  returned: number;
  /** Orders that cleared confirmation, including those later shipped/delivered/returned. */
  confirmedCumulative: number;
  /** Orders still awaiting a final delivered/returned/cancelled outcome. */
  pending: number;
}

export interface CostBreakdown {
  adSpend: number;
  cogs: number;
  confirmationFees: number;
  deliveryFees: number;
  returnFees: number;
  codGatewayFees: number;
  operationalExpenses: number;
  total: number;
}

export interface ProfitResult {
  counts: StatusCounts;
  units: { delivered: number; returned: number };
  revenue: number;
  costs: CostBreakdown;
  netProfit: number;
  /** Profit before ad spend and shared operating expenses. */
  contributionMargin: number;
  margins: {
    /** Net profit as a share of collected revenue. */
    netMarginPercent: number;
    contributionMarginPercent: number;
  };
  rates: {
    confirmationRate: number;
    deliveryRateOnConfirmed: number;
    deliveryRateOnLeads: number;
    returnRate: number;
    cancellationRate: number;
  };
  perOrder: {
    aov: number;
    costPerLead: number;
    /** Headline metric: ad spend divided by orders actually delivered. */
    trueCostPerDelivered: number;
    profitPerDelivered: number;
  };
  breakeven: {
    /** Maximum affordable ad spend per delivered order before losing money. */
    cpd: number;
    roas: number;
    /** Leads needed to break even at the observed delivery rate and margin. */
    ordersToBreakEven: number | null;
  };
  roas: number;
  status: BreakevenStatus;
}

export type BreakevenStatus = 'PROFITABLE' | 'WARNING' | 'LOSS' | 'NO_DATA';

/** True CPD above this share of breakeven CPD trips a warning before the loss. */
export const WARNING_THRESHOLD = 0.85;

const round = (value: number, dp = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const safeDiv = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

export function countStatuses(orders: OrderInput[]): StatusCounts {
  const counts: StatusCounts = {
    total: orders.length,
    new: 0,
    confirmed: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
    returned: 0,
    confirmedCumulative: 0,
    pending: 0,
  };

  for (const order of orders) {
    switch (order.status) {
      case 'NEW':
        counts.new += 1;
        break;
      case 'CONFIRMED':
        counts.confirmed += 1;
        break;
      case 'SHIPPED':
        counts.shipped += 1;
        break;
      case 'DELIVERED':
        counts.delivered += 1;
        break;
      case 'CANCELLED':
        counts.cancelled += 1;
        break;
      case 'RETURNED':
        counts.returned += 1;
        break;
    }
    if (CONFIRMED_STATUSES.includes(order.status)) counts.confirmedCumulative += 1;
    if (PENDING_STATUSES.includes(order.status)) counts.pending += 1;
  }

  return counts;
}

/**
 * Contribution margin of a single delivered order at list price: what is left
 * after goods, fulfilment and gateway fees but before ad spend. This is the
 * ceiling on what may be paid to acquire one delivered order.
 */
export function breakevenCostPerDelivered(economics: ProductEconomics, unitsPerOrder = 1): number {
  const { cogsUnitPrice, sellingPrice, rates } = economics;
  const revenue = sellingPrice * unitsPerOrder;
  const gatewayFee = revenue * (rates.codGatewayFeePercent / 100);
  return round(revenue - cogsUnitPrice * unitsPerOrder - rates.confirmationFee - rates.deliveryFee - gatewayFee);
}

export interface ProfitInput {
  orders: OrderInput[];
  economics: ProductEconomics;
  adSpend: number;
  /** Share of fixed operating costs allocated to this slice of the business. */
  operationalExpenses?: number;
}

export function calculateProfit({
  orders,
  economics,
  adSpend,
  operationalExpenses = 0,
}: ProfitInput): ProfitResult {
  const counts = countStatuses(orders);
  const { cogsUnitPrice, rates } = economics;

  let revenue = 0;
  let deliveredUnits = 0;
  let returnedUnits = 0;

  for (const order of orders) {
    if (order.status === 'DELIVERED') {
      revenue += order.saleAmount;
      deliveredUnits += order.quantity;
    } else if (order.status === 'RETURNED') {
      returnedUnits += order.quantity;
    }
  }

  const cogs = cogsUnitPrice * deliveredUnits;
  const confirmationFees = rates.confirmationFee * counts.confirmedCumulative;
  const deliveryFees = rates.deliveryFee * counts.delivered;
  const returnFees = rates.returnFee * counts.returned;
  const codGatewayFees = revenue * (rates.codGatewayFeePercent / 100);

  const costs: CostBreakdown = {
    adSpend: round(adSpend),
    cogs: round(cogs),
    confirmationFees: round(confirmationFees),
    deliveryFees: round(deliveryFees),
    returnFees: round(returnFees),
    codGatewayFees: round(codGatewayFees),
    operationalExpenses: round(operationalExpenses),
    total: round(
      adSpend + cogs + confirmationFees + deliveryFees + returnFees + codGatewayFees + operationalExpenses,
    ),
  };

  const netProfit = round(revenue - costs.total);
  const contributionMargin = round(
    revenue - cogs - confirmationFees - deliveryFees - returnFees - codGatewayFees,
  );

  const unitsPerDeliveredOrder = counts.delivered > 0 ? deliveredUnits / counts.delivered : 1;
  const breakevenCpd = breakevenCostPerDelivered(economics, unitsPerDeliveredOrder);
  const trueCostPerDelivered = round(safeDiv(adSpend, counts.delivered));

  const contributionPerDelivered = safeDiv(contributionMargin, counts.delivered);
  const deliveryRateOnLeads = safeDiv(counts.delivered, counts.total);
  const profitPerLead = contributionPerDelivered * deliveryRateOnLeads;
  const costPerLead = safeDiv(adSpend, counts.total);
  const marginPerLead = profitPerLead - costPerLead;

  return {
    counts,
    units: { delivered: deliveredUnits, returned: returnedUnits },
    revenue: round(revenue),
    costs,
    netProfit,
    contributionMargin,
    margins: {
      netMarginPercent: round(safeDiv(netProfit, revenue) * 100),
      contributionMarginPercent: round(safeDiv(contributionMargin, revenue) * 100),
    },
    rates: {
      confirmationRate: round(safeDiv(counts.confirmedCumulative, counts.total) * 100),
      deliveryRateOnConfirmed: round(safeDiv(counts.delivered, counts.confirmedCumulative) * 100),
      deliveryRateOnLeads: round(deliveryRateOnLeads * 100),
      returnRate: round(safeDiv(counts.returned, counts.delivered + counts.returned) * 100),
      cancellationRate: round(safeDiv(counts.cancelled, counts.total) * 100),
    },
    perOrder: {
      aov: round(safeDiv(revenue, counts.delivered)),
      costPerLead: round(costPerLead),
      trueCostPerDelivered,
      profitPerDelivered: round(safeDiv(netProfit, counts.delivered)),
    },
    breakeven: {
      cpd: breakevenCpd,
      roas: round(safeDiv(1, safeDiv(contributionMargin, revenue))),
      ordersToBreakEven:
        marginPerLead > 0 ? Math.ceil(safeDiv(operationalExpenses, marginPerLead)) : null,
    },
    roas: round(safeDiv(revenue, adSpend)),
    status: breakevenStatus({
      delivered: counts.delivered,
      adSpend,
      trueCostPerDelivered,
      breakevenCpd,
    }),
  };
}

export function breakevenStatus({
  delivered,
  adSpend,
  trueCostPerDelivered,
  breakevenCpd,
}: {
  delivered: number;
  adSpend: number;
  trueCostPerDelivered: number;
  breakevenCpd: number;
}): BreakevenStatus {
  if (adSpend <= 0 && delivered === 0) return 'NO_DATA';
  // Spending with nothing delivered yet is a loss the moment spend exceeds the
  // price of a single delivered order.
  if (delivered === 0) return adSpend > breakevenCpd ? 'LOSS' : 'WARNING';
  if (breakevenCpd <= 0) return 'LOSS';
  if (trueCostPerDelivered > breakevenCpd) return 'LOSS';
  if (trueCostPerDelivered > breakevenCpd * WARNING_THRESHOLD) return 'WARNING';
  return 'PROFITABLE';
}

/**
 * Projected outcome for orders still in flight, using the observed delivery
 * rate of settled orders. Answers "where does this creative land if pending
 * orders behave like the ones already settled?".
 */
export function projectPendingOutcome(result: ProfitResult, economics: ProfitInput['economics']) {
  const settled = result.counts.delivered + result.counts.returned + result.counts.cancelled;
  const observedDeliveryRate = settled > 0 ? result.counts.delivered / settled : 0;
  const projectedDeliveries = result.counts.pending * observedDeliveryRate;
  const contributionPerDelivered = breakevenCostPerDelivered(economics);
  const projectedContribution = projectedDeliveries * contributionPerDelivered;

  return {
    pendingOrders: result.counts.pending,
    observedDeliveryRate: round(observedDeliveryRate * 100),
    projectedDeliveries: round(projectedDeliveries, 1),
    projectedAdditionalProfit: round(projectedContribution),
    projectedNetProfit: round(result.netProfit + projectedContribution),
  };
}

/** Normalises a billing cycle to an equivalent daily run-rate. */
export function dailyExpenseAmount(amount: number, billingCycle: string, rangeDays: number): number {
  switch (billingCycle.toUpperCase()) {
    case 'DAILY':
      return amount;
    case 'WEEKLY':
      return amount / 7;
    case 'MONTHLY':
      return amount / 30;
    case 'YEARLY':
      return amount / 365;
    case 'ONE-TIME':
    case 'ONETIME':
      return rangeDays > 0 ? amount / rangeDays : amount;
    default:
      return 0;
  }
}

/** Total operating expense attributable to a window of `rangeDays` days. */
export function operationalExpenseForRange(
  expenses: { amount: number; billingCycle: string }[],
  rangeDays: number,
): number {
  const perDay = expenses.reduce(
    (sum, expense) => sum + dailyExpenseAmount(expense.amount, expense.billingCycle, rangeDays),
    0,
  );
  return round(perDay * rangeDays);
}

/** Ranks creatives by profitability; ties break toward the cheaper true CPD. */
export function rankCreatives<T extends { netProfit: number; trueCostPerDelivered: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    return a.trueCostPerDelivered - b.trueCostPerDelivered;
  });
}

export { round, safeDiv };
