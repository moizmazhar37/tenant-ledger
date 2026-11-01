/**
 * The provider is simulated at our boundary: these tests build the exact HTTP requests
 * it would send (signed bodies, redeliveries, reordering, garbage) and assert how our
 * real route handler and database respond. Nothing about the provider itself is tested.
 */
import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/webhooks/payments/route';
import { closeDb, getDb } from '@/db/client';
import { SEED } from '@/db/seed';
import { ledgerRepository } from '@/db/tenant';
import { serverEnv } from '@/env';
import { buildSignatureHeader, SIGNATURE_HEADER } from '@/lib/webhooks/signature';
import { postgresErrorCode } from './helpers';

const SEEDED_ENTRY_COUNT = Object.values(SEED).reduce((n, t) => n + t.entries.length, 0);

interface EventOverrides {
  id?: string;
  type?: string;
  created_at?: string;
  data?: Record<string, unknown>;
}

function paymentEvent(overrides: EventOverrides = {}) {
  return {
    id: overrides.id ?? 'evt_test_0001',
    type: overrides.type ?? 'payment.succeeded',
    created_at: overrides.created_at ?? '2026-10-20T10:00:00Z',
    data: {
      account_id: SEED.acme.organisation.providerAccountId,
      amount: 2500,
      currency: 'GBP',
      description: 'Order 5001',
      ...overrides.data,
    },
  };
}

async function deliver(
  payload: unknown,
  options: { body?: string; signature?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = options.body ?? JSON.stringify(payload);
  const signature =
    options.signature === undefined
      ? buildSignatureHeader(serverEnv().WEBHOOK_SECRET, body)
      : options.signature;
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set(SIGNATURE_HEADER, signature);

  const response = await POST(
    new NextRequest('http://localhost/api/webhooks/payments', { method: 'POST', body, headers }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Reads as a superuser, bypassing RLS, so we see every row regardless of tenant. */
async function rowsForEvent(providerEventId: string) {
  return getDb().execute<{ organisation_id: string; amount_minor: string; kind: string }>(
    sql`select organisation_id, amount_minor, kind from ledger_entries
        where provider_event_id = ${providerEventId}`,
  );
}

async function totalEntries(): Promise<number> {
  const [row] = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from ledger_entries`,
  );
  return row?.count ?? -1;
}

describe('payment webhook: delivery and redelivery', () => {
  it('first delivery creates exactly one entry for the matching organisation', async () => {
    const result = await deliver(paymentEvent());

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ status: 'created', entryId: expect.any(String) });
    const rows = await rowsForEvent('evt_test_0001');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organisation_id: SEED.acme.organisation.id,
      kind: 'payment',
    });
    expect(Number(rows[0]?.amount_minor)).toBe(2500);
  });

  it('redelivery of the same event creates nothing and returns the original entry id', async () => {
    const first = await deliver(paymentEvent());
    const second = await deliver(paymentEvent());
    const third = await deliver(paymentEvent());

    expect(first.status).toBe(201);
    expect(second).toEqual({
      status: 200,
      body: { status: 'duplicate', entryId: first.body.entryId },
    });
    expect(third).toEqual(second);
    expect(await rowsForEvent('evt_test_0001')).toHaveLength(1);
    expect(await totalEntries()).toBe(SEEDED_ENTRY_COUNT + 1);
  });

  it('concurrent deliveries of one event create exactly one entry', async () => {
    // An in-memory "seen it?" check would let several of these through. The unique
    // constraint is what serialises them.
    const results = await Promise.all(Array.from({ length: 10 }, () => deliver(paymentEvent())));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.entryId)).size).toBe(1);
    expect(await rowsForEvent('evt_test_0001')).toHaveLength(1);
  });

  it('a redelivery after the app restarts is still a duplicate, because nothing is held in memory', async () => {
    const first = await deliver(paymentEvent());
    // Simulate a fresh process: drop every pooled connection, then redeliver.
    await closeDb();
    const second = await deliver(paymentEvent());
    expect(second.body).toEqual({ status: 'duplicate', entryId: first.body.entryId });
  });
});

describe('payment webhook: out-of-order delivery', () => {
  it('records each event once and orders by when it happened, not when it arrived', async () => {
    const earlier = paymentEvent({ id: 'evt_test_early', created_at: '2026-10-20T10:00:00Z' });
    const later = paymentEvent({ id: 'evt_test_late', created_at: '2026-10-20T10:05:00Z' });

    const lateResult = await deliver(later);
    const earlyResult = await deliver(earlier);
    const lateAgain = await deliver(later);

    expect([lateResult.status, earlyResult.status, lateAgain.status]).toEqual([201, 201, 200]);
    const [newest, secondNewest] = await ledgerRepository(
      getDb(),
      SEED.acme.organisation.id,
    ).list();
    expect(newest?.providerEventId).toBe('evt_test_late');
    expect(secondNewest?.providerEventId).toBe('evt_test_early');
  });

  it('records a refund that arrives before the payment it refunds', async () => {
    const refund = paymentEvent({
      id: 'evt_test_refund',
      type: 'payment.refunded',
      created_at: '2026-10-21T09:00:00Z',
      data: { amount: 1000 },
    });
    const payment = paymentEvent({
      id: 'evt_test_payment',
      created_at: '2026-10-21T08:00:00Z',
      data: { amount: 1000 },
    });

    expect((await deliver(refund)).status).toBe(201);
    expect((await deliver(payment)).status).toBe(201);

    // Seeded net 161050 + 1000 - 1000: the pair nets to zero regardless of arrival order.
    expect(await ledgerRepository(getDb(), SEED.acme.organisation.id).totals()).toEqual([
      { currency: 'GBP', netMinor: 161050 },
    ]);
  });
});

describe('payment webhook: conflicting reuse of an event id', () => {
  it('rejects the same event id with a different amount and leaves the original untouched', async () => {
    await deliver(paymentEvent());
    const conflicting = await deliver(paymentEvent({ data: { amount: 999_999 } }));

    expect(conflicting).toEqual({ status: 409, body: { error: 'event_conflict' } });
    const rows = await rowsForEvent('evt_test_0001');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.amount_minor)).toBe(2500);
  });

  it('rejects an event id already used by another organisation without revealing it', async () => {
    const original = await deliver(paymentEvent());
    const crossTenant = await deliver(
      paymentEvent({
        data: { account_id: SEED.globex.organisation.providerAccountId, currency: 'USD' },
      }),
    );

    expect(original.status).toBe(201);
    expect(crossTenant).toEqual({ status: 409, body: { error: 'event_conflict' } });
    const rows = await rowsForEvent('evt_test_0001');
    expect(rows.map((r) => r.organisation_id)).toEqual([SEED.acme.organisation.id]);
  });
});

describe('payment webhook: rejected deliveries write nothing', () => {
  const valid = paymentEvent();
  const withData = (data: Record<string, unknown>) => ({
    ...valid,
    data: { ...valid.data, ...data },
  });
  const without = (key: keyof typeof valid) => {
    const copy: Partial<typeof valid> = { ...valid };
    delete copy[key];
    return copy;
  };

  it.each([
    ['invalid JSON', { body: '{"id": "evt_test_0001",' }, 'malformed_json'],
    ['an empty body', { body: '' }, 'malformed_json'],
    ['a JSON array', { body: '[]' }, 'invalid_payload'],
    ['JSON null', { body: 'null' }, 'invalid_payload'],
    ['a missing id', { payload: without('id') }, 'invalid_payload'],
    ['an id without the evt_ prefix', { payload: { ...valid, id: '12345' } }, 'invalid_payload'],
    ['a missing data object', { payload: without('data') }, 'invalid_payload'],
    ['a missing account', { payload: withData({ account_id: undefined }) }, 'invalid_payload'],
    ['a negative amount', { payload: withData({ amount: -2500 }) }, 'invalid_payload'],
    ['a zero amount', { payload: withData({ amount: 0 }) }, 'invalid_payload'],
    ['a fractional amount', { payload: withData({ amount: 25.5 }) }, 'invalid_payload'],
    ['an amount sent as a string', { payload: withData({ amount: '2500' }) }, 'invalid_payload'],
    [
      'an amount beyond the safe integer range',
      { payload: withData({ amount: 2 ** 53 }) },
      'invalid_payload',
    ],
    ['a lowercase currency', { payload: withData({ currency: 'gbp' }) }, 'invalid_payload'],
    [
      'an unparseable timestamp',
      { payload: { ...valid, created_at: 'yesterday' } },
      'invalid_payload',
    ],
  ] as const)('rejects %s with 400', async (_name, input, error) => {
    const result = await deliver('payload' in input ? input.payload : null, {
      body: 'body' in input ? input.body : undefined,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe(error);
    expect(await totalEntries()).toBe(SEEDED_ENTRY_COUNT);
  });

  it.each([
    ['no signature header', () => ({ signature: null })],
    [
      'a signature for a different body',
      () => ({ signature: buildSignatureHeader(serverEnv().WEBHOOK_SECRET, '{}') }),
    ],
    [
      'a signature made with the wrong secret',
      (body: string) => ({ signature: buildSignatureHeader('whsec_attacker_guess_0000', body) }),
    ],
    [
      'an expired signature',
      (body: string) => ({
        signature: buildSignatureHeader(
          serverEnv().WEBHOOK_SECRET,
          body,
          Math.floor(Date.now() / 1000) - 3600,
        ),
      }),
    ],
  ])('rejects %s with 401', async (_name, signatureFor) => {
    const body = JSON.stringify(valid);
    const result = await deliver(null, { body, ...signatureFor(body) });

    expect(result).toEqual({ status: 401, body: { error: 'invalid_signature' } });
    expect(await totalEntries()).toBe(SEEDED_ENTRY_COUNT);
  });

  it('rejects an event for an unknown account with 422', async () => {
    const result = await deliver(withData({ account_id: 'acct_does_not_exist' }));
    expect(result).toEqual({ status: 422, body: { error: 'unknown_account' } });
    expect(await totalEntries()).toBe(SEEDED_ENTRY_COUNT);
  });

  it('acknowledges an unsupported event type with 200 so the provider stops retrying', async () => {
    const result = await deliver({ ...valid, type: 'customer.created' });
    expect(result).toEqual({
      status: 200,
      body: { status: 'ignored', reason: 'unsupported_event_type' },
    });
    expect(await totalEntries()).toBe(SEEDED_ENTRY_COUNT);
  });
});

describe('idempotency is enforced by the database, not the handler', () => {
  it('a direct duplicate insert of a provider event id violates the unique constraint', async () => {
    const existing = SEED.acme.entries[0];
    const attempt = getDb().execute(sql`
      insert into ledger_entries
        (organisation_id, provider_event_id, kind, amount_minor, currency, occurred_at)
      values
        (${SEED.acme.organisation.id}, ${existing.providerEventId}, 'payment', 1, 'GBP', now())
    `);
    // 23505: unique_violation. Holds even for code that bypasses the handler entirely.
    await expect(attempt.catch(postgresErrorCode)).resolves.toBe('23505');
  });
});
