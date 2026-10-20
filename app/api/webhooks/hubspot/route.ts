import { NextRequest, NextResponse } from 'next/server';
import { verifyHubSpotSignature, processHubSpotEvent, handlesHubSpotEvent } from '@/lib/integrations/hubspot';
import type { HubSpotEvent } from '@/lib/integrations/types';

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-hubspot-signature') || '';
    const timestamp = request.headers.get('x-hubspot-request-timestamp') || '';
    const rawBody = await request.text();

    if (!verifyHubSpotSignature(rawBody, signature, timestamp)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const event: HubSpotEvent = await JSON.parse(rawBody);

    if (!handlesHubSpotEvent(event.subscriptionType)) {
      return NextResponse.json(
        { received: true, processed: false, reason: 'Subscription type not handled' },
        { status: 200 }
      );
    }

    const result = await processHubSpotEvent(event);

    if (!result.success) {
      console.error('HubSpot webhook processing errors:', result.errors);
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
    console.error('HubSpot webhook error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'hubspot',
    status: 'active',
    supportedSubscriptionTypes: [
      'contact.creation',
      'contact.propertyChange',
      'contact.deletion',
      'company.creation',
      'company.propertyChange',
      'company.deletion',
      'deal.creation',
      'deal.propertyChange',
      'deal.stageChange',
      'deal.deletion',
    ],
  });
}