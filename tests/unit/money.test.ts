import { describe, expect, it } from 'vitest';
import { formatMoney, signedAmountMinor } from '@/lib/money';

describe('formatMoney', () => {
  it('formats minor units for a two-decimal currency', () => {
    expect(formatMoney(125000, 'GBP')).toBe('£1,250.00');
    expect(formatMoney(48050, 'GBP')).toBe('£480.50');
  });

  it('formats negative amounts', () => {
    expect(formatMoney(-12000, 'GBP')).toBe('-£120.00');
  });

  it('uses the currency’s own exponent instead of assuming 100 minor units', () => {
    expect(formatMoney(5000, 'JPY')).toMatch(/5,000$/);
    expect(formatMoney(1234, 'BHD')).toMatch(/1\.234$/);
  });

  it('refuses amounts that are not safe integers rather than rounding silently', () => {
    expect(() => formatMoney(10.5, 'GBP')).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, 'GBP')).toThrow(RangeError);
  });
});

describe('signedAmountMinor', () => {
  it('makes refunds negative and leaves payments positive', () => {
    expect(signedAmountMinor({ kind: 'payment', amountMinor: 100 })).toBe(100);
    expect(signedAmountMinor({ kind: 'refund', amountMinor: 100 })).toBe(-100);
  });
});
