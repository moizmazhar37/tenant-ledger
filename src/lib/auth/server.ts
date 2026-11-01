import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '@/db/client';
import { resolveSession, SESSION_COOKIE, type SessionContext } from './session';

/** For server components. Cached so a page and its layout share one lookup per request. */
export const currentSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(getDb(), token);
});

export async function requireSession(): Promise<SessionContext> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}
