import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { serverEnv } from '@/env';
import { handlePaymentWebhook } from '@/lib/webhooks/handler';
import { SIGNATURE_HEADER } from '@/lib/webhooks/signature';

export async function POST(request: NextRequest) {
  // The signature covers the exact bytes sent, so read the raw text before parsing.
  const outcome = await handlePaymentWebhook({
    db: getDb(),
    secret: serverEnv().WEBHOOK_SECRET,
    rawBody: await request.text(),
    signatureHeader: request.headers.get(SIGNATURE_HEADER),
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
