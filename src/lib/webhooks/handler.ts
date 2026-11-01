import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { organisations, type LedgerEntry } from '@/db/schema';
import { withTenant, type NewEntryFromEvent } from '@/db/tenant';
import { parseEvent, toLedgerEntry } from './event';
import { verifySignature } from './signature';

export type WebhookOutcome =
  | { status: 201; body: { status: 'created'; entryId: string } }
  | { status: 200; body: { status: 'duplicate'; entryId: string } }
  | { status: 200; body: { status: 'ignored'; reason: 'unsupported_event_type' } }
  | { status: 400; body: { error: 'malformed_json' } }
  | { status: 400; body: { error: 'invalid_payload'; issues: string[] } }
  | { status: 401; body: { error: 'invalid_signature' } }
  | { status: 409; body: { error: 'event_conflict' } }
  | { status: 422; body: { error: 'unknown_account' } };

/**
 * Response codes are chosen for the provider's retry semantics: 2xx stops retries, 4xx
 * marks a delivery we will never accept, and an unexpected error propagates as a 500 so
 * the provider retries it.
 */
export async function handlePaymentWebhook(input: {
  db: Database;
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
  now?: Date;
}): Promise<WebhookOutcome> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const signature = verifySignature({
    secret: input.secret,
    body: input.rawBody,
    header: input.signatureHeader,
    nowSeconds,
  });
  if (!signature.ok) return { status: 401, body: { error: 'invalid_signature' } };

  const parsed = parseEvent(input.rawBody);
  switch (parsed.kind) {
    case 'malformed_json':
      return { status: 400, body: { error: 'malformed_json' } };
    case 'invalid':
      return { status: 400, body: { error: 'invalid_payload', issues: parsed.issues } };
    case 'unsupported':
      return { status: 200, body: { status: 'ignored', reason: 'unsupported_event_type' } };
  }

  const { event } = parsed;
  const [organisation] = await input.db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.providerAccountId, event.data.account_id))
    .limit(1);
  if (!organisation) return { status: 422, body: { error: 'unknown_account' } };

  const entry = toLedgerEntry(event);
  return withTenant(input.db, organisation.id, async (ledger): Promise<WebhookOutcome> => {
    const inserted = await ledger.insertIfAbsent(entry);
    if (inserted) return { status: 201, body: { status: 'created', entryId: inserted.id } };

    // The unique constraint rejected the insert. Treat it as a redelivery only if the
    // stored entry, visible to this tenant, records the same money movement.
    const existing = await ledger.findByProviderEventId(event.id);
    if (existing && recordsSameMovement(existing, entry)) {
      return { status: 200, body: { status: 'duplicate', entryId: existing.id } };
    }
    console.warn(
      JSON.stringify({
        msg: 'webhook event id reused with different content',
        providerEventId: event.id,
        accountId: event.data.account_id,
      }),
    );
    return { status: 409, body: { error: 'event_conflict' } };
  });
}

function recordsSameMovement(existing: LedgerEntry, incoming: NewEntryFromEvent): boolean {
  return (
    existing.kind === incoming.kind &&
    existing.amountMinor === incoming.amountMinor &&
    existing.currency === incoming.currency
  );
}
