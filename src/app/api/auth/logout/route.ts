import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { destroySession, SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  await destroySession(getDb(), request.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
