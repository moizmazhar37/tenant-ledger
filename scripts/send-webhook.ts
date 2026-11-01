/**
 * Plays the payment provider: sends one signed event to the webhook endpoint.
 *   npm run webhook:send -- --account acct_acme --amount 2500
 *   npm run webhook:send -- --id evt_demo_1    (run twice to see idempotency)
 */
import './load-env';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildSignatureHeader, SIGNATURE_HEADER } from '@/lib/webhooks/signature';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/api/webhooks/payments' },
    id: { type: 'string', default: `evt_${randomBytes(8).toString('hex')}` },
    type: { type: 'string', default: 'payment.succeeded' },
    account: { type: 'string', default: 'acct_acme' },
    amount: { type: 'string', default: '2500' },
    currency: { type: 'string', default: 'GBP' },
    description: { type: 'string', default: 'Simulated payment' },
  },
});

const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  console.error('WEBHOOK_SECRET is not set');
  process.exit(1);
}

const body = JSON.stringify({
  id: values.id,
  type: values.type,
  created_at: new Date().toISOString(),
  data: {
    account_id: values.account,
    amount: Number(values.amount),
    currency: values.currency,
    description: values.description,
  },
});

const response = await fetch(values.url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    [SIGNATURE_HEADER]: buildSignatureHeader(secret, body),
  },
  body,
});
console.log(response.status, await response.text());
process.exitCode = response.ok ? 0 : 1;
