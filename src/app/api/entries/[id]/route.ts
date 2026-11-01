import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { resolveSession, SESSION_COOKIE } from '@/lib/auth/session';
import { serializeEntry } from '@/lib/entries';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const session = await resolveSession(db, request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const { id } = await context.params;
  const entry = await withTenant(db, session.organisationId, (ledger) => ledger.findById(id));

  // Another organisation's entry and a nonexistent one get the same answer, so the
  // response does not confirm that an id exists elsewhere.
  if (!entry) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ entry: serializeEntry(entry) });
}
