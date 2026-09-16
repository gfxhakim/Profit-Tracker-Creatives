import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

// A standalone tsx run loads no env file on its own, and the Prisma CLI reads
// only `.env`. Load both, preferring `.env.local`, so the seed works either way.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

/**
 * Seeds the first dashboard user, plus a demo product/campaign/creative set and
 * a spread of orders so the dashboard has something real to render before any
 * integration has run. Everything is idempotent: re-running updates in place.
 */

const prisma = new PrismaClient();

const DEMO_PREFIX = 'demo-';
const DAY_MS = 86_400_000;

async function seedAdminUser() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now';

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Administrator', passwordHash: await hashPassword(password), role: 'ADMIN' },
    update: {},
  });

  console.log(`✔ admin user ready: ${user.email}`);
  if (password === 'change-me-now') {
    console.warn('  ! using the default password - set SEED_ADMIN_PASSWORD before deploying');
  }
}

async function seedDemoData() {
  if (process.env.SEED_DEMO_DATA === 'false') {
    console.log('· demo data skipped (SEED_DEMO_DATA=false)');
    return;
  }

  // Re-seeding must be deterministic: drop the previous demo rows so a changed
  // order count cannot leave orphans behind and skew the numbers.
  await prisma.order.deleteMany({ where: { shopifyOrderId: { startsWith: DEMO_PREFIX } } });

  const product = await prisma.product.upsert({
    where: { sku: 'DEMO-WATCH-01' },
    create: {
      name: 'Chrono Steel Watch',
      sku: 'DEMO-WATCH-01',
      cogsUnitPrice: 85,
      batchQuantity: 500,
      productionLeadTimeDays: 14,
      sellingPrice: 349,
      deadStockUnits: 6,
      fulfillmentRates: {
        create: { confirmationFee: 6, deliveryFee: 32, returnFee: 18, codGatewayFeePercent: 3 },
      },
    },
    update: {},
  });

  const campaign = await prisma.campaign.upsert({
    where: { id: `${DEMO_PREFIX}campaign-1` },
    create: {
      id: `${DEMO_PREFIX}campaign-1`,
      name: 'Chrono Watch — Prospecting',
      adAccountId: process.env.META_AD_ACCOUNT_ID ?? 'act_000000000000000',
      adAccountName: 'Demo Ad Account',
      pixelId: '000000000000000',
      dailyBudget: 400,
      status: 'ACTIVE',
      productId: product.id,
    },
    update: { productId: product.id },
  });

  // Three creatives with deliberately different economics: a clear winner, a
  // borderline case and a loser, so every alert path has something to show.
  const creatives = [
    { adId: `${DEMO_PREFIX}ad-winner`, adName: 'UGC unboxing 15s', dailySpend: 180, leadsPerDay: 9, deliveryRate: 0.62 },
    { adId: `${DEMO_PREFIX}ad-middle`, adName: 'Studio product spin', dailySpend: 140, leadsPerDay: 5, deliveryRate: 0.5 },
    { adId: `${DEMO_PREFIX}ad-loser`, adName: 'Static discount banner', dailySpend: 300, leadsPerDay: 2, deliveryRate: 0.25 },
  ];

  const today = new Date();
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let orderSequence = 0;

  for (const creative of creatives) {
    await prisma.adCreative.upsert({
      where: { adId: creative.adId },
      create: {
        adId: creative.adId,
        adName: creative.adName,
        adSetName: 'Broad 25-55',
        campaignId: campaign.id,
        utmContent: creative.adId,
        status: 'ACTIVE',
        lastSyncedAt: new Date(),
      },
      update: { adName: creative.adName, campaignId: campaign.id },
    });

    for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
      const date = new Date(startOfToday.getTime() - dayOffset * DAY_MS);
      // Deterministic wobble keeps the charts from looking like flat lines.
      const wobble = 0.8 + ((dayOffset * 7) % 5) / 10;
      const spend = Math.round(creative.dailySpend * wobble * 100) / 100;

      await prisma.adCreativeDailyStat.upsert({
        where: { adId_date: { adId: creative.adId, date } },
        create: {
          adId: creative.adId,
          date,
          spend,
          impressions: Math.round(spend * 210),
          clicks: Math.round(spend * 3.4),
          reach: Math.round(spend * 160),
        },
        update: { spend },
      });

      const leads = Math.max(1, Math.round(creative.leadsPerDay * wobble));
      for (let index = 0; index < leads; index += 1) {
        orderSequence += 1;
        const shopifyOrderId = `${DEMO_PREFIX}order-${orderSequence}`;
        // Orders from the last two days are still settling.
        const settled = dayOffset > 1;
        const position = index / leads;
        const status = !settled
          ? position < 0.5
            ? 'CONFIRMED'
            : 'NEW'
          : position < creative.deliveryRate
            ? 'DELIVERED'
            : position < creative.deliveryRate + 0.15
              ? 'RETURNED'
              : 'CANCELLED';

        await prisma.order.upsert({
          where: { shopifyOrderId },
          create: {
            shopifyOrderId,
            orderNumber: `#${1000 + orderSequence}`,
            mdmOrderId: settled ? `MDM-${orderSequence}` : null,
            customerPhone: `+2126${String(10_000_000 + orderSequence).slice(0, 8)}`,
            customerCity: ['Casablanca', 'Rabat', 'Marrakech', 'Tanger'][orderSequence % 4],
            productId: product.id,
            quantity: 1,
            adId: creative.adId,
            utmContent: creative.adId,
            orderStatus: status,
            saleAmount: product.sellingPrice,
            createdAt: new Date(date.getTime() + index * 3_600_000),
            ...(status === 'DELIVERED' ? { deliveredAt: new Date(date.getTime() + 2 * DAY_MS) } : {}),
            ...(status === 'RETURNED' ? { returnedAt: new Date(date.getTime() + 3 * DAY_MS) } : {}),
          },
          update: { orderStatus: status },
        });
      }
    }
  }

  const expenses = [
    { category: 'AI Tool', name: 'Creative generation suite', planDetails: 'Pro', amount: 90, billingCycle: 'Monthly' },
    { category: 'Employee Payroll', name: 'Call centre agent', planDetails: 'Full time', amount: 3200, billingCycle: 'Monthly' },
    { category: 'Additional Fee', name: 'Shopify plan', planDetails: 'Basic', amount: 32, billingCycle: 'Monthly' },
  ];

  for (const expense of expenses) {
    const existing = await prisma.operationalExpense.findFirst({ where: { name: expense.name } });
    if (existing) {
      await prisma.operationalExpense.update({ where: { id: existing.id }, data: expense });
    } else {
      await prisma.operationalExpense.create({ data: expense });
    }
  }

  console.log(`✔ demo data ready: 1 product, ${creatives.length} creatives, ${orderSequence} orders`);
}

async function main() {
  await seedAdminUser();
  await seedDemoData();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
