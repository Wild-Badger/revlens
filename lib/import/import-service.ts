import { randomUUID } from "node:crypto";
import { resetSnapshotRows } from "@/lib/attribute-history";
import { importOptionsSchema, type ImportOptions } from "./options";
import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { planSourceKey, subscriptionSourceKey, type CustomerCsvRow, type ImportValidationResult } from "./csv-validator";

export function stableImportId(kind: string, sourceId: string): string {
  if (kind === "customer" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) return sourceId.toLowerCase();
  const bytes = createHash("sha256").update(`revlens:csv:v1:${kind}:${sourceId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class ImportStateError extends Error { constructor(message: string, public status = 409) { super(message); } }
export interface ImportResult {
  success: true; imported: number; total: number;
  counts: { customers: number; subscriptions: number; invoices: number; events: number };
  errors: never[]; asOf: string; currency: "USD"; revision: number; analyticsStatus?: string; message?: string;
}
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

export async function importCustomersData(prisma: PrismaClient, validation: ImportValidationResult, options: ImportOptions = importOptionsSchema.parse({})): Promise<ImportResult> {
  if (process.env.LOCAL_WORKSPACE_MODE !== "true" || process.env.DEMO_MODE !== "false" || process.env.NEXT_PUBLIC_DEMO_MODE !== "false") throw new Error("Replacement is available only in the dedicated local workspace");
  if (validation.errors.length || !validation.validRows.length || !validation.summary.asOf) throw new Error("Validate the complete dataset before import");
  if (options.historyStart && options.historyStart > validation.summary.asOf) throw new Error("Coverage start follows the observation date");
  let revision = 0;
  const customers = new Map<string, CustomerCsvRow>(), invoices = new Map<string, CustomerCsvRow>(), events = new Map<string, CustomerCsvRow>();
  const plans = new Map<string, CustomerCsvRow>();
  const subscriptions = new Map<string, CustomerCsvRow>();
  const customerIntervals = new Map<string, CustomerCsvRow[]>();
  for (const row of validation.validRows) {
    customers.set(row.customer_id, row);
    if (row.plan_name) {
      plans.set(planSourceKey(row), row);
      subscriptions.set(subscriptionSourceKey(row), row);
    }
    if (row.invoice_id) invoices.set(row.invoice_id, row);
    if (row.event_id) events.set(row.event_id, row);
  }
  for (const row of subscriptions.values()) {
    const intervals = customerIntervals.get(row.customer_id) ?? [];
    intervals.push(row); customerIntervals.set(row.customer_id, intervals);
  }
  for (const intervals of customerIntervals.values()) intervals.sort((a, b) => a.subscription_started_at!.localeCompare(b.subscription_started_at!));
  const planId = (row: CustomerCsvRow) => stableImportId("plan", planSourceKey(row));
  const customerId = (row: CustomerCsvRow) => stableImportId("customer", row.customer_id);
  const subscriptionId = (row: CustomerCsvRow) => row.subscription_id ? stableImportId("subscription-interval", subscriptionSourceKey(row)) : stableImportId("subscription", row.customer_id);
  await prisma.$transaction(async tx => {
    // ponytail: one operator and bounded datasets; serialize replace/restore rather than add a job system.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261020, 2)`;
    const previous = await tx.datasetMetadata.findUnique({ where: { id: "local" } });
    if (previous && previous.pipelineStatus !== "ready") throw new ImportStateError("Analytics pending: refresh before replacing another snapshot");
    if (previous && options.mode === "update" && new Date(`${validation.summary.asOf}T23:59:59.999Z`) < previous.asOf) throw new ImportStateError("Older observations need an explicit new dataset or backup restore");
    revision = (previous?.revision ?? 0) + 1;
    if (options.mode === "new") await resetSnapshotRows(tx);
    const sourceId = previous && options.mode === "update" ? previous.sourceId : randomUUID();
    await tx.payment.deleteMany();
    await tx.invoice.deleteMany();
    await tx.productEvent.deleteMany();
    await tx.subscription.deleteMany();
    await tx.customer.deleteMany();
    await tx.plan.deleteMany();
    if (plans.size) await tx.plan.createMany({ data: [...plans.values()].map(row => ({
      id: planId(row), name: row.plan_name!, billingInterval: row.billing_interval!,
      // Unknown catalog prices remain null; revenue uses the supplied subscription intervals.
      basePrice: row.plan_base_price === undefined ? null : new Prisma.Decimal(row.plan_base_price), seatPrice: row.plan_seat_price === undefined ? null : new Prisma.Decimal(row.plan_seat_price), createdAt: date(validation.summary.asOf!),
    })) });
    await tx.customer.createMany({ data: [...customers.values()].map(row => ({
      id: customerId(row), name: row.name, domain: row.domain ?? null, industry: row.industry,
      companySize: row.company_size, country: row.country, acquisitionChannel: row.acquisition_channel,
      status: row.status, createdAt: date(row.customer_created_at),
      convertedAt: customerIntervals.get(row.customer_id)?.[0]?.subscription_started_at ? date(customerIntervals.get(row.customer_id)![0].subscription_started_at!) : null,
      churnedAt: row.status === "churned" ? date(customerIntervals.get(row.customer_id)!.at(-1)!.subscription_ended_at!) : null,
    })) });
    if (subscriptions.size) await tx.subscription.createMany({ data: [...subscriptions.values()].map(row => ({
      id: subscriptionId(row), customerId: customerId(row), planId: planId(row),
      status: row.subscription_ended_at ? "cancelled" : "active",
      startedAt: date(row.subscription_started_at!), endedAt: row.subscription_ended_at ? date(row.subscription_ended_at) : null,
      billingInterval: row.billing_interval!, currentMrr: new Prisma.Decimal(row.mrr!), seats: row.seats!,
    })) });
    if (invoices.size) await tx.invoice.createMany({ data: [...invoices.values()].map(row => ({
      id: stableImportId("invoice", row.invoice_id!), customerId: customerId(row),
      subscriptionId: row.plan_name ? subscriptionId(row) : null,
      amount: new Prisma.Decimal(row.invoice_amount!), currency: row.currency, status: row.invoice_status!,
      invoiceDate: date(row.invoice_date!), paidAt: row.invoice_paid_at ? date(row.invoice_paid_at) : null,
      failedAt: row.invoice_failed_at ? date(row.invoice_failed_at) : null,
    })) });
    const expandedEvents = [...events.values()].flatMap(row => Array.from({ length: row.event_count! }, (_, index) => ({
      id: BigInt(`0x${createHash("sha256").update(`revlens:event:${row.event_id}:${index}`).digest("hex").slice(0, 15)}`),
      customerId: customerId(row), eventName: row.event_name!, timestamp: date(row.event_date!),
    })));
    for (let offset = 0; offset < expandedEvents.length; offset += 1000) await tx.productEvent.createMany({ data: expandedEvents.slice(offset, offset + 1000) });
    await tx.datasetMetadata.upsert({ where: { id: "local" },
      create: { id: "local", sourceId, sourceName: options.sourceName, historyStart: options.historyStart ? date(options.historyStart) : null, historyComplete: options.historyComplete, revision, analyticsRevision: -1, pipelineStatus: "pending", asOf: new Date(`${validation.summary.asOf}T23:59:59.999Z`), currency: "USD", rowCount: validation.summary.totalRows },
      update: { sourceId, sourceName: options.sourceName, historyStart: options.historyStart ? date(options.historyStart) : null, historyComplete: options.historyComplete, revision, analyticsRevision: -1, pipelineStatus: "pending", asOf: new Date(`${validation.summary.asOf}T23:59:59.999Z`), currency: "USD", rowCount: validation.summary.totalRows, importedAt: new Date() },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  return { success: true, imported: customers.size, total: validation.summary.totalRows,
    counts: { customers: customers.size, subscriptions: validation.summary.subscriptions, invoices: invoices.size, events: validation.summary.events },
    errors: [], revision, asOf: validation.summary.asOf, currency: "USD" };
}
