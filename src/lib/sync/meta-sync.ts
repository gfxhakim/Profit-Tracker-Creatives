import { prisma } from '@/lib/db';
import { toIsoDate, type DateRange } from '@/lib/dates';
import {
  fetchAdInsights,
  fetchAds,
  fetchCampaigns,
  metaBudgetToMajor,
  metaNumber,
  resolveUtmContent,
} from '@/lib/meta';

/**
 * Pulls Meta campaigns, ads and day-level insights into the local schema.
 *
 * A campaign can only be stored once it is mapped to a product, because the
 * profit engine has no economics without one. Unmapped campaigns are reported
 * back so the operator can map them in the UI rather than failing the sync.
 */

export interface MetaSyncResult {
  campaignsSynced: number;
  creativesSynced: number;
  insightRowsSynced: number;
  spendTotal: number;
  unmappedCampaigns: { id: string; name: string }[];
  range: { since: string; until: string };
}

export async function syncMeta(range: DateRange): Promise<MetaSyncResult> {
  const log = await prisma.syncLog.create({ data: { source: 'META', status: 'RUNNING' } });

  try {
    const [campaigns, ads] = await Promise.all([fetchCampaigns(), fetchAds()]);

    const existingCampaigns = await prisma.campaign.findMany({ select: { id: true, productId: true } });
    const mappedProductByCampaign = new Map(existingCampaigns.map((row) => [row.id, row.productId]));

    // A single-product store can adopt new campaigns automatically; with a
    // catalogue, mapping is a human decision.
    const products = await prisma.product.findMany({ select: { id: true }, take: 2 });
    const fallbackProductId = products.length === 1 ? products[0].id : null;

    const unmappedCampaigns: { id: string; name: string }[] = [];
    let campaignsSynced = 0;

    for (const campaign of campaigns) {
      const productId = mappedProductByCampaign.get(campaign.id) ?? fallbackProductId;
      if (!productId) {
        unmappedCampaigns.push({ id: campaign.id, name: campaign.name });
        continue;
      }

      const dailyBudget = metaBudgetToMajor(campaign.daily_budget);
      await prisma.campaign.upsert({
        where: { id: campaign.id },
        create: {
          id: campaign.id,
          name: campaign.name,
          adAccountId: campaign.account_id ? `act_${campaign.account_id}` : (process.env.META_AD_ACCOUNT_ID ?? ''),
          adAccountName: null,
          pixelId: campaign.promoted_object?.pixel_id ?? '',
          dailyBudget,
          status: campaign.status,
          productId,
        },
        update: {
          name: campaign.name,
          dailyBudget,
          status: campaign.status,
          ...(campaign.promoted_object?.pixel_id ? { pixelId: campaign.promoted_object.pixel_id } : {}),
        },
      });
      mappedProductByCampaign.set(campaign.id, productId);
      campaignsSynced += 1;
    }

    let creativesSynced = 0;
    for (const ad of ads) {
      if (!mappedProductByCampaign.has(ad.campaign_id)) continue;

      const utmContent = resolveUtmContent(ad);
      // utmContent is unique; if another ad already claims this tag, keep the
      // ad id as a guaranteed-unique fallback rather than dropping the ad.
      const claimed = await prisma.adCreative.findUnique({ where: { utmContent } });
      const safeUtmContent = !claimed || claimed.adId === ad.id ? utmContent : ad.id;

      await prisma.adCreative.upsert({
        where: { adId: ad.id },
        create: {
          adId: ad.id,
          adName: ad.name,
          adSetName: ad.adset?.name ?? null,
          campaignId: ad.campaign_id,
          utmContent: safeUtmContent,
          thumbnailUrl: ad.creative?.thumbnail_url ?? null,
          status: ad.status,
          lastSyncedAt: new Date(),
        },
        update: {
          adName: ad.name,
          adSetName: ad.adset?.name ?? null,
          campaignId: ad.campaign_id,
          utmContent: safeUtmContent,
          thumbnailUrl: ad.creative?.thumbnail_url ?? null,
          status: ad.status,
          lastSyncedAt: new Date(),
        },
      });
      creativesSynced += 1;
    }

    const insights = await fetchAdInsights({ since: toIsoDate(range.since), until: toIsoDate(range.until) });
    const knownAdIds = new Set(
      (await prisma.adCreative.findMany({ select: { adId: true } })).map((row) => row.adId),
    );

    let insightRowsSynced = 0;
    let spendTotal = 0;
    const lifetimeSpend = new Map<string, number>();

    for (const insight of insights) {
      if (!knownAdIds.has(insight.ad_id)) continue;
      const spend = metaNumber(insight.spend);
      const date = new Date(`${insight.date_start}T00:00:00.000Z`);

      await prisma.adCreativeDailyStat.upsert({
        where: { adId_date: { adId: insight.ad_id, date } },
        create: {
          adId: insight.ad_id,
          date,
          spend,
          impressions: Math.round(metaNumber(insight.impressions)),
          clicks: Math.round(metaNumber(insight.clicks)),
          reach: Math.round(metaNumber(insight.reach)),
        },
        update: {
          spend,
          impressions: Math.round(metaNumber(insight.impressions)),
          clicks: Math.round(metaNumber(insight.clicks)),
          reach: Math.round(metaNumber(insight.reach)),
        },
      });

      lifetimeSpend.set(insight.ad_id, (lifetimeSpend.get(insight.ad_id) ?? 0) + spend);
      spendTotal += spend;
      insightRowsSynced += 1;
    }

    // `totalSpend` mirrors the sum of stored daily rows so the two never drift.
    for (const adId of lifetimeSpend.keys()) {
      const aggregate = await prisma.adCreativeDailyStat.aggregate({
        where: { adId },
        _sum: { spend: true },
      });
      await prisma.adCreative.update({
        where: { adId },
        data: { totalSpend: aggregate._sum.spend ?? 0 },
      });
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: unmappedCampaigns.length > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsRead: campaigns.length + ads.length + insights.length,
        recordsWritten: campaignsSynced + creativesSynced + insightRowsSynced,
        message:
          unmappedCampaigns.length > 0
            ? `${unmappedCampaigns.length} campaign(s) need a product mapping`
            : null,
        finishedAt: new Date(),
      },
    });

    return {
      campaignsSynced,
      creativesSynced,
      insightRowsSynced,
      spendTotal: Math.round(spendTotal * 100) / 100,
      unmappedCampaigns,
      range: { since: toIsoDate(range.since), until: toIsoDate(range.until) },
    };
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        finishedAt: new Date(),
      },
    });
    throw error;
  }
}
