import { randomUUID } from "node:crypto";
import { readSnapshotRows, restoreSnapshotRows, resetSnapshotRows, snapshotRowsSchema, validateSnapshotRows } from "@/lib/attribute-history";
import { isWarehouseRuntime } from "@/lib/warehouse";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { saveCheckpoint, unwrapCheckpoint } from "@/lib/dataset-checkpoints";
import { coverageError, factDateError, invalidIntervals } from "@/lib/dataset-temporal";

export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
export const RESTORE_CONFIRMATION = "REPLACE_LOCAL_DATASET";
const text = z.string().min(1).max(500);
const uuid = z.string().uuid();
const timestamp = z.string().regex(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "Use a real UTC date with milliseconds");
const money = z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, "Use a nonnegative decimal amount, up to 9999999999.99");
const interval = z.enum(["monthly", "annual"]);
const eventId = z.string().refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) < 9223372036854775807n, "Use a positive PostgreSQL bigint event ID");

// ponytail: arbitrary event properties remain JSON; bounded depth/size keeps restores finite.
function finiteJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 10000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every((item) => finiteJson(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    return entries.length <= 1000 && entries.every(([key, item]) => key.length <= 500 && finiteJson(item, depth + 1));
  }
  return false;
}

const backupSchema = z.object({
  format: z.literal("revlens-dataset"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  attributeHistory: z.object({ customers: snapshotRowsSchema, plans: snapshotRowsSchema }).strict().optional(),
  exportedAt: timestamp,
  metadata: z.object({ id: z.literal("local"), asOf: timestamp, currency: z.literal("USD"), importedAt: timestamp, rowCount: z.number().int().min(0).max(100000),
    sourceId: uuid.optional(), sourceName: text.optional(), historyStart: timestamp.nullable().optional(), historyComplete: z.boolean().optional(),
    revision: z.number().int().min(0).max(2147483647).optional(), analyticsRevision: z.number().int().min(-1).max(2147483647).optional(),
    pipelineStatus: z.enum(["ready","pending","failed"]).optional(),
  }).strict().nullable(),
  customers: z.array(z.object({
    id: uuid, name: text, domain: text.nullable(), industry: text, companySize: text,
    country: text, acquisitionChannel: text, createdAt: timestamp, convertedAt: timestamp.nullable(),
    churnedAt: timestamp.nullable(), status: z.enum(["lead", "active", "churned", "reactivated"]),
  }).strict()).max(20000),
  plans: z.array(z.object({
    id: uuid, name: text, billingInterval: interval, basePrice: money.nullable(), seatPrice: money.nullable(), createdAt: timestamp,
  }).strict()).max(1000),
  subscriptions: z.array(z.object({
    id: uuid, customerId: uuid, planId: uuid, status: z.enum(["active", "cancelled", "canceled", "past_due", "trialing", "paused"]),
    startedAt: timestamp, endedAt: timestamp.nullable(), billingInterval: interval, currentMrr: money, seats: z.number().int().min(0).max(2147483647),
  }).strict()).max(100000),
  invoices: z.array(z.object({
    id: uuid, customerId: uuid, subscriptionId: uuid.nullable(), amount: money, currency: z.literal("USD"),
    status: z.enum(["paid", "open", "failed", "void", "draft", "uncollectible"]), invoiceDate: timestamp.refine((value) => value.endsWith("T00:00:00.000Z"), "Invoice date must be UTC midnight"),
    paidAt: timestamp.nullable(), failedAt: timestamp.nullable(),
  }).strict()).max(100000),
  payments: z.array(z.object({
    id: uuid, invoiceId: uuid, customerId: uuid, amount: money, status: z.enum(["succeeded", "failed", "pending", "refunded"]),
    paymentMethod: text, processedAt: timestamp,
  }).strict()).max(100000),
  productEvents: z.array(z.object({
    id: eventId, customerId: uuid, userId: text.nullable(), eventName: text,
    properties: z.unknown().refine(finiteJson, "Event properties must be bounded JSON"), timestamp,
  }).strict()).max(100000),
}).strict();

export type DatasetBackup = z.infer<typeof backupSchema>;

export class DatasetBackupError extends Error {}
export class DatasetConflictError extends Error {
  constructor(public code: "revision_conflict" | "pending_capture", public revision: number) { super(code === "pending_capture" ? "This revision has uncaptured changes. Confirm discarding this exact revision after creating its checkpoint." : "Dataset changed in another operation. Review the current revision again."); }
}

export function parseDatasetBackup(value: unknown): DatasetBackup {
  value = unwrapCheckpoint(value);
  const result = backupSchema.safeParse(value);
  if (!result.success) {
    throw new DatasetBackupError(result.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 1000));
  }
  const backup = result.data;
  if (backup.schemaVersion === 2 && backup.metadata && (!backup.metadata.sourceId || !backup.attributeHistory)) throw new DatasetBackupError("Version 2 needs source identity and attribute history");
  if (backup.attributeHistory) {
    try {
      if (!backup.metadata?.sourceId && (backup.attributeHistory.customers.length || backup.attributeHistory.plans.length)) throw new Error("SCD2 needs a source identity");
      validateSnapshotRows(backup.attributeHistory.customers, backup.metadata?.sourceId ?? "", "customer");
      validateSnapshotRows(backup.attributeHistory.plans, backup.metadata?.sourceId ?? "", "plan");
    } catch { throw new DatasetBackupError("Invalid SCD2 history or overlapping versions"); }
  }
  const tables = [backup.customers, backup.plans, backup.subscriptions, backup.invoices, backup.payments, backup.productEvents];
  if (tables.reduce((sum, rows) => sum + rows.length, 0) + (backup.attributeHistory?.customers.length ?? 0) + (backup.attributeHistory?.plans.length ?? 0) > 250000) throw new DatasetBackupError("Backup exceeds 250000 business records");
  for (const rows of tables) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new DatasetBackupError("Duplicate record IDs");
  }
  if (backup.customers.length && !backup.metadata) throw new DatasetBackupError("A populated dataset requires metadata");
  const customers = new Set(backup.customers.map((row) => row.id));
  const plans = new Map(backup.plans.map((row) => [row.id, row]));
  const subscriptions = new Map(backup.subscriptions.map((row) => [row.id, row]));
  const invoices = new Map(backup.invoices.map((row) => [row.id, row]));
  const customerRows = new Map(backup.customers.map(row => [row.id, row]));
  const asOf = backup.metadata?.asOf;
  if (asOf) {
    if (asOf > new Date().toISOString()) throw new DatasetBackupError("Observation date cannot be in the future");
    const invalidCoverage = coverageError(asOf, backup.metadata?.historyStart, backup.metadata?.historyComplete);
    if (invalidCoverage) throw new DatasetBackupError(invalidCoverage);
    const check = (date: string | null | undefined, earliest?: string) => { const error = factDateError(date, asOf, earliest); if (error) throw new DatasetBackupError(error); };
    for (const row of backup.customers) { check(row.createdAt); check(row.convertedAt, row.createdAt); check(row.churnedAt, row.convertedAt ?? row.createdAt); }
    // Plan creation is a source fact; import/export/SCD2 capture timestamps deliberately are not checked against asOf.
    for (const row of backup.plans) check(row.createdAt);
    for (const row of backup.subscriptions) { check(row.startedAt, customerRows.get(row.customerId)?.createdAt); check(row.endedAt, row.startedAt); }
    for (const row of backup.invoices) { check(row.invoiceDate, customerRows.get(row.customerId)?.createdAt); check(row.failedAt, row.invoiceDate); check(row.paidAt, row.failedAt ?? row.invoiceDate); }
    for (const row of backup.payments) check(row.processedAt, invoices.get(row.invoiceId)?.invoiceDate);
    for (const row of backup.productEvents) check(row.timestamp, customerRows.get(row.customerId)?.createdAt);
  }
  if (invalidIntervals(backup.subscriptions).length) throw new DatasetBackupError("Subscription intervals must have positive duration and cannot overlap for one customer");
  for (const customer of backup.customers) {
    if ([customer.convertedAt, customer.churnedAt].some((date) => date !== null && date < customer.createdAt)) throw new DatasetBackupError("Customer lifecycle dates precede creation");
  }
  for (const subscription of backup.subscriptions) {
    const plan = plans.get(subscription.planId);
    if (!customers.has(subscription.customerId) || !plan || plan.billingInterval !== subscription.billingInterval) throw new DatasetBackupError("Subscription has an invalid customer/plan relationship");
    if (subscription.endedAt !== null && subscription.endedAt < subscription.startedAt) throw new DatasetBackupError("Subscription end precedes its start");
  }
  for (const invoice of backup.invoices) {
    if (!customers.has(invoice.customerId) || (invoice.subscriptionId !== null && subscriptions.get(invoice.subscriptionId)?.customerId !== invoice.customerId)) throw new DatasetBackupError("Invoice has an invalid customer/subscription relationship");
    if (backup.metadata && invoice.currency !== backup.metadata.currency) throw new DatasetBackupError("Invoice currency differs from dataset currency");
  }
  for (const payment of backup.payments) {
    if (invoices.get(payment.invoiceId)?.customerId !== payment.customerId || !customers.has(payment.customerId)) throw new DatasetBackupError("Payment has an invalid customer/invoice relationship");
  }
  for (const event of backup.productEvents) {
    if (!customers.has(event.customerId)) throw new DatasetBackupError("Event has an invalid customer relationship");
  }
  return backup;
}

export function isLocalDatasetRequest(request: Request): boolean {
  if (process.env.LOCAL_WORKSPACE_MODE !== "true" || process.env.DEMO_MODE === "true") return false;
  const hostname = new URL(request.url).hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

// Raw capture must also preserve a pending/invalid revision. Validation belongs to export/restore, not to the safety checkpoint.
export async function captureDataset(tx: Prisma.TransactionClient): Promise<unknown> {
    const [metadata, customers, plans, subscriptions, invoices, payments, productEvents] = await Promise.all([
      tx.datasetMetadata.findUnique({ where: { id: "local" } }),
      tx.customer.findMany({ orderBy: { id: "asc" } }), tx.plan.findMany({ orderBy: { id: "asc" } }),
      tx.subscription.findMany({ orderBy: { id: "asc" } }), tx.invoice.findMany({ orderBy: { id: "asc" } }),
      tx.payment.findMany({ orderBy: { id: "asc" } }), tx.productEvent.findMany({ orderBy: { id: "asc" } }),
    ]);
    const attributeHistory = isWarehouseRuntime() ? { customers: await readSnapshotRows(tx,"customer"), plans: await readSnapshotRows(tx,"plan") } : { customers: [], plans: [] };
    return JSON.parse(JSON.stringify({ attributeHistory, format: "revlens-dataset", schemaVersion: 2, exportedAt: new Date().toISOString(), metadata, customers, plans, subscriptions, invoices, payments, productEvents }, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function exportDatasetBackup(db: PrismaClient): Promise<DatasetBackup> {
  const snapshot = await db.$transaction(captureDataset, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  const serialized = JSON.stringify(snapshot, (_, item) => typeof item === "bigint" ? item.toString() : item);
  if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES - 1024) throw new DatasetBackupError("Backup exceeds the 25 MiB local restore limit");
  return parseDatasetBackup(JSON.parse(serialized));
}

export async function restoreDatasetBackup(db: PrismaClient, value: unknown, options: { expectedRevision: number; discardPendingRevision?: number }): Promise<DatasetBackup & { checkpointId: string }> {
  const backup = parseDatasetBackup(value);
  let checkpointId = "";
  await db.$transaction(async (tx) => {
    // One replacement at a time, including concurrent import writes; auth tables are never touched.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261020, 2)`;
    const current = await tx.datasetMetadata.findUnique({ where: { id: "local" } });
    const revision = current?.revision ?? 0;
    if (options.expectedRevision !== revision) throw new DatasetConflictError("revision_conflict", revision);
    if (current && (current.pipelineStatus !== "ready" || current.analyticsRevision !== revision) && options.discardPendingRevision !== revision) throw new DatasetConflictError("pending_capture", revision);
    checkpointId = await saveCheckpoint(await captureDataset(tx), revision, "restore");
    if (isWarehouseRuntime()) await resetSnapshotRows(tx);
    await tx.$executeRaw`LOCK TABLE customers, plans, subscriptions, invoices, payments, product_events IN SHARE ROW EXCLUSIVE MODE`;
    await tx.payment.deleteMany();
    await tx.productEvent.deleteMany();
    await tx.invoice.deleteMany();
    await tx.subscription.deleteMany();
    await tx.customer.deleteMany();
    await tx.plan.deleteMany();
    await tx.datasetMetadata.deleteMany();
    // ponytail: chunks avoid PostgreSQL's parameter ceiling; no parallel writes inside this transaction.
    for (let offset = 0; offset < backup.customers.length; offset += 1000) await tx.customer.createMany({ data: backup.customers.slice(offset, offset + 1000) });
    for (let offset = 0; offset < backup.plans.length; offset += 1000) await tx.plan.createMany({ data: backup.plans.slice(offset, offset + 1000) });
    for (let offset = 0; offset < backup.subscriptions.length; offset += 1000) await tx.subscription.createMany({ data: backup.subscriptions.slice(offset, offset + 1000) });
    for (let offset = 0; offset < backup.invoices.length; offset += 1000) await tx.invoice.createMany({ data: backup.invoices.slice(offset, offset + 1000) });
    for (let offset = 0; offset < backup.payments.length; offset += 1000) await tx.payment.createMany({ data: backup.payments.slice(offset, offset + 1000) });
    for (let offset = 0; offset < backup.productEvents.length; offset += 1000) {
      await tx.productEvent.createMany({ data: backup.productEvents.slice(offset, offset + 1000).map((event) => ({
        ...event, id: BigInt(event.id), properties: event.properties === null ? Prisma.DbNull : event.properties as Prisma.InputJsonValue,
      })) });
    }
    if (backup.metadata) await tx.datasetMetadata.create({ data: { ...backup.metadata,
      sourceId: backup.metadata.sourceId ?? randomUUID(), sourceName: backup.metadata.sourceName ?? "Restored legacy dataset",
      historyStart: backup.metadata.historyStart ?? null, historyComplete: backup.schemaVersion === 2 && (backup.metadata.historyComplete ?? false),
      revision: Math.max(current?.revision ?? 0, backup.metadata.revision ?? 0) + 1, analyticsRevision: -1, pipelineStatus: "pending",
    } });
    if (isWarehouseRuntime() && backup.attributeHistory) {
      await restoreSnapshotRows(tx,"customer",backup.attributeHistory.customers);
      await restoreSnapshotRows(tx,"plan",backup.attributeHistory.plans);
    }
    // Explicit IDs must not collide with the next generated event ID after restore.
    await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('product_events', 'id'), COALESCE((SELECT MAX(id) FROM product_events), 0) + 1, false)`;
  }, { timeout: 60000 });
  return { ...backup, checkpointId };
}
