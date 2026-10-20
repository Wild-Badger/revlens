// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { detectColumns, IMPORT_COLUMNS, MAX_IMPORT_BYTES, parseCSV, TEMPLATE_CSV, validateImportCSV } from "@/lib/import/csv-validator";
import { importCustomersData, stableImportId } from "@/lib/import/import-service";
import { reuseColumnMappings } from "@/lib/import/column-mappings";

const fixture = () => parseCSV(TEMPLATE_CSV);
const encode = (headers: string[], rows: string[][]) => [headers, ...rows].map(row => row.map(cell => /[,"\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(",")).join("\r\n");
function changed(field: string, value: string) {
  const { headers, rows } = fixture(); rows[0][headers.indexOf(field)] = value; return encode(headers, rows);
}
function historyFixture() {
  const { headers, rows } = fixture(); headers.push("subscription_id");
  const intervals = [
    ["first", "2026-01-10", "2026-06-01", "125.50"],
    ["upgrade", "2026-06-01", "2026-07-01", "200"],
    ["downgrade", "2026-07-01", "2026-08-01", "100"],
    ["return", "2026-09-05", "", "160"],
  ];
  return { headers, rows: intervals.map(([id, start, end, mrr]) => {
    const row = [...rows[0], id];
    for (const field of headers.filter(header => header.startsWith("event_") || header.startsWith("invoice_"))) row[headers.indexOf(field)] = "";
    for (const [field, value] of Object.entries({ status: "reactivated", subscription_started_at: start, subscription_ended_at: end, mrr, invoice_id: `invoice-${id}`, invoice_amount: mrr, invoice_status: "paid", invoice_date: start })) row[headers.indexOf(field)] = value;
    return row;
  }) };
}
afterEach(() => vi.unstubAllEnvs());

describe("canonical dated CSV contract", () => {
  it("validates the downloadable fixture and reconciles its exact totals", () => {
    const result = validateImportCSV(TEMPLATE_CSV);
    expect(result.errors).toEqual([]);
    expect(result.validRows[0].name).toBe("Café North, Ltd");
    expect(result.summary).toMatchObject({ totalRows: 3, validRows: 3, customers: 3, subscriptions: 3, invoices: 3, events: 4, mrr: 200, invoiceTotal: 440, asOf: "2026-09-30", currency: "USD" });
  });
  it("parses escaped quotes, quoted newlines, CRLF and BOM through the same parser", () => {
    const source = changed("name", 'Café "North"\nLtd');
    expect(validateImportCSV(`\uFEFF${source}`).errors).toEqual([]);
    expect(parseCSV(source).rows[0][1]).toBe('Café "North"\nLtd');
    expect(parseCSV(source).rowNumbers).toEqual([2, 4, 5]);
    expect(() => parseCSV('name\n"unclosed')).toThrow("unclosed");
    expect(() => parseCSV('name\n"closed"junk')).toThrow("unexpected text");
    expect(() => parseCSV('name,name\nx,y')).toThrow("unique");
  });
  it("uses the user's mapping for actual values, never aliases ARR, and rejects row shape loss", () => {
    const { headers, rows } = fixture();
    headers[headers.indexOf("mrr")] = "Monthly value";
    const source = encode(headers, rows);
    const mapping = Object.fromEntries(detectColumns(headers).map(item => [item.column, item.sourceHeader]));
    expect(validateImportCSV(source, mapping).errors.length).toBeGreaterThan(0);
    mapping.mrr = "Monthly value";
    expect(validateImportCSV(source, mapping).summary.mrr).toBe(200);
    expect(validateImportCSV(source, mapping).errors).toEqual([]);
    mapping.mrr = null;
    expect(validateImportCSV(source, mapping).errors.length).toBeGreaterThan(0);
    expect(detectColumns(["ARR", "revenue", "cash"]).find(item => item.column === "mrr")?.sourceHeader).toBeNull();
    const missingHeaders = IMPORT_COLUMNS.filter(([column, required]) => required && !detectColumns(["name"]).find(item => item.column === column)?.sourceHeader);
    expect(missingHeaders.length).toBeGreaterThan(0);
    expect(validateImportCSV(TEMPLATE_CSV.replace("sample-001,", "sample-001,extra,")).errors).toContainEqual(expect.objectContaining({ field: "row" }));
  });
  it.each([["subscription_started_at", "2026-02-30"], ["invoice_date", "2026-13-01"], ["event_date", "not-a-date"], ["invoice_paid_at", "2026-10-01"], ["mrr", "1e3"], ["mrr", "125.555"], ["mrr", "-1"], ["currency", "EUR"], ["event_count", "1000000"], ["seats", "1.5"]])("rejects invalid %s=%s instead of inventing/coercing it", (field, value) => {
    expect(validateImportCSV(changed(field, value)).errors).toContainEqual(expect.objectContaining({ field }));
  });
  it("requires complete dated facts, rejects unsupported financial inputs and avoids duplicate facts", () => {
    expect(validateImportCSV(changed("subscription_started_at", "")).errors).toContainEqual(expect.objectContaining({ field: "subscription_started_at" }));
    expect(validateImportCSV(changed("invoice_id", "")).errors).toContainEqual(expect.objectContaining({ field: "invoice_id" }));
    expect(validateImportCSV(changed("event_date", "")).errors).toContainEqual(expect.objectContaining({ field: "event_date" }));
    const { headers, rows } = fixture();
    expect(validateImportCSV(encode([...headers, "arr"], rows.map(row => [...row, "1200"]))).errors).toContainEqual(expect.objectContaining({ field: "arr" }));
    const repeated = validateImportCSV(encode(headers, [rows[0], rows[0], rows[1], rows[2]]));
    expect(repeated.errors).toEqual([]);
    expect(repeated.summary).toMatchObject({ customers: 3, subscriptions: 3, invoices: 3, events: 4, mrr: 200 });
    const conflict = [...rows[0]]; conflict[headers.indexOf("mrr")] = "999";
    expect(validateImportCSV(encode(headers, [rows[0], conflict])).errors).toContainEqual(expect.objectContaining({ field: "subscription_started_at" }));
  });
  it("bounds bytes, rows and expanded events before database writes", () => {
    expect(() => parseCSV("x".repeat(MAX_IMPORT_BYTES + 1))).toThrow("2 MiB");
    expect(() => parseCSV(`name\n${"a\n".repeat(2001)}`)).toThrow("2000");
    const { headers, rows } = fixture();
    const many = Array.from({ length: 11 }, (_, index) => { const row = [...rows[0]]; row[headers.indexOf("event_id")] = `group-${index}`; row[headers.indexOf("event_count")] = "1000"; return row; });
    expect(validateImportCSV(encode(headers, many)).errors).toContainEqual(expect.objectContaining({ field: "event_count" }));
  });
  it("accepts touching price intervals and a dated reactivation gap without counting ended MRR", () => {
    const { headers, rows } = historyFixture();
    const result = validateImportCSV(encode(headers, [...rows].reverse()));
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({ customers: 1, subscriptions: 4, invoices: 4, events: 0, mrr: 160, invoiceTotal: 585.5 });
    expect(validateImportCSV(encode(headers, [...rows, rows[1]])).summary.subscriptions).toBe(4);
  });
  it("rejects overlapping, contradictory, or incomplete interval histories instead of flattening them", () => {
    const { headers, rows } = historyFixture();
    const set = (row: string[], field: string, value: string) => { const changed = [...row]; changed[headers.indexOf(field)] = value; return changed; };
    expect(validateImportCSV(encode(headers, [rows[0], set(rows[1], "subscription_started_at", "2026-05-31"), ...rows.slice(2)])).errors).toContainEqual(expect.objectContaining({ field: "subscription_started_at", message: expect.stringContaining("overlap") }));
    expect(validateImportCSV(encode(headers, rows.slice(0, 3))).errors).toContainEqual(expect.objectContaining({ field: "status" }));
    expect(validateImportCSV(encode(headers, [rows[0], set(rows[1], "subscription_id", "first"), ...rows.slice(2)])).errors).toContainEqual(expect.objectContaining({ field: "subscription_started_at", message: expect.stringContaining("Conflicting") }));
    expect(validateImportCSV(encode(headers, [rows[0], set(rows[1], "invoice_id", "invoice-first"), ...rows.slice(2)])).errors).toContainEqual(expect.objectContaining({ field: "invoice_id" }));
    expect(validateImportCSV(encode(headers, [rows[0], set(rows[1], "country", "Different"), ...rows.slice(2)])).errors).toContainEqual(expect.objectContaining({ field: "customer_id" }));
    expect(validateImportCSV(encode(headers, rows.map(row => set(row, "subscription_id", "")))).errors).toContainEqual(expect.objectContaining({ field: "subscription_started_at" }));
  });
  it("reuses only valid column names from saved mapping and ignores malformed or ambiguous preferences", () => {
    const headers = ["Customer name", "ID"], detected = { name: "Customer name", customer_id: null };
    expect(reuseColumnMappings(headers, detected, JSON.stringify({ customer_id: "ID", mrr: "Missing", secret: "ignored" }))).toEqual({ name: "Customer name", customer_id: "ID" });
    expect(reuseColumnMappings(headers, detected, JSON.stringify({ customer_id: "Customer name" }))).toEqual(detected);
    expect(reuseColumnMappings(headers, detected, "broken JSON")).toEqual(detected);
    expect(reuseColumnMappings(headers, detected, "[]")).toEqual(detected);
  });
});

function transactionStore(failInvoices = false) {
  type RecordValue = Record<string, unknown>;
  const original: Record<string, RecordValue[]> = { customer: [{ id: "prior-customer" }], plan: [{ id: "prior-plan" }], invoice: [], payment: [], productEvent: [], subscription: [], datasetMetadata: [{ id: "local" }] };
  let state = structuredClone(original);
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<void>) => {
    const working = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, records.map(record => ({ ...record }))]));
    const tx: Record<string, unknown> = { $executeRaw: vi.fn() };
    for (const name of Object.keys(working)) tx[name] = {
      deleteMany: vi.fn(async () => { working[name] = []; }),
      createMany: vi.fn(async ({ data }: { data: RecordValue[] }) => { if (failInvoices && name === "invoice") throw new Error("synthetic storage failure"); working[name].push(...data); }),
      upsert: vi.fn(async ({ create }: { create: RecordValue }) => { working[name] = [create]; }),
    };
    await run(tx); state = working;
  });
  return { prisma: { $transaction: transaction } as unknown as PrismaClient, transaction, state: () => state, original };
}
function localMode() { vi.stubEnv("LOCAL_WORKSPACE_MODE", "true"); vi.stubEnv("DEMO_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false"); }

describe("all-or-nothing dedicated dataset replacement", () => {
  it("writes all historical intervals with stable invoice links and original conversion date regardless of row order", async () => {
    localMode(); const store = transactionStore(); const { headers, rows } = historyFixture();
    const result = await importCustomersData(store.prisma, validateImportCSV(encode(headers, [...rows].reverse())));
    expect(result.counts).toMatchObject({ customers: 1, subscriptions: 4, invoices: 4 });
    const first = store.state();
    expect(first.customer[0]).toMatchObject({ convertedAt: new Date("2026-01-10T00:00:00Z"), churnedAt: null, status: "reactivated" });
    expect(first.subscription).toHaveLength(4);
    expect(new Set(first.subscription.map(row => row.id)).size).toBe(4);
    for (const invoice of first.invoice) {
      const interval = first.subscription.find(row => row.id === invoice.subscriptionId)!;
      expect(interval.customerId).toBe(invoice.customerId);
      expect(interval.startedAt).toEqual(invoice.invoiceDate);
      expect(interval.currentMrr).toEqual(invoice.amount);
    }
    await importCustomersData(store.prisma, validateImportCSV(encode(headers, [...rows].reverse())));
    expect(store.state()).toEqual(first);
  });
  it("records current churn from the latest interval, keeping the earliest conversion date", async () => {
    localMode(); const store = transactionStore(); const { headers, rows } = historyFixture();
    for (const row of rows) row[headers.indexOf("status")] = "churned";
    rows[3][headers.indexOf("subscription_ended_at")] = "2026-09-10";
    const validation = validateImportCSV(encode(headers, rows));
    expect(validation.errors).toEqual([]); expect(validation.summary.mrr).toBe(0);
    await importCustomersData(store.prisma, validation);
    expect(store.state().customer[0]).toMatchObject({ convertedAt: new Date("2026-01-10T00:00:00Z"), churnedAt: new Date("2026-09-10T00:00:00Z") });
  });
  it("writes real dates, stable UUID links, named plans, null unknown paid dates and inclusive metadata", async () => {
    localMode(); const store = transactionStore();
    const result = await importCustomersData(store.prisma, validateImportCSV(changed("invoice_paid_at", "")));
    expect(result).toMatchObject({ imported: 3, total: 3, counts: { customers: 3, subscriptions: 3, invoices: 3, events: 4 } });
    expect(store.transaction).toHaveBeenCalledTimes(1);
    expect(store.state().customer[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store.state().subscription[0]).toMatchObject({ customerId: store.state().customer[0].id, startedAt: new Date("2026-01-10T00:00:00Z") });
    expect(store.state().subscription[0].id).toBe(stableImportId("subscription", "sample-001"));
    expect(store.state().plan.map(row => row.name)).toEqual(["Studio", "Team"]);
    expect(store.state().invoice[0].paidAt).toBeNull();
    expect(store.state().productEvent[0].timestamp).toEqual(new Date("2026-09-28T00:00:00Z"));
    expect(store.state().datasetMetadata[0].asOf).toEqual(new Date("2026-09-30T23:59:59.999Z"));
  });
  it("reimporting an equivalent file does not accumulate invoices or events", async () => {
    localMode(); const store = transactionStore(); const validation = validateImportCSV(TEMPLATE_CSV);
    await importCustomersData(store.prisma, validation); const first = store.state();
    await importCustomersData(store.prisma, validation);
    expect(store.state()).toEqual(first);
    expect(store.state().invoice).toHaveLength(3); expect(store.state().productEvent).toHaveLength(4);
    expect(stableImportId("customer", "00000000-0000-4000-8000-000000000001")).toBe("00000000-0000-4000-8000-000000000001");
  });
  it("propagates write failure so the database transaction rolls back all earlier operations", async () => {
    localMode(); const store = transactionStore(true);
    await expect(importCustomersData(store.prisma, validateImportCSV(TEMPLATE_CSV))).rejects.toThrow("synthetic storage failure");
    expect(store.state()).toEqual(store.original);
  });
  it("rejects a synthetic demo or invalid file before even starting a transaction", async () => {
    localMode(); const store = transactionStore(); vi.stubEnv("DEMO_MODE", "true");
    await expect(importCustomersData(store.prisma, validateImportCSV(TEMPLATE_CSV))).rejects.toThrow("dedicated local");
    expect(store.transaction).not.toHaveBeenCalled();
    localMode(); await expect(importCustomersData(store.prisma, validateImportCSV(changed("mrr", "nonsense")))).rejects.toThrow("Validate");
    expect(store.transaction).not.toHaveBeenCalled();
  });
});
