import { NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { createSession, SESSION_COOKIE } from '@/lib/auth/session';

export async function sessionCookieFor(memberId: string): Promise<string> {
  const { token } = await createSession(getDb(), memberId);
  return `${SESSION_COOKIE}=${token}`;
}

export function getRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    headers: cookie ? { cookie } : {},
  });
}

export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** Postgres error code from a postgres.js error, whether or not Drizzle wrapped it. */
export function postgresErrorCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}
