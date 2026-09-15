import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from '@/lib/session';

/**
 * Node-runtime session access for route handlers and server components.
 * Edge code (middleware) must import from `@/lib/session` instead.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export { SESSION_COOKIE, createSessionToken, verifySessionToken, sessionCookieOptions } from '@/lib/session';
export type { SessionPayload } from '@/lib/session';
