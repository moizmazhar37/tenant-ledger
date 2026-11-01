import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { requireSession } from '@/lib/auth/server';
import { formatMoney, signedAmountMinor } from '@/lib/money';
import { AppHeader } from '../../app-header';

export const metadata: Metadata = { title: 'Entry · Tenant Ledger' };

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const entry = await withTenant(getDb(), session.organisationId, (ledger) => ledger.findById(id));
  if (!entry) notFound();

  return (
    <>
      <AppHeader session={session} />
      <main className="page">
        <p>
          <Link href="/dashboard">← Back to ledger</Link>
        </p>
        <h1>{entry.description || 'Ledger entry'}</h1>
        <dl className="details">
          <dt>Amount</dt>
          <dd>{formatMoney(signedAmountMinor(entry), entry.currency)}</dd>
          <dt>Type</dt>
          <dd>{entry.kind}</dd>
          <dt>Occurred</dt>
          <dd>{entry.occurredAt.toISOString()}</dd>
          <dt>Received</dt>
          <dd>{entry.receivedAt.toISOString()}</dd>
          <dt>Provider event</dt>
          <dd>
            <code>{entry.providerEventId}</code>
          </dd>
          <dt>Entry id</dt>
          <dd>
            <code>{entry.id}</code>
          </dd>
        </dl>
      </main>
    </>
  );
}
