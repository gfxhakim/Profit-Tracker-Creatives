/**
 * Stateless session tokens, HMAC-SHA256 signed with NEXTAUTH_SECRET.
 *
 * This module deliberately uses only Web Crypto and no Next.js server APIs, so
 * the identical verification runs in the Edge runtime (middleware) and the Node
 * runtime (route handlers, server components).
 */

export const SESSION_COOKIE = 'cod_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  role: string;
  exp: number;
}

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error('NEXTAUTH_SECRET must be set to at least 16 characters');
  }
  return value;
}

async function hmacKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

export async function createSessionToken(
  payload: Omit<SessionPayload, 'exp'>,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  const body: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(body)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(['sign']), encoder.encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(['verify']),
      fromBase64Url(signature),
      encoder.encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};
