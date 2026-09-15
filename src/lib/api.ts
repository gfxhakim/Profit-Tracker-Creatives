import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { MissingEnvError } from '@/lib/env';
import { getSession } from '@/lib/auth';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Maps known error shapes onto honest status codes instead of a blanket 500. */
export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return fail('Validation failed', 422, { issues: error.issues });
  }
  if (error instanceof MissingEnvError) {
    return fail(error.message, 503, { missing: error.keys });
  }
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    return fail(error.message, typeof status === 'number' && status >= 400 && status < 600 ? status : 500);
  }
  return fail('Unexpected error', 500);
}

/**
 * Sync endpoints run both from the UI (session cookie) and from a scheduler
 * (CRON_SECRET bearer token), so either credential is accepted.
 */
export async function assertSyncAuthorized(request: Request): Promise<Response | null> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get('authorization') ?? '';
    const provided = header.replace(/^Bearer\s+/i, '');
    if (provided && provided === cronSecret) return null;
  }

  const session = await getSession();
  if (session) return null;

  return fail('Unauthorized', 401);
}

export async function assertSession(): Promise<Response | null> {
  const session = await getSession();
  return session ? null : fail('Unauthorized', 401);
}
