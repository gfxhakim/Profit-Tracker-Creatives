import { z } from 'zod';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from '@/lib/session';
import { verifyPassword } from '@/lib/password';
import { fail, handleError } from '@/lib/api';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { email, password } = schema.parse(await request.json());
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Same message either way: a distinct "no such user" leaks the account list.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail('Invalid email or password', 401);
    }

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      name: user.name ?? undefined,
      role: user.role,
    });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
    return response;
  } catch (error) {
    return handleError(error);
  }
}
