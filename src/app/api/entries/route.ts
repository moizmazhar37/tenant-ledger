import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { resolveSession, SESSION_COOKIE } from '@/lib/auth/session';
import { serializeEntry } from '@/lib/entries';

export async function GET(request: NextRequest) {
  const db = getDb();
  const session = await resolveSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const entries = await withTenant(db, session.organisationId, (ledger) => ledger.list());
  return NextResponse.json({ entries: entries.map(serializeEntry) });
}
