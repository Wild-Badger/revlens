import { NextRequest, NextResponse } from 'next/server';
import { verifySalesforceSignature, processSalesforceEvent, handlesSalesforceEvent } from '@/lib/integrations/salesforce';
import type { SalesforceEvent } from '@/lib/integrations/types';

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-salesforce-signature') || '';
    const rawBody = await request.text();

    if (!verifySalesforceSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const event: SalesforceEvent = await JSON.parse(rawBody);

    if (!handlesSalesforceEvent(event.schema)) {
      return NextResponse.json(
        { received: true, processed: false, reason: 'Schema not handled' },
        { status: 200 }
      );
    }

    const result = await processSalesforceEvent(event);

    if (!result.success) {
      console.error('Salesforce webhook processing errors:', result.errors);
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
    console.error('Salesforce webhook error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'salesforce',
    status: 'active',
    supportedSchemas: [
      'Account.change',
      'Account.create',
      'Account.update',
      'Account.delete',
      'Contact.change',
      'Contact.create',
      'Contact.update',
      'Contact.delete',
      'Opportunity.change',
      'Opportunity.create',
      'Opportunity.update',
      'Opportunity.delete',
      'Lead.change',
      'Lead.create',
      'Lead.update',
      'Lead.delete',
    ],
  });
}