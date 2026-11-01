import { describe, expect, it } from 'vitest';
import {
  buildSignatureHeader,
  computeSignature,
  SIGNATURE_TOLERANCE_SECONDS,
  verifySignature,
} from '@/lib/webhooks/signature';

const secret = 'whsec_unit_test_secret';
const body = '{"id":"evt_1","type":"payment.succeeded"}';
const now = 1_790_000_000;

function verify(header: string | null, overrides: { body?: string; nowSeconds?: number } = {}) {
  return verifySignature({
    secret,
    body: overrides.body ?? body,
    header,
    nowSeconds: overrides.nowSeconds ?? now,
  });
}

describe('verifySignature', () => {
  it('accepts a header produced for the exact body', () => {
    expect(verify(buildSignatureHeader(secret, body, now))).toEqual({ ok: true });
  });

  it('rejects a missing header', () => {
    expect(verify(null)).toEqual({ ok: false, reason: 'missing' });
  });

  it.each(['', 'garbage', `t=${now}`, 'v1=abc', `t=soon,v1=abc`])(
    'rejects malformed header %j',
    (header) => {
      expect(verify(header)).toMatchObject({ ok: false });
    },
  );

  it('rejects a body that was modified after signing', () => {
    const header = buildSignatureHeader(secret, body, now);
    expect(verify(header, { body: body.replace('evt_1', 'evt_2') })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a signature made with a different secret', () => {
    expect(verify(buildSignatureHeader('whsec_other_secret_value', body, now))).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a signature that is not valid hex of the right length', () => {
    expect(verify(`t=${now},v1=deadbeef`)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('accepts timestamps up to the tolerance and rejects beyond it, in both directions', () => {
    const at = (offset: number) => buildSignatureHeader(secret, body, now + offset);
    expect(verify(at(-SIGNATURE_TOLERANCE_SECONDS))).toEqual({ ok: true });
    expect(verify(at(SIGNATURE_TOLERANCE_SECONDS))).toEqual({ ok: true });
    expect(verify(at(-SIGNATURE_TOLERANCE_SECONDS - 1))).toEqual({ ok: false, reason: 'expired' });
    expect(verify(at(SIGNATURE_TOLERANCE_SECONDS + 1))).toEqual({ ok: false, reason: 'expired' });
  });

  it('accepts any matching v1 so secrets can be rotated', () => {
    const good = computeSignature(secret, now, body);
    const stale = computeSignature('whsec_previous_secret_xx', now, body);
    expect(verify(`t=${now},v1=${stale},v1=${good}`)).toEqual({ ok: true });
  });
});
