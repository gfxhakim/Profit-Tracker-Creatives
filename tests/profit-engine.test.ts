import { describe, expect, it } from 'vitest';
import {
  breakevenCostPerDelivered,
  breakevenStatus,
  calculateProfit,
  countStatuses,
  dailyExpenseAmount,
  operationalExpenseForRange,
  projectPendingOutcome,
  rankCreatives,
  type OrderInput,
  type ProductEconomics,
} from '@/lib/profit-engine';

const economics: ProductEconomics = {
  cogsUnitPrice: 85,
  sellingPrice: 349,
  rates: { confirmationFee: 6, deliveryFee: 32, returnFee: 18, codGatewayFeePercent: 3 },
};

const order = (status: OrderInput['status'], saleAmount = 349, quantity = 1): OrderInput => ({
  status,
  saleAmount,
  quantity,
});

describe('breakevenCostPerDelivered', () => {
  it('is price minus goods, confirmation, delivery and gateway fees', () => {
    // 349 - 85 - 6 - 32 - (349 * 3%) = 215.53
    expect(breakevenCostPerDelivered(economics)).toBe(215.53);
  });

  it('scales with units in a multi-unit order', () => {
    const twoUnits = breakevenCostPerDelivered(economics, 2);
    expect(twoUnits).toBe(349 * 2 - 85 * 2 - 6 - 32 - 349 * 2 * 0.03);
  });

  it('goes negative when goods and fees exceed the price', () => {
    expect(breakevenCostPerDelivered({ ...economics, cogsUnitPrice: 400 })).toBeLessThan(0);
  });
});

describe('countStatuses', () => {
  it('counts confirmed cumulatively across downstream statuses', () => {
    const counts = countStatuses([
      order('NEW'),
      order('CONFIRMED'),
      order('SHIPPED'),
      order('DELIVERED'),
      order('RETURNED'),
      order('CANCELLED'),
    ]);

    expect(counts.total).toBe(6);
    // CONFIRMED + SHIPPED + DELIVERED + RETURNED
    expect(counts.confirmedCumulative).toBe(4);
    expect(counts.pending).toBe(3);
  });
});

describe('calculateProfit', () => {
  it('recognises revenue on delivery only', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('CONFIRMED'), order('SHIPPED')],
      economics,
      adSpend: 0,
    });

    expect(result.revenue).toBe(349);
  });

  it('charges confirmation fees on every confirmed order, not just delivered ones', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('RETURNED'), order('CANCELLED'), order('NEW')],
      economics,
      adSpend: 0,
    });

    // DELIVERED + RETURNED cleared confirmation; CANCELLED and NEW did not.
    expect(result.costs.confirmationFees).toBe(12);
    expect(result.costs.deliveryFees).toBe(32);
    expect(result.costs.returnFees).toBe(18);
  });

  it('charges goods only on delivered units, since returns come back to stock', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('RETURNED')],
      economics,
      adSpend: 0,
    });

    expect(result.costs.cogs).toBe(85);
  });

  it('computes true CPD as ad spend over delivered orders', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('DELIVERED'), order('CANCELLED')],
      economics,
      adSpend: 300,
    });

    expect(result.perOrder.trueCostPerDelivered).toBe(150);
    expect(result.perOrder.costPerLead).toBe(100);
  });

  it('nets out every cost line', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('DELIVERED'), order('RETURNED')],
      economics,
      adSpend: 200,
      operationalExpenses: 50,
    });

    const revenue = 698;
    const expected =
      revenue - 200 - 85 * 2 - 6 * 3 - 32 * 2 - 18 - revenue * 0.03 - 50;
    expect(result.revenue).toBe(revenue);
    expect(result.netProfit).toBeCloseTo(expected, 2);
  });

  it('reports a loss when true CPD passes breakeven CPD', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('CANCELLED'), order('CANCELLED')],
      economics,
      adSpend: 400,
    });

    expect(result.perOrder.trueCostPerDelivered).toBe(400);
    expect(result.status).toBe('LOSS');
    expect(result.netProfit).toBeLessThan(0);
  });

  it('warns before the loss, inside the 85% band', () => {
    // Breakeven CPD is 215.53; 200 sits above 85% of it.
    const result = calculateProfit({ orders: [order('DELIVERED')], economics, adSpend: 200 });
    expect(result.status).toBe('WARNING');
  });

  it('handles an empty period without dividing by zero', () => {
    const result = calculateProfit({ orders: [], economics, adSpend: 0 });

    expect(result.revenue).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.perOrder.trueCostPerDelivered).toBe(0);
    expect(result.roas).toBe(0);
    expect(result.status).toBe('NO_DATA');
  });
});

describe('breakevenStatus', () => {
  it('is a loss once spend passes one order of margin with nothing delivered', () => {
    expect(
      breakevenStatus({ delivered: 0, adSpend: 500, trueCostPerDelivered: 0, breakevenCpd: 215.53 }),
    ).toBe('LOSS');
  });

  it('is only a warning while spend is still below one order of margin', () => {
    expect(
      breakevenStatus({ delivered: 0, adSpend: 100, trueCostPerDelivered: 0, breakevenCpd: 215.53 }),
    ).toBe('WARNING');
  });

  it('is a loss when the product cannot be sold profitably at any CPD', () => {
    expect(
      breakevenStatus({ delivered: 3, adSpend: 10, trueCostPerDelivered: 3.3, breakevenCpd: -12 }),
    ).toBe('LOSS');
  });
});

describe('projectPendingOutcome', () => {
  it('extrapolates in-flight orders at the observed delivery rate', () => {
    const result = calculateProfit({
      orders: [order('DELIVERED'), order('CANCELLED'), order('CONFIRMED'), order('CONFIRMED')],
      economics,
      adSpend: 100,
    });
    const projection = projectPendingOutcome(result, economics);

    expect(projection.pendingOrders).toBe(2);
    expect(projection.observedDeliveryRate).toBe(50);
    expect(projection.projectedDeliveries).toBe(1);
    expect(projection.projectedNetProfit).toBeGreaterThan(result.netProfit);
  });
});

describe('operating expenses', () => {
  it('converts each billing cycle to a daily rate', () => {
    expect(dailyExpenseAmount(70, 'Weekly', 7)).toBe(10);
    expect(dailyExpenseAmount(300, 'Monthly', 30)).toBe(10);
    expect(dailyExpenseAmount(3650, 'Yearly', 30)).toBe(10);
    expect(dailyExpenseAmount(10, 'Daily', 30)).toBe(10);
  });

  it('spreads a one-time cost across the window being reported', () => {
    expect(dailyExpenseAmount(140, 'One-time', 7)).toBe(20);
  });

  it('totals a mixed expense list over a range', () => {
    const total = operationalExpenseForRange(
      [
        { amount: 300, billingCycle: 'Monthly' },
        { amount: 70, billingCycle: 'Weekly' },
      ],
      7,
    );
    expect(total).toBe(140);
  });

  it('ignores an unrecognised billing cycle rather than guessing', () => {
    expect(dailyExpenseAmount(100, 'Fortnightly', 30)).toBe(0);
  });
});

describe('rankCreatives', () => {
  it('sorts by profit, breaking ties on the cheaper true CPD', () => {
    const ranked = rankCreatives([
      { netProfit: 100, trueCostPerDelivered: 50 },
      { netProfit: 400, trueCostPerDelivered: 90 },
      { netProfit: 100, trueCostPerDelivered: 20 },
    ]);

    expect(ranked.map((row) => row.trueCostPerDelivered)).toEqual([90, 20, 50]);
  });
});
