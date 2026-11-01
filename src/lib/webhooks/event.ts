import { z } from 'zod';
import type { NewEntryFromEvent } from '@/db/tenant';

export const SUPPORTED_EVENT_TYPES = ['payment.succeeded', 'payment.refunded'] as const;

const eventId = z.string().regex(/^evt_[A-Za-z0-9_]{1,64}$/, 'must look like evt_<id>');

// Objects are not strict: providers add fields over time and that must not break ingestion.
const paymentEventSchema = z.object({
  id: eventId,
  type: z.enum(SUPPORTED_EVENT_TYPES),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    account_id: z.string().min(1).max(64),
    amount: z.int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code'),
    description: z.string().max(500).default(''),
  }),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type ParsedEvent =
  | { kind: 'event'; event: PaymentEvent }
  | { kind: 'unsupported'; id: string; type: string }
  | { kind: 'malformed_json' }
  | { kind: 'invalid'; issues: string[] };

export function parseEvent(rawBody: string): ParsedEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { kind: 'malformed_json' };
  }

  // A well-formed event of a type we do not handle is acknowledged, not rejected,
  // otherwise the provider would retry it forever.
  const envelope = z.object({ id: eventId, type: z.string() }).safeParse(json);
  if (
    envelope.success &&
    !(SUPPORTED_EVENT_TYPES as readonly string[]).includes(envelope.data.type)
  ) {
    return { kind: 'unsupported', id: envelope.data.id, type: envelope.data.type };
  }

  const parsed = paymentEventSchema.safeParse(json);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { kind: 'event', event: parsed.data };
}

export function toLedgerEntry(event: PaymentEvent): NewEntryFromEvent {
  return {
    providerEventId: event.id,
    kind: event.type === 'payment.succeeded' ? 'payment' : 'refund',
    amountMinor: event.data.amount,
    currency: event.data.currency,
    description: event.data.description,
    occurredAt: new Date(event.created_at),
  };
}
