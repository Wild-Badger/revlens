import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handlesStripeEvent,
  processStripeEvent,
  verifyStripeSignature,
} from '../lib/integrations/stripe';
import {
  handlesHubSpotEvent,
  processHubSpotEvent,
  verifyHubSpotSignature,
} from '../lib/integrations/hubspot';
import {
  handlesSalesforceEvent,
  processSalesforceEvent,
  verifySalesforceSignature,
} from '../lib/integrations/salesforce';
import type { StripeEvent, HubSpotEvent, SalesforceEvent } from '../lib/integrations/types';

vi.mock('../lib/db', () => ({
  prisma: {
    customer: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
    subscription: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('Stripe webhook handlers', () => {
  describe('handlesStripeEvent', () => {
    it('returns true for supported event types', () => {
      expect(handlesStripeEvent('customer.created')).toBe(true);
      expect(handlesStripeEvent('subscription.created')).toBe(true);
      expect(handlesStripeEvent('invoice.paid')).toBe(true);
    });

    it('returns false for unsupported event types', () => {
      expect(handlesStripeEvent('unknown.event')).toBe(false);
    });
  });

  describe('verifyStripeSignature', () => {
    it('returns true when STRIPE_WEBHOOK_SECRET is not set', () => {
      const original = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect(verifyStripeSignature('payload', 'v1=signature')).toBe(true);
      process.env.STRIPE_WEBHOOK_SECRET = original;
    });
  });

  describe('processStripeEvent', () => {
    it('processes customer.created event', async () => {
      const event: StripeEvent = {
        id: 'evt_123',
        type: 'customer.created',
        created: Date.now(),
        data: {
          object: {
            id: 'cus_123',
            email: 'test@example.com',
            name: 'Test Customer',
            metadata: {},
          },
        },
      };

      const result = await processStripeEvent(event);
      expect(result.success).toBe(true);
    });

    it('processes subscription.created event', async () => {
      const event: StripeEvent = {
        id: 'evt_456',
        type: 'subscription.created',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            items: {
              data: [
                {
                  price: {
                    product: 'prod_123',
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        },
      };

      const result = await processStripeEvent(event);
      expect(result.success).toBe(true);
    });
  });
});

describe('HubSpot webhook handlers', () => {
  describe('handlesHubSpotEvent', () => {
    it('returns true for supported subscription types', () => {
      expect(handlesHubSpotEvent('contact.creation')).toBe(true);
      expect(handlesHubSpotEvent('company.propertyChange')).toBe(true);
      expect(handlesHubSpotEvent('deal.stageChange')).toBe(true);
    });

    it('returns false for unsupported subscription types', () => {
      expect(handlesHubSpotEvent('unknown.subscription')).toBe(false);
    });
  });

  describe('verifyHubSpotSignature', () => {
    it('returns true when HUBSPOT_APP_SECRET is not set', () => {
      const original = process.env.HUBSPOT_APP_SECRET;
      delete process.env.HUBSPOT_APP_SECRET;
      expect(verifyHubSpotSignature('payload', 'signature', 'timestamp')).toBe(true);
      process.env.HUBSPOT_APP_SECRET = original;
    });
  });

  describe('processHubSpotEvent', () => {
    it('processes contact.creation event', async () => {
      const event: HubSpotEvent = {
        eventId: '123',
        subscriptionType: 'contact.creation',
        portalId: 12345,
        timestamp: Date.now(),
        data: {
          vid: 123,
          email: 'test@example.com',
          properties: {
            firstname: 'Test',
            lastname: 'User',
          },
        },
      };

      const result = await processHubSpotEvent(event);
      expect(result.success).toBe(true);
    });
  });
});

describe('Salesforce webhook handlers', () => {
  describe('handlesSalesforceEvent', () => {
    it('returns true for supported schemas', () => {
      expect(handlesSalesforceEvent('Account.create')).toBe(true);
      expect(handlesSalesforceEvent('Opportunity.update')).toBe(true);
      expect(handlesSalesforceEvent('Lead.delete')).toBe(true);
    });

    it('returns false for unsupported schemas', () => {
      expect(handlesSalesforceEvent('Unknown.object')).toBe(false);
    });
  });

  describe('verifySalesforceSignature', () => {
    it('returns true when SALESFORCE_WEBHOOK_SECRET is not set', () => {
      const original = process.env.SALESFORCE_WEBHOOK_SECRET;
      delete process.env.SALESFORCE_WEBHOOK_SECRET;
      expect(verifySalesforceSignature('payload', 'signature')).toBe(true);
      process.env.SALESFORCE_WEBHOOK_SECRET = original;
    });
  });

  describe('processSalesforceEvent', () => {
    it('processes Account.create event', async () => {
      const event: SalesforceEvent = {
        schema: 'Account.create',
        payload: {
          sobjectType: 'Account',
          Id: '001xx0000000001',
          Name: 'Test Company',
          Industry: 'Technology',
        },
      };

      const result = await processSalesforceEvent(event);
      expect(result.success).toBe(true);
    });
  });
});