import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { members, organisations, sessions, type Member } from '@/db/schema';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'tl_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  memberId: string;
  memberName: string;
  email: string;
  organisationId: string;
  organisationName: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Database,
  memberId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash: hashToken(token), memberId, expiresAt });
  return { token, expiresAt };
}

/** The organisation comes from the member row, never from anything the client sends. */
export async function resolveSession(
  db: Database,
  token: string | undefined,
): Promise<SessionContext | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      memberId: members.id,
      memberName: members.name,
      email: members.email,
      organisationId: organisations.id,
      organisationName: organisations.name,
    })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .innerJoin(organisations, eq(organisations.id, members.organisationId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export async function destroySession(db: Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

let dummyHash: Promise<string> | undefined;

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<Member | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.email, email.trim().toLowerCase()))
    .limit(1);
  // Hash even when the email is unknown so response time does not reveal which emails exist.
  dummyHash ??= hashPassword('not-a-real-password');
  const valid = await verifyPassword(password, member?.passwordHash ?? (await dummyHash));
  return member && valid ? member : null;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  };
}
