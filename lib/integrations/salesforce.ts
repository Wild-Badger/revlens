import * as crypto from 'crypto';
import { prisma } from '../db';
import type { SalesforceEvent, SyncResult } from './types';

const SALESFORCE_WEBHOOK_SECRET = process.env.SALESFORCE_WEBHOOK_SECRET || '';

export function verifySalesforceSignature(
  payload: string,
  signature: string
): boolean {
  if (!SALESFORCE_WEBHOOK_SECRET) {
    console.warn('SALESFORCE_WEBHOOK_SECRET not configured, skipping signature verification');
    return true;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', SALESFORCE_WEBHOOK_SECRET)
      .update(payload, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );
  } catch {
    return false;
  }
}

export function handlesSalesforceEvent(schema: string): boolean {
  const supportedSchemas = [
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
  ];
  return supportedSchemas.some(s => schema.endsWith(s));
}

export async function processSalesforceEvent(event: SalesforceEvent): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    recordsProcessed: 0,
    errors: [],
  };

  const { schema, payload } = event;
  const sobjectType = payload.sobjectType;

  try {

    if (schema.endsWith('.create') || schema.endsWith('.update') || schema.endsWith('.change')) {
      switch (sobjectType) {
        case 'Account': {
          const account = payload as {
            Id: string;
            Name?: string;
            Website?: string;
            Industry?: string;
            NumberOfEmployees?: number;
            BillingCountry?: string;
            Type?: string;
          };
          await prisma.customer.upsert({
            where: { id: `salesforce_account_${account.Id}` },
            create: {
              id: `salesforce_account_${account.Id}`,
              name: account.Name || 'Unknown',
              domain: account.Website || null,
              industry: account.Industry || 'Unknown',
              companySize: account.NumberOfEmployees
                ? `${account.NumberOfEmployees} employees`
                : 'Unknown',
              country: account.BillingCountry || 'Unknown',
              acquisitionChannel: 'salesforce',
              status: 'active',
            },
            update: {
              name: account.Name || 'Unknown',
              domain: account.Website || null,
              industry: account.Industry || 'Unknown',
              companySize: account.NumberOfEmployees
                ? `${account.NumberOfEmployees} employees`
                : 'Unknown',
              country: account.BillingCountry || 'Unknown',
            },
          });
          result.recordsProcessed++;
          break;
        }

        case 'Contact': {
          const contact = payload as {
            Id: string;
            AccountId?: string;
            FirstName?: string;
            LastName?: string;
            Email?: string;
            Phone?: string;
          };
          const name = [contact.FirstName, contact.LastName].filter(Boolean).join(' ') || contact.Email || 'Unknown';
          const accountId = contact.AccountId ? `salesforce_account_${contact.AccountId}` : null;

          await prisma.customer.upsert({
            where: { id: `salesforce_contact_${contact.Id}` },
            create: {
              id: `salesforce_contact_${contact.Id}`,
              name,
              domain: null,
              industry: 'Unknown',
              companySize: 'Unknown',
              country: 'Unknown',
              acquisitionChannel: 'salesforce',
              status: 'active',
            },
            update: { name },
          });
          result.recordsProcessed++;
          break;
        }

        case 'Opportunity': {
          const opportunity = payload as {
            Id: string;
            AccountId?: string;
            Name?: string;
            StageName?: string;
            Amount?: number;
            CloseDate?: string;
            Probability?: number;
          };
          result.recordsProcessed++;
          break;
        }

        case 'Lead': {
          const lead = payload as {
            Id: string;
            FirstName?: string;
            LastName?: string;
            Email?: string;
            Company?: string;
            Status?: string;
            Country?: string;
            Industry?: string;
          };
          const name = [lead.FirstName, lead.LastName].filter(Boolean).join(' ') || lead.Email || 'Unknown';

          await prisma.customer.upsert({
            where: { id: `salesforce_lead_${lead.Id}` },
            create: {
              id: `salesforce_lead_${lead.Id}`,
              name,
              domain: null,
              industry: lead.Industry || 'Unknown',
              companySize: 'Unknown',
              country: lead.Country || 'Unknown',
              acquisitionChannel: 'salesforce',
              status: lead.Status === 'Closed Won' ? 'active' : 'lead',
            },
            update: {
              name,
              status: lead.Status === 'Closed Won' ? 'active' : 'lead',
            },
          });
          result.recordsProcessed++;
          break;
        }

        default:
          console.log(`Unhandled Salesforce sobject type: ${sobjectType}`);
      }
    } else if (schema.endsWith('.delete')) {
      const sobjectId = (payload as { Id: string }).Id;
      if (sobjectType && sobjectId) {
        await prisma.customer.updateMany({
          where: { id: `salesforce_${sobjectType.toLowerCase()}_${sobjectId}` },
          data: { status: 'churned', churnedAt: new Date() },
        });
        result.recordsProcessed++;
      }
    }
  } catch (error) {
    result.success = false;
    result.errors.push(
      `${schema}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  return result;
}