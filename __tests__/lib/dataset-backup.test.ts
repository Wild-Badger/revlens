// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { DatasetBackupError, exportDatasetBackup, isLocalDatasetRequest, parseDatasetBackup, restoreDatasetBackup, RESTORE_CONFIRMATION } from "@/lib/dataset-backup";

const { auth, database } = vi.hoisted(() => ({ auth: vi.fn(), database: { $transaction: vi.fn() } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ prisma: database }));

const ids = {
  customer: "c4617d29-1108-46ea-97f5-e078c0a17014", plan: "4566546e-7da2-4c88-b4a2-1c12f52cb91a",
  subscription: "bef25ae6-3497-4cdd-b9e2-079f7f5e34db", invoice: "b4bfbfe8-a956-440c-90e1-86c554c1eced", payment: "af40a7fc-fc41-4cc8-b865-b7ad3534d20d",
};
const date = "2026-10-01T00:00:00.000Z";
function fixture() {
  return {
    format: "revlens-dataset", schemaVersion: 1, exportedAt: date,
    metadata: { id: "local", asOf: date, importedAt: date, rowCount: 1, currency: "USD" },
    customers: [{ id: ids.customer, name: "Synthetic Açai, LLC", domain: null, industry: "Software", companySize: "1-10", country: "US", acquisitionChannel: "organic", createdAt: date, convertedAt: date, churnedAt: null, status: "active" }],
    plans: [{ id: ids.plan, name: "Synthetic Plan", billingInterval: "monthly", basePrice: "99.99", seatPrice: "0", createdAt: date }],
    subscriptions: [{ id: ids.subscription, customerId: ids.customer, planId: ids.plan, status: "active", startedAt: date, endedAt: null, billingInterval: "monthly", currentMrr: "99.99", seats: 1 }],
    invoices: [{ id: ids.invoice, customerId: ids.customer, subscriptionId: ids.subscription, amount: "99.99", currency: "USD", status: "paid", invoiceDate: date, paidAt: date, failedAt: null }],
    payments: [{ id: ids.payment, customerId: ids.customer, invoiceId: ids.invoice, amount: "99.99", status: "succeeded", paymentMethod: "synthetic", processedAt: date }],
    productEvents: [{ id: "9007199254740993", customerId: ids.customer, userId: null, eventName: "synthetic-check", properties: { count: 1, source: "fixture" }, timestamp: date }],
  };
}
function transactionMock() {
  const source = fixture();
  const calls: string[] = [];
  const tx: Record<string, unknown> = {
    $executeRaw: vi.fn(async () => calls.push("lock")),
    $queryRaw: vi.fn(async () => calls.push("sequence")),
  };
  for (const [table, rows] of Object.entries({ customer: source.customers, plan: source.plans, subscription: source.subscriptions, invoice: source.invoices, payment: source.payments, productEvent: source.productEvents })) {
    tx[table] = {
      findMany: vi.fn(async () => table === "productEvent" ? rows.map((row) => ({ ...row, id: BigInt(row.id) })) : rows),
      deleteMany: vi.fn(async () => calls.push(`delete:${table}`)),
      createMany: vi.fn(async () => calls.push(`create:${table}`)),
    };
  }
  tx.datasetMetadata = { findUnique: vi.fn(async () => source.metadata), deleteMany: vi.fn(), create: vi.fn() };
  const db = { $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)) };
  return { tx, db: db as unknown as PrismaClient, calls };
}

describe("local business backup contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LOCAL_WORKSPACE_MODE", "true");
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("AUTH_URL", "");
    auth.mockResolvedValue({ user: { id: "synthetic-owner", role: "admin" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires the configured browser origin despite Next's internal localhost URL", async () => {
    const { POST } = await import("@/app/api/dataset/restore/route");
    vi.stubEnv("AUTH_URL", "http://127.0.0.1:3101");
    const local = (origin?: string) => new Request("http://localhost:3101/api/dataset/restore", { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json", host: "127.0.0.1:3102", "x-forwarded-host": "127.0.0.1:3102" }, body: JSON.stringify({}) });
    // 400 proves canonical origin passed the guard and reached the confirmation check.
    expect((await POST(local("http://127.0.0.1:3101"))).status).toBe(400);
    expect((await POST(local("http://127.0.0.1:3102"))).status).toBe(403);
    expect((await POST(local("http://localhost:3101"))).status).toBe(403);
    expect((await POST(local("https://example.test"))).status).toBe(403);
    expect((await POST(local())).status).toBe(403);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("preserves cents and bigint IDs without accepting authentication records", () => {
    const backup = fixture();
    expect(parseDatasetBackup(backup).productEvents[0].id).toBe("9007199254740993");
    expect(parseDatasetBackup(backup).invoices[0].amount).toBe("99.99");
    expect(() => parseDatasetBackup({ ...backup, users: [{ email: "excluded@example.test" }] })).toThrow(DatasetBackupError);
  });

  it.each([
    ["impossible date", (backup: ReturnType<typeof fixture>) => { backup.customers[0].createdAt = "2026-02-30T00:00:00.000Z"; }],
    ["negative money", (backup: ReturnType<typeof fixture>) => { backup.invoices[0].amount = "-1"; }],
    ["money overflow", (backup: ReturnType<typeof fixture>) => { backup.plans[0].basePrice = "10000000000"; }],
    ["fractional seats", (backup: ReturnType<typeof fixture>) => { backup.subscriptions[0].seats = 1.5; }],
    ["duplicate UUID", (backup: ReturnType<typeof fixture>) => { backup.customers.push(backup.customers[0]); }],
    ["unknown customer", (backup: ReturnType<typeof fixture>) => { backup.payments[0].customerId = ids.plan; }],
    ["cross-customer invoice", (backup: ReturnType<typeof fixture>) => { backup.invoices[0].customerId = ids.plan; }],
    ["invalid event ID", (backup: ReturnType<typeof fixture>) => { backup.productEvents[0].id = "not-a-number"; }],
    ["overflow event ID", (backup: ReturnType<typeof fixture>) => { backup.productEvents[0].id = "9223372036854775807"; }],
    ["different currency", (backup: ReturnType<typeof fixture>) => { backup.invoices[0].currency = "EUR"; }],
  ])("rejects %s before opening a transaction", async (_, change) => {
    const backup = fixture();
    change(backup);
    const { db } = transactionMock();
    await expect(restoreDatasetBackup(db, backup)).rejects.toBeInstanceOf(DatasetBackupError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("exports only business tables from one repeatable-read snapshot", async () => {
    const { db } = transactionMock();
    const backup = await exportDatasetBackup(db);
    expect(backup.productEvents[0].id).toBe("9007199254740993");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60000 });
    expect(Object.keys(backup).sort()).toEqual(["format", "schemaVersion", "exportedAt", "metadata", "customers", "plans", "subscriptions", "invoices", "payments", "productEvents"].sort());
  });

  it("replaces in FK order in a single transaction, retaining event ID precision", async () => {
    const { tx, db, calls } = transactionMock();
    await restoreDatasetBackup(db, fixture());
    expect(calls).toEqual(["lock", "lock", "delete:payment", "delete:productEvent", "delete:invoice", "delete:subscription", "delete:customer", "delete:plan", "create:customer", "create:plan", "create:subscription", "create:invoice", "create:payment", "create:productEvent", "sequence"]);
    expect((tx.productEvent as { createMany: ReturnType<typeof vi.fn> }).createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 9007199254740993n })] });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx).not.toHaveProperty("user");
    expect(tx).not.toHaveProperty("session");
  });

  it("propagates a failed write out of the transaction for database rollback", async () => {
    const { db, tx } = transactionMock();
    (tx.invoice as { createMany: ReturnType<typeof vi.fn> }).createMany.mockRejectedValue(new Error("synthetic write failure"));
    await expect(restoreDatasetBackup(db, fixture())).rejects.toThrow("synthetic write failure");
    expect((tx.datasetMetadata as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("requires explicit local mode, non-demo and a loopback hostname", () => {
    expect(isLocalDatasetRequest(new Request("http://127.0.0.1:3101/api/dataset/backup"))).toBe(true);
    expect(isLocalDatasetRequest(new Request("https://example.test/api/dataset/backup"))).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(isLocalDatasetRequest(new Request("http://localhost/api/dataset/backup"))).toBe(false);
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("LOCAL_WORKSPACE_MODE", "false");
    expect(isLocalDatasetRequest(new Request("http://localhost/api/dataset/backup"))).toBe(false);
  });

  it("guards both routes before database access", async () => {
    const { GET } = await import("@/app/api/dataset/backup/route");
    const { POST } = await import("@/app/api/dataset/restore/route");
    vi.stubEnv("DEMO_MODE", "true");
    expect((await GET(new Request("http://localhost/api/dataset/backup"))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/dataset/restore", { method: "POST" }))).status).toBe(403);
    vi.stubEnv("DEMO_MODE", "false");
    auth.mockResolvedValue({ user: { role: "viewer" } });
    expect((await GET(new Request("http://localhost/api/dataset/backup"))).status).toBe(403);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, unconfirmed, invalid and oversized restore requests", async () => {
    const { POST } = await import("@/app/api/dataset/restore/route");
    const request = (body: unknown, extra: Record<string, string> = {}) => new Request("http://localhost/api/dataset/restore", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
    expect((await POST(request({}, { origin: "https://example.test" }))).status).toBe(403);
    expect((await POST(request({ backup: fixture() }))).status).toBe(400);
    expect((await POST(request({ confirmation: RESTORE_CONFIRMATION, backup: { ...fixture(), accounts: [] } }))).status).toBe(400);
    expect((await POST(request({}, { "content-length": "30000000" }))).status).toBe(413);
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
