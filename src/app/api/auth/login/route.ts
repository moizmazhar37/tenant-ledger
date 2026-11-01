import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import {
  authenticate,
  createSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = form.get('email');
  const password = form.get('password');

  const db = getDb();
  const member =
    typeof email === 'string' && typeof password === 'string'
      ? await authenticate(db, email, password)
      : null;

  if (!member) {
    return NextResponse.redirect(new URL('/login?error=invalid', request.url), 303);
  }

  const { token, expiresAt } = await createSession(db, member.id);
  const response = NextResponse.redirect(new URL('/dashboard', request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return response;
}
