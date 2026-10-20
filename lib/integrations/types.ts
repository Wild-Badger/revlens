export interface WebhookEvent {
  source: 'stripe' | 'hubspot' | 'salesforce';
  type: string;
  payload: unknown;
  receivedAt: Date;
}

export interface WebhookHandler {
  handles: (eventType: string) => boolean;
  process: (payload: unknown) => Promise<void>;
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: unknown;
  };
}

export interface HubSpotEvent {
  eventId: string;
  subscriptionType: string;
  portalId: number;
  timestamp: number;
  data?: unknown;
}

export interface SalesforceEvent {
  schema: string;
  payload: {
    sobjectType?: string;
    [key: string]: unknown;
  };
}

export type SyncResult = {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
};