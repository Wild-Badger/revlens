import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeSignature, processStripeEvent, handlesStripeEvent } from '@/lib/integrations/stripe';
import type { StripeEvent } from '@/lib/integrations/types';

export async function POST(request: NextRequest) {
  if (process.env.LOCAL_WORKSPACE_MODE === "true") return NextResponse.json({ error: "Use the reviewed CSV import to preserve dataset revisions and captured history" }, { status: 410 });
  try {
    const signature = request.headers.get('stripe-signature') || '';
    const rawBody = await request.text();

    if (!verifyStripeSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const event: StripeEvent = JSON.parse(rawBody);

    if (!handlesStripeEvent(event.type)) {
      return NextResponse.json(
        { received: true, processed: false, reason: 'Event type not handled' },
        { status: 200 }
      );
    }

    const result = await processStripeEvent(event);

    if (!result.success) {
      console.error('Stripe webhook processing errors:', result.errors);
      return NextResponse.json(
        { error: 'Processing failed', details: result.errors },
        { status: 500 }
      );
    }

    return NextResponse.json({
      received: true,
      processed: true,
      recordsProcessed: result.recordsProcessed,
    });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'stripe',
    status: 'active',
    supportedEvents: [
      'customer.created',
      'customer.updated',
      'subscription.created',
      'subscription.updated',
      'subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
    ],
  });
}
