import * as crypto from 'crypto';
import { prisma } from '../db';
import type { HubSpotEvent, SyncResult } from './types';

const HUBSPOT_APP_SECRET = process.env.HUBSPOT_APP_SECRET || '';

export function verifyHubSpotSignature(
  payload: string,
  signature: string,
  timestamp: string
): boolean {
  if (!HUBSPOT_APP_SECRET) {
    console.warn('HUBSPOT_APP_SECRET not configured, skipping signature verification');
    return true;
  }

  try {
    const timestampPrefix = `${timestamp}`;
    const sourceString = `${timestampPrefix}${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', HUBSPOT_APP_SECRET)
      .update(sourceString, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );
  } catch {
    return false;
  }
}

export function handlesHubSpotEvent(subscriptionType: string): boolean {
  const supportedTypes = [
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
    'engagement',
  ];
  return supportedTypes.includes(subscriptionType);
}

export async function processHubSpotEvent(event: HubSpotEvent): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    recordsProcessed: 0,
    errors: [],
  };

  const { subscriptionType, data } = event;

  try {

    switch (subscriptionType) {
      case 'contact.creation':
      case 'contact.propertyChange': {
        const contact = data as {
          vid?: number;
          email?: string;
          properties?: {
            firstname?: string;
            lastname?: string;
            company?: string;
            website?: string;
            industry?: string;
            lifecyclestage?: string;
          };
        };
        const name = [
          contact.properties?.firstname,
          contact.properties?.lastname,
        ].filter(Boolean).join(' ') || contact.email || 'Unknown';

        await prisma.customer.upsert({
          where: { id: `hubspot_contact_${contact.vid}` },
          create: {
            id: `hubspot_contact_${contact.vid}`,
            name,
            domain: contact.properties?.website || null,
            industry: contact.properties?.industry || 'Unknown',
            companySize: 'Unknown',
            country: 'Unknown',
            acquisitionChannel: 'hubspot',
            status: contact.properties?.lifecyclestage === 'customer' ? 'active' : 'lead',
          },
          update: {
            name,
            domain: contact.properties?.website || null,
            industry: contact.properties?.industry || 'Unknown',
            status: contact.properties?.lifecyclestage === 'customer' ? 'active' : 'lead',
          },
        });
        result.recordsProcessed++;
        break;
      }

      case 'company.creation':
      case 'company.propertyChange': {
        const company = data as {
          companyId?: number;
          properties?: {
            name?: string;
            domain?: string;
            industry?: string;
            numberofemployees?: string;
            country?: string;
          };
        };
        if (company.companyId) {
          await prisma.customer.upsert({
            where: { id: `hubspot_company_${company.companyId}` },
            create: {
              id: `hubspot_company_${company.companyId}`,
              name: company.properties?.name || 'Unknown',
              domain: company.properties?.domain || null,
              industry: company.properties?.industry || 'Unknown',
              companySize: company.properties?.numberofemployees || 'Unknown',
              country: company.properties?.country || 'Unknown',
              acquisitionChannel: 'hubspot',
              status: 'active',
            },
            update: {
              name: company.properties?.name || 'Unknown',
              domain: company.properties?.domain || null,
              industry: company.properties?.industry || 'Unknown',
              companySize: company.properties?.numberofemployees || 'Unknown',
              country: company.properties?.country || 'Unknown',
            },
          });
          result.recordsProcessed++;
        }
        break;
      }

      case 'deal.creation':
      case 'deal.propertyChange':
      case 'deal.stageChange': {
        const deal = data as {
          dealId?: number;
          properties?: {
            dealname?: string;
            amount?: string;
            dealstage?: string;
            closedate?: string;
            hubspot_owner_id?: string;
          };
        };
        if (deal.dealId) {
          result.recordsProcessed++;
        }
        break;
      }

      case 'contact.deletion': {
        const contact = data as { vid?: number };
        if (contact.vid) {
          await prisma.customer.updateMany({
            where: { id: `hubspot_contact_${contact.vid}` },
            data: { status: 'churned', churnedAt: new Date() },
          });
          result.recordsProcessed++;
        }
        break;
      }

      default:
        console.log(`Unhandled HubSpot subscription type: ${subscriptionType}`);
    }
  } catch (error) {
    result.success = false;
    result.errors.push(
      `${subscriptionType}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  return result;
}