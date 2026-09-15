import { prisma } from '@/lib/db';
import { envSectionStatus } from '@/lib/env';
import { ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let database: { ok: boolean; message: string };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, message: 'connected' };
  } catch (error) {
    database = { ok: false, message: error instanceof Error ? error.message : 'unreachable' };
  }

  const env = {
    meta: envSectionStatus('meta'),
    mdm: envSectionStatus('mdm'),
    shopify: envSectionStatus('shopify'),
    auth: envSectionStatus('auth'),
  };

  const healthy = database.ok && Object.values(env).every((section) => section.configured);
  return ok({ status: healthy ? 'ok' : 'degraded', database, env }, { status: healthy ? 200 : 503 });
}
