import type { LedgerEntry } from '@/db/schema';

/** The public shape of a ledger entry. Dates are ISO strings so the JSON is unambiguous. */
export function serializeEntry(entry: LedgerEntry) {
  return {
    id: entry.id,
    organisationId: entry.organisationId,
    providerEventId: entry.providerEventId,
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    description: entry.description,
    occurredAt: entry.occurredAt.toISOString(),
    receivedAt: entry.receivedAt.toISOString(),
  };
}

export type SerializedEntry = ReturnType<typeof serializeEntry>;
