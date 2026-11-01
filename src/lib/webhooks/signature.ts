import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signature scheme of the simulated provider ("Paystream"):
 *   paystream-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * Several v1 values may be present while a secret is being rotated.
 */
export const SIGNATURE_HEADER = 'paystream-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure = 'missing' | 'malformed' | 'expired' | 'mismatch';

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

export function verifySignature(input: {
  secret: string;
  body: string;
  header: string | null;
  nowSeconds: number;
}): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (!input.header) return { ok: false, reason: 'missing' };

  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of input.header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && value) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) return { ok: false, reason: 'malformed' };

  // Bounds replay of a captured request. Idempotency covers replays inside the window.
  if (Math.abs(input.nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }

  const expected = Buffer.from(computeSignature(input.secret, timestamp, input.body), 'hex');
  const matches = candidates.some((candidate) => {
    const actual = Buffer.from(candidate, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  return matches ? { ok: true } : { ok: false, reason: 'mismatch' };
}
