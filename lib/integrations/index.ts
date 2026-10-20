export * from './types';
export * from './stripe';
export * from './hubspot';
export * from './salesforce';

import { handlesStripeEvent, processStripeEvent, verifyStripeSignature } from './stripe';
import { handlesHubSpotEvent, processHubSpotEvent, verifyHubSpotSignature } from './hubspot';
import { handlesSalesforceEvent, processSalesforceEvent, verifySalesforceSignature } from './salesforce';
import type { WebhookEvent, StripeEvent, HubSpotEvent, SalesforceEvent, SyncResult } from './types';

export interface IntegrationResult {
  source: string;
  results: SyncResult[];
  totalProcessed: number;
  totalErrors: number;
}

export async function processWebhookEvent(event: WebhookEvent): Promise<SyncResult> {
  switch (event.source) {
    case 'stripe':
      if (handlesStripeEvent((event.payload as StripeEvent).type)) {
        return processStripeEvent(event.payload as StripeEvent);
      }
      break;
    case 'hubspot':
      if (handlesHubSpotEvent((event.payload as HubSpotEvent).subscriptionType)) {
        return processHubSpotEvent(event.payload as HubSpotEvent);
      }
      break;
    case 'salesforce':
      if (handlesSalesforceEvent((event.payload as SalesforceEvent).schema)) {
        return processSalesforceEvent(event.payload as SalesforceEvent);
      }
      break;
  }

  return { success: true, recordsProcessed: 0, errors: [] };
}

export const webhookHandlers = {
  stripe: {
    handles: handlesStripeEvent,
    process: processStripeEvent,
    verify: verifyStripeSignature,
  },
  hubspot: {
    handles: handlesHubSpotEvent,
    process: processHubSpotEvent,
    verify: verifyHubSpotSignature,
  },
  salesforce: {
    handles: handlesSalesforceEvent,
    process: processSalesforceEvent,
    verify: verifySalesforceSignature,
  },
};