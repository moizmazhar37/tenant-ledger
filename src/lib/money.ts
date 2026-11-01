/**
 * Formats an integer amount of minor units. The number of minor digits comes from the
 * currency itself (JPY has none, GBP has two), never from an assumed divisor of 100.
 */
export function formatMoney(amountMinor: number, currency: string, locale = 'en-GB'): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

export function signedAmountMinor(entry: { kind: 'payment' | 'refund'; amountMinor: number }) {
  return entry.kind === 'refund' ? -entry.amountMinor : entry.amountMinor;
}
