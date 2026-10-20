import * as crypto from 'crypto';
import { prisma } from '../db';
import type { StripeEvent, SyncResult } from './types';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export function verifyStripeSignature(payload: string, signature: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn('STRIPE_WEBHOOK_SECRET not configured, skipping signature verification');
    return true;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
      .update(payload, 'utf8')
      .digest('hex');

    const sigBuffer = Buffer.from(signature.replace('v1=', ''), 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function handlesStripeEvent(eventType: string): boolean {
  const supportedEvents = [
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'subscription.created',
    'subscription.updated',
    'subscription.deleted',
    'subscription.trial_will_end',
    'invoice.created',
    'invoice.updated',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.deleted',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'product.created',
    'product.updated',
    'price.created',
    'price.updated',
  ];
  return supportedEvents.includes(eventType);
}

export async function processStripeEvent(event: StripeEvent): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    recordsProcessed: 0,
    errors: [],
  };

  try {
    switch (event.type) {
      case 'customer.created':
      case 'customer.updated': {
        const customer = event.data.object as {
          id: string;
          email?: string;
          name?: string;
          metadata?: Record<string, string>;
        };
        await prisma.customer.upsert({
          where: { id: customer.id },
          create: {
            id: customer.id,
            name: customer.name || customer.email || 'Unknown',
            domain: customer.metadata?.domain || null,
            industry: customer.metadata?.industry || 'Unknown',
            companySize: customer.metadata?.company_size || 'Unknown',
            country: customer.metadata?.country || 'US',
            acquisitionChannel: customer.metadata?.acquisition_channel || 'direct',
            status: 'active',
          },
          update: {
            name: customer.name || customer.email || 'Unknown',
            domain: customer.metadata?.domain || null,
            industry: customer.metadata?.industry || 'Unknown',
            companySize: customer.metadata?.company_size || 'Unknown',
            country: customer.metadata?.country || 'US',
            acquisitionChannel: customer.metadata?.acquisition_channel || 'direct',
          },
        });
        result.recordsProcessed++;
        break;
      }

      case 'subscription.created':
      case 'subscription.updated': {
        const subscription = event.data.object as {
          id: string;
          customer: string;
          status: string;
          current_period_start: number;
          current_period_end: number;
          items?: { data: Array<{ price: { product: string; recurring: { interval: string } } }> };
        };
        const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || 'month';
        await prisma.subscription.upsert({
          where: { id: subscription.id },
          create: {
            id: subscription.id,
            customerId: subscription.customer,
            planId: subscription.items?.data?.[0]?.price?.product || 'default',
            status: subscription.status,
            startedAt: new Date(subscription.current_period_start * 1000),
            endedAt: subscription.status === 'canceled' || subscription.status === 'completed'
              ? new Date(subscription.current_period_end * 1000)
              : null,
            billingInterval: interval,
            currentMrr: 0,
            seats: 1,
          },
          update: {
            status: subscription.status,
            endedAt: subscription.status === 'canceled' || subscription.status === 'completed'
              ? new Date(subscription.current_period_end * 1000)
              : null,
            billingInterval: interval,
          },
        });
        result.recordsProcessed++;
        break;
      }

      case 'subscription.deleted': {
        const subscription = event.data.object as { id: string };
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'canceled', endedAt: new Date() },
        });
        result.recordsProcessed++;
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as {
          id: string;
          customer: string;
          subscription?: string;
          amount_paid: number;
          currency: string;
          status: string;
          created: number;
        };
        await prisma.invoice.upsert({
          where: { id: invoice.id },
          create: {
            id: invoice.id,
            customerId: invoice.customer,
            subscriptionId: invoice.subscription || null,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency.toUpperCase(),
            status: 'paid',
            invoiceDate: new Date(invoice.created * 1000),
            paidAt: new Date(),
          },
          update: {
            status: 'paid',
            paidAt: new Date(),
          },
        });
        result.recordsProcessed++;
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as {
          id: string;
          customer: string;
          subscription?: string;
          amount_due: number;
          currency: string;
          created: number;
        };
        await prisma.invoice.upsert({
          where: { id: invoice.id },
          create: {
            id: invoice.id,
            customerId: invoice.customer,
            subscriptionId: invoice.subscription || null,
            amount: invoice.amount_due / 100,
            currency: invoice.currency.toUpperCase(),
            status: 'failed',
            invoiceDate: new Date(invoice.created * 1000),
            failedAt: new Date(),
          },
          update: {
            status: 'failed',
            failedAt: new Date(),
          },
        });
        result.recordsProcessed++;
        break;
      }

      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as {
          id: string;
          invoice?: string;
          customer: string;
          amount: number;
          status: string;
        };
        if (paymentIntent.invoice) {
          const invoice = await prisma.invoice.findUnique({
            where: { id: paymentIntent.invoice },
          });
          if (invoice) {
            await prisma.payment.create({
              data: {
                id: paymentIntent.id,
                invoiceId: paymentIntent.invoice,
                customerId: paymentIntent.customer,
                amount: paymentIntent.amount / 100,
                status: event.type === 'payment_intent.succeeded' ? 'succeeded' : 'failed',
                paymentMethod: 'card',
                processedAt: new Date(),
              },
            });
            result.recordsProcessed++;
          }
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (error) {
    result.success = false;
    result.errors.push(`${event.type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}