import type { Metadata } from 'next';
import Link from 'next/link';
import { getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { requireSession } from '@/lib/auth/server';
import { formatMoney, signedAmountMinor } from '@/lib/money';
import { AppHeader } from '../app-header';

export const metadata: Metadata = { title: 'Ledger · Tenant Ledger' };

export default async function DashboardPage() {
  const session = await requireSession();
  const { entries, totals } = await withTenant(getDb(), session.organisationId, async (ledger) => ({
    entries: await ledger.list(),
    totals: await ledger.totals(),
  }));

  return (
    <>
      <AppHeader session={session} />
      <main className="page">
        <h1>Ledger</h1>

        <section className="totals" aria-label="Net totals">
          {totals.map((total) => (
            <div key={total.currency} className="card">
              <span className="muted">Net {total.currency}</span>
              <strong>{formatMoney(total.netMinor, total.currency)}</strong>
            </div>
          ))}
        </section>

        {entries.length === 0 ? (
          <p className="muted">No ledger entries yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.occurredAt.toISOString().slice(0, 10)}</td>
                    <td>
                      <Link href={`/entries/${entry.id}`}>{entry.description || 'Untitled'}</Link>
                    </td>
                    <td>{entry.kind}</td>
                    <td className="num">{formatMoney(signedAmountMinor(entry), entry.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
