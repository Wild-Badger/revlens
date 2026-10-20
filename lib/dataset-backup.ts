import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

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
  schemaVersion: z.literal(1),
  exportedAt: timestamp,
  metadata: z.object({ id: z.literal("local"), asOf: timestamp, currency: z.literal("USD"), importedAt: timestamp, rowCount: z.number().int().min(0).max(100000) }).strict().nullable(),
  customers: z.array(z.object({
    id: uuid, name: text, domain: text.nullable(), industry: text, companySize: text,
    country: text, acquisitionChannel: text, createdAt: timestamp, convertedAt: timestamp.nullable(),
    churnedAt: timestamp.nullable(), status: z.enum(["lead", "active", "churned", "reactivated"]),
  }).strict()).max(20000),
  plans: z.array(z.object({
    id: uuid, name: text, billingInterval: interval, basePrice: money, seatPrice: money, createdAt: timestamp,
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

export function parseDatasetBackup(value: unknown): DatasetBackup {
  const result = backupSchema.safeParse(value);
  if (!result.success) {
    throw new DatasetBackupError(result.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 1000));
  }
  const backup = result.data;
  const tables = [backup.customers, backup.plans, backup.subscriptions, backup.invoices, backup.payments, backup.productEvents];
  if (tables.reduce((sum, rows) => sum + rows.length, 0) > 250000) throw new DatasetBackupError("Backup exceeds 250000 business records");
  for (const rows of tables) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new DatasetBackupError("Duplicate record IDs");
  }
  if (backup.customers.length && !backup.metadata) throw new DatasetBackupError("A populated dataset requires metadata");
  const customers = new Set(backup.customers.map((row) => row.id));
  const plans = new Map(backup.plans.map((row) => [row.id, row]));
  const subscriptions = new Map(backup.subscriptions.map((row) => [row.id, row]));
  const invoices = new Map(backup.invoices.map((row) => [row.id, row]));
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

export async function exportDatasetBackup(db: PrismaClient): Promise<DatasetBackup> {
  const snapshot = await db.$transaction(async (tx) => {
    const [metadata, customers, plans, subscriptions, invoices, payments, productEvents] = await Promise.all([
      tx.datasetMetadata.findUnique({ where: { id: "local" } }),
      tx.customer.findMany({ orderBy: { id: "asc" }, take: 20001 }), tx.plan.findMany({ orderBy: { id: "asc" }, take: 1001 }),
      tx.subscription.findMany({ orderBy: { id: "asc" }, take: 100001 }), tx.invoice.findMany({ orderBy: { id: "asc" }, take: 100001 }),
      tx.payment.findMany({ orderBy: { id: "asc" }, take: 100001 }), tx.productEvent.findMany({ orderBy: { id: "asc" }, take: 100001 }),
    ]);
    return { format: "revlens-dataset", schemaVersion: 1, exportedAt: new Date().toISOString(), metadata, customers, plans, subscriptions, invoices, payments, productEvents };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
  const serialized = JSON.stringify(snapshot, (_, item) => typeof item === "bigint" ? item.toString() : item);
  if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES - 1024) throw new DatasetBackupError("Backup exceeds the 25 MiB local restore limit");
  return parseDatasetBackup(JSON.parse(serialized));
}

export async function restoreDatasetBackup(db: PrismaClient, value: unknown): Promise<DatasetBackup> {
  const backup = parseDatasetBackup(value);
  await db.$transaction(async (tx) => {
    // One replacement at a time, including concurrent import writes; auth tables are never touched.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261020, 2)`;
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
    if (backup.metadata) await tx.datasetMetadata.create({ data: backup.metadata });
    // Explicit IDs must not collide with the next generated event ID after restore.
    await tx.$queryRaw`SELECT setval(pg_get_serial_sequence('product_events', 'id'), COALESCE((SELECT MAX(id) FROM product_events), 0) + 1, false)`;
  }, { timeout: 60000 });
  return backup;
}
