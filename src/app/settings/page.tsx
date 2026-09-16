import { prisma } from '@/lib/db';
import { envSectionStatus } from '@/lib/env';
import { safeLoad } from '@/lib/safe';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SyncPanel } from './SyncPanel';
import { CampaignMapper } from './CampaignMapper';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const integrations = {
    meta: envSectionStatus('meta'),
    mdm: envSectionStatus('mdm'),
    shopify: envSectionStatus('shopify'),
  };

  // A rejected credential is the one MDM failure an operator must act on, so it
  // gets a plain-language callout rather than a line in the audit table.
  const lastMdmRun = await safeLoad(() =>
    prisma.syncLog.findFirst({ where: { source: 'MDM' }, orderBy: { startedAt: 'desc' } }),
  );
  const expiredToken =
    lastMdmRun.ok && lastMdmRun.data?.status === 'FAILED'
      ? /\b401\b/.test(lastMdmRun.data.message ?? '')
        ? '401 Unauthorized'
        : /\b403\b/.test(lastMdmRun.data.message ?? '')
          ? '403 Forbidden'
          : null
      : null;

  const loaded = await safeLoad(async () => {
    const [campaigns, products, logs] = await Promise.all([
      prisma.campaign.findMany({
        include: { product: { select: { id: true, name: true } }, _count: { select: { creatives: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.product.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }),
    ]);
    return { campaigns, products, logs };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings &amp; integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Credential health, manual syncs, campaign-to-product mapping and the sync audit trail.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['Meta Marketing API', integrations.meta, 'Ad spend and creative metadata'],
            ['MDM Express', integrations.mdm, 'Delivery and return status'],
            ['Shopify webhook', integrations.shopify, 'Order creation and attribution'],
          ] as const
        ).map(([title, state, description]) => (
          <div key={title} className="panel">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              <span className={state.configured ? 'text-xs text-profit' : 'text-xs text-loss'}>
                {state.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">{description}</p>
            {state.missing.length > 0 ? (
              <p className="mt-2 text-xs text-loss">Missing: {state.missing.join(', ')}</p>
            ) : null}
          </div>
        ))}
      </section>

      {expiredToken ? (
        <section className="panel border-loss/40">
          <h2 className="text-sm font-semibold text-loss">MDM token needs refreshing</h2>
          <p className="mt-2 text-sm text-muted">
            The last MDM sync was rejected with a {expiredToken}. The endpoint and bearer
            authentication match MDM&apos;s API reference, so the token itself is no longer valid.
            Generate a new key in the MDM dashboard, update <code className="text-accent">MDM_API_KEY</code>,
            and restart the app.
          </p>
        </section>
      ) : null}

      <SyncPanel />

      {!loaded.ok ? (
        <ErrorPanel title="Could not load campaign mapping" detail={loaded.error} />
      ) : (
        <>
          <CampaignMapper
            campaigns={loaded.data.campaigns.map((campaign) => ({
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              dailyBudget: campaign.dailyBudget,
              creativeCount: campaign._count.creatives,
              productId: campaign.product.id,
              productName: campaign.product.name,
            }))}
            products={loaded.data.products}
          />

          <section className="panel overflow-x-auto p-0">
            <h2 className="px-5 pt-5 text-sm font-semibold text-slate-100">Recent syncs</h2>
            <table className="mt-4 w-full">
              <thead>
                <tr className="border-b border-edge">
                  <th className="table-head">Source</th>
                  <th className="table-head">Status</th>
                  <th className="table-head">Read</th>
                  <th className="table-head">Written</th>
                  <th className="table-head">Started</th>
                  <th className="table-head">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {loaded.data.logs.map((log) => (
                  <tr key={log.id}>
                    <td className="table-cell font-medium text-slate-100">{log.source}</td>
                    <td className="table-cell">
                      <span
                        className={
                          log.status === 'SUCCESS'
                            ? 'text-xs text-profit'
                            : log.status === 'FAILED'
                              ? 'text-xs text-loss'
                              : 'text-xs text-warn'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="table-cell tabular-nums">{log.recordsRead}</td>
                    <td className="table-cell tabular-nums">{log.recordsWritten}</td>
                    <td className="table-cell text-muted">{formatDateTime(log.startedAt)}</td>
                    <td className="table-cell max-w-[320px] truncate text-muted" title={log.message ?? ''}>
                      {log.message ?? '—'}
                    </td>
                  </tr>
                ))}
                {loaded.data.logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-cell text-center text-muted">No syncs have run yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-100">Shopify webhook endpoint</h2>
        <p className="mt-2 text-sm text-muted">
          Register these topics in Shopify admin (Settings → Notifications → Webhooks) against:
        </p>
        <code className="mt-2 block rounded-lg border border-edge bg-ink px-3 py-2 text-xs text-accent">
          POST https://your-domain/api/webhooks/shopify
        </code>
        <p className="mt-2 text-xs text-muted">
          Topics: orders/create, orders/updated, orders/paid, orders/fulfilled, orders/cancelled. Copy the
          signing secret Shopify shows into SHOPIFY_WEBHOOK_SECRET.
        </p>
      </section>
    </div>
  );
}
