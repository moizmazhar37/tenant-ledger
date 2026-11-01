import { describe, expect, it } from 'vitest';
import { parseEvent, toLedgerEntry } from '@/lib/webhooks/event';

const valid = {
  id: 'evt_unit_0001',
  type: 'payment.succeeded',
  created_at: '2026-10-20T10:00:00Z',
  data: { account_id: 'acct_acme', amount: 2500, currency: 'GBP', description: 'Order 1' },
};

const parse = (value: unknown) => parseEvent(JSON.stringify(value));

describe('parseEvent', () => {
  it('parses a valid payment event and maps it to a ledger entry', () => {
    const result = parse(valid);
    expect(result.kind).toBe('event');
    if (result.kind !== 'event') return;
    expect(toLedgerEntry(result.event)).toEqual({
      providerEventId: 'evt_unit_0001',
      kind: 'payment',
      amountMinor: 2500,
      currency: 'GBP',
      description: 'Order 1',
      occurredAt: new Date('2026-10-20T10:00:00Z'),
    });
  });

  it('maps a refund to a refund entry with a positive amount', () => {
    const result = parse({ ...valid, type: 'payment.refunded' });
    if (result.kind !== 'event') throw new Error(`expected event, got ${result.kind}`);
    expect(toLedgerEntry(result.event)).toMatchObject({ kind: 'refund', amountMinor: 2500 });
  });

  it('tolerates fields it does not know about, because providers add fields', () => {
    const result = parse({ ...valid, livemode: false, data: { ...valid.data, fee: 30 } });
    expect(result.kind).toBe('event');
  });

  it('defaults a missing description to an empty string', () => {
    const data: Partial<typeof valid.data> = { ...valid.data };
    delete data.description;
    const result = parse({ ...valid, data });
    if (result.kind !== 'event') throw new Error(`expected event, got ${result.kind}`);
    expect(result.event.data.description).toBe('');
  });

  it('acknowledges well-formed events of unsupported types without parsing them', () => {
    expect(parse({ id: 'evt_unit_0002', type: 'customer.created', data: {} })).toEqual({
      kind: 'unsupported',
      id: 'evt_unit_0002',
      type: 'customer.created',
    });
  });

  it('reports malformed JSON separately from schema violations', () => {
    expect(parseEvent('{"id": ')).toEqual({ kind: 'malformed_json' });
  });

  it('names the offending field for schema violations', () => {
    const result = parse({ ...valid, data: { ...valid.data, amount: 12.5 } });
    expect(result).toMatchObject({ kind: 'invalid' });
    if (result.kind !== 'invalid') return;
    expect(result.issues.join('\n')).toContain('data.amount');
  });
});
