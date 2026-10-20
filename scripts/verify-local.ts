/** Destructive synthetic-only integration check for the dedicated local workspace. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { DatasetBackup } from "../lib/dataset-backup";

const outputDir = process.argv[process.argv.indexOf("--output-dir") + 1];
assert(process.argv.includes("--output-dir") && outputDir && isAbsolute(outputDir), "Supply an absolute --output-dir for synthetic evidence");
const checks: { name: string; detail: unknown }[] = [];
const record = (name: string, detail: unknown = true) => checks.push({ name, detail });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// Ignore export time; a repeat import legitimately changes only importedAt.
function comparable(backup: DatasetBackup, ignoreImportTime = false) {
  return JSON.stringify({ ...backup, exportedAt: "ignored", metadata: backup.metadata && { ...backup.metadata, ...(ignoreImportTime ? { importedAt: "ignored" } : {}) } });
}

// Inject a genuine PostgreSQL unique violation after the service has deleted old rows.
// This adapter changes only this verifier's transaction; production service code is used as-is.
function failingCustomerWrite(db: PrismaClient): PrismaClient {
  return new Proxy(db, {
    get(target, key) {
      if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
        target.$transaction((tx) => work(new Proxy(tx, {
          get(transaction, model) {
            if (model === "customer") return new Proxy(transaction.customer, {
              get(customer, operation) {
                if (operation === "createMany") return (args: Prisma.CustomerCreateManyArgs) => {
                  const rows = Array.isArray(args.data) ? args.data : [args.data];
                  return customer.createMany({ ...args, data: [...rows, rows[0]] });
                };
                return Reflect.get(customer, operation);
              },
            });
            return Reflect.get(transaction, model);
          },
        })), options as Parameters<PrismaClient["$transaction"]>[1]);
      return Reflect.get(target, key);
    },
  });
}

async function main() {
  const settings = JSON.parse(await readFile(join(process.env.LOCALAPPDATA!, "RevLensLocalWorkspace", "owner-runtime.json"), "utf8"));
  assert(settings.kind === "revlens-local-v1" && settings.database === "revlens_local" && settings.user === "revlens_local_owner" && settings.databasePort === 55433, "Refusing an unrecognized database configuration");
  assert(typeof settings.password === "string" && /^[a-f0-9]{64}$/i.test(settings.password), "Invalid dedicated database credential format");
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(settings.user)}:${encodeURIComponent(settings.password)}@127.0.0.1:55433/revlens_local?schema=public`;
  process.env.LOCAL_WORKSPACE_MODE = "true";
  process.env.DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  const { prisma: db } = await import("../lib/db");
  try {
    const [identity] = await db.$queryRaw<{ database: string; user: string; address: string; port: number }[]>`SELECT current_database() AS database, current_user AS user, host(inet_server_addr()) AS address, inet_server_port() AS port`;
    assert.deepEqual(identity, { database: "revlens_local", user: "revlens_local_owner", address: "127.0.0.1", port: 55433 });
    record("dedicated_database_identity", identity);

    const { exportDatasetBackup, restoreDatasetBackup, parseDatasetBackup } = await import("../lib/dataset-backup");
    const { TEMPLATE_CSV, validateImportCSV } = await import("../lib/import/csv-validator");
    const { importCustomersData, stableImportId } = await import("../lib/import/import-service");
    const validation = validateImportCSV(TEMPLATE_CSV);
    assert.equal(validation.errors.length, 0);
    const initial = await exportDatasetBackup(db);
    const initialCounts = { customers: initial.customers.length, plans: initial.plans.length, subscriptions: initial.subscriptions.length, invoices: initial.invoices.length, payments: initial.payments.length, events: initial.productEvents.length };
    const initiallyEmpty = Object.values(initialCounts).every((count) => count === 0) && initial.metadata === null;
    if (!initiallyEmpty) {
      // Compare every business field to the public source, including nulls and stable IDs.
      // A partial previous verification is therefore resumable without trusting only counts.
      const rows = validation.validRows;
      const at = (date: string | undefined) => date ? `${date}T00:00:00.000Z` : null;
      const customerId = (id: string) => stableImportId("customer", id);
      const subscriptionId = (id: string) => stableImportId("subscription", id);
      const planId = (name: string, interval: string) => stableImportId("plan", JSON.stringify([name, interval]));
      const known = parseDatasetBackup({
        format: "revlens-dataset", schemaVersion: 1, exportedAt: initial.exportedAt,
        metadata: { id: "local", asOf: "2026-09-30T23:59:59.999Z", currency: "USD", importedAt: initial.metadata?.importedAt, rowCount: 3 },
        customers: rows.map((row) => ({ id: customerId(row.customer_id), name: row.name, domain: row.domain ?? null, industry: row.industry, companySize: row.company_size, country: row.country, acquisitionChannel: row.acquisition_channel, createdAt: at(row.customer_created_at), convertedAt: at(row.subscription_started_at), churnedAt: at(row.subscription_ended_at), status: row.status })),
        plans: [...new Map(rows.map((row) => [planId(row.plan_name!, row.billing_interval!), row])).values()].map((row) => ({ id: planId(row.plan_name!, row.billing_interval!), name: row.plan_name, billingInterval: row.billing_interval, basePrice: "0", seatPrice: "0", createdAt: "2026-09-30T00:00:00.000Z" })),
        subscriptions: rows.map((row) => ({ id: subscriptionId(row.customer_id), customerId: customerId(row.customer_id), planId: planId(row.plan_name!, row.billing_interval!), status: row.subscription_ended_at ? "cancelled" : "active", startedAt: at(row.subscription_started_at), endedAt: at(row.subscription_ended_at), billingInterval: row.billing_interval, currentMrr: String(Number(row.mrr)), seats: row.seats })),
        invoices: rows.filter((row) => row.invoice_id).map((row) => ({ id: stableImportId("invoice", row.invoice_id!), customerId: customerId(row.customer_id), subscriptionId: subscriptionId(row.customer_id), amount: String(Number(row.invoice_amount)), currency: "USD", status: row.invoice_status, invoiceDate: at(row.invoice_date), paidAt: at(row.invoice_paid_at), failedAt: at(row.invoice_failed_at) })),
        payments: [],
        productEvents: rows.filter((row) => row.event_id).flatMap((row) => Array.from({ length: row.event_count! }, (_, index) => ({ id: BigInt(`0x${sha(`revlens:event:${row.event_id}:${index}`).slice(0, 15)}`).toString(), customerId: customerId(row.customer_id), userId: null, eventName: row.event_name, properties: null, timestamp: at(row.event_date) }))),
      });
      for (const table of ["customers", "plans", "subscriptions", "invoices", "payments", "productEvents"] as const) known[table].sort((a, b) => table === "productEvents" ? (BigInt(a.id) < BigInt(b.id) ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert(comparable(initial, true) === comparable(known, true), "Refusing to replace a dataset that is not the exact known public template");
    }
    record("initial_business_tables", { initiallyEmpty, counts: initialCounts, allowedKnownTemplate: !initiallyEmpty });

    assert.equal(validation.summary.mrr, 200);
    assert.equal(validation.summary.invoiceTotal, 440);
    const imported = await importCustomersData(db, validation);
    assert.deepEqual(imported.counts, { customers: 3, subscriptions: 3, invoices: 3, events: 4 });
    record("template_import", { preview: validation.summary, result: imported });

    const { getRevenueSummary, getRevenueMovements } = await import("../lib/revenue");
    const { getCustomersList, getCustomerDetail, getCustomerRevenueHistory } = await import("../lib/customers");
    const { getLogoRetentionCohorts, getRevenueRetentionCohorts, getPlanRetention, getSegmentRetention } = await import("../lib/cohorts");
    const { getForecastScenarios } = await import("../lib/forecast");
    const { getChurnAnalysis, getRevenueForecast, getCohortRetention } = await import("../lib/analytics");
    const asOf = "2026-09-30T23:59:59.999Z";
    const summary = await getRevenueSummary();
    assert.equal(summary.as_of, asOf);
    assert.equal(summary.dataset_kind, "local");
    assert.equal(summary.current_mrr, 200);
    assert.equal(summary.opening_mrr, 440);
    assert.equal(summary.customer_count, 2);
    const movements = await getRevenueMovements({ from: new Date("2026-09-01Z"), to: new Date(asOf) });
    assert.equal(movements.reduce((sum, row) => sum + row.new_mrr + row.expansion_mrr + row.reactivation_mrr - row.contraction_mrr - row.churned_mrr, summary.opening_mrr), summary.current_mrr);
    record("revenue_summary_and_reconciled_bridge", { summary, movements });

    const customers = await getCustomersList();
    assert.equal(customers.length, 3);
    assert.equal(customers.reduce((sum, customer) => sum + customer.currentMrr, 0), 200);
    for (const customer of customers) {
      assert.match(customer.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      const detail = await getCustomerDetail(customer.id);
      assert(detail && detail.id === customer.id && detail.currentMrr === customer.currentMrr && detail.asOf === asOf);
      const history = await getCustomerRevenueHistory(customer.id);
      assert(history?.revenueHistory.at(-1)?.month === "2026-09-01");
      assert.equal(history.revenueHistory.at(-1)?.mrr, customer.currentMrr);
    }
    record("customers_uuid_detail_and_history", customers);

    const logos = await getLogoRetentionCohorts();
    assert.equal(logos.asOf, asOf);
    assert.deepEqual(logos.segments, ["Education", "Software"]);
    assert.deepEqual(logos.plans, ["Studio", "Team"]);
    for (const load of [getLogoRetentionCohorts, getRevenueRetentionCohorts, getCohortRetention]) {
      for (const segment of logos.segments) assert((await load({ segment })).rows.length > 0);
      for (const plan of logos.plans) assert((await load({ plan })).rows.length > 0);
      const empty = await load({ plan: "Studio", segment: "Education" });
      assert.equal(empty.rows.length, 0);
      assert.deepEqual(empty.segments, logos.segments);
    }
    const forecast = await getForecastScenarios();
    assert.equal(forecast.asOf, asOf);
    assert.deepEqual(forecast.historicalMrr.at(-1), { month: "2026-09-01", mrr: 200 });
    assert.equal(forecast.baseline[0].month, "2026-10-01");
    assert.deepEqual(forecast.assumptions, { newMrrGrowth: 0.05, churnRate: 0.02, expansionRate: 0.02 });
    assert.equal(forecast.baseline[0].mrr, 210);
    const planRetention = await getPlanRetention();
    assert.deepEqual(planRetention.find((row) => row.plan === "Studio"), { plan: "Studio", sampleSize: 2, retentionRate: 1 });
    assert.deepEqual(planRetention.find((row) => row.plan === "Team"), { plan: "Team", sampleSize: 1, retentionRate: 0 });
    const segmentRetention = await getSegmentRetention();
    assert.equal(segmentRetention.find((row) => row.segment === "Industry: Education")?.retentionRate, 0);
    const legacyForecast = await getRevenueForecast();
    assert.deepEqual(legacyForecast.historicalMrr.at(-1), { month: "2026-09-01", mrr: 200 });
    const churn = await getChurnAnalysis();
    assert.equal(churn.churnOverTime.at(-1)?.month, "2026-09-01");
    assert.equal(churn.totalRevenueLost, 240);
    record("cohort_filters_forecast_and_churn_cutoff", { logos, planRetention, segmentRetention, forecast, legacyForecast, churn });

    const firstBackup = await exportDatasetBackup(db);
    assert.equal(firstBackup.invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0), 440);
    assert.equal(firstBackup.payments.length, 0); // paid invoice is not a confirmed payment ledger.
    assert.equal(firstBackup.customers.find((row) => row.id === stableImportId("customer", "sample-001"))?.name, "Café North, Ltd");
    assert.equal(firstBackup.metadata?.rowCount, 3);
    assert.deepEqual(parseDatasetBackup(JSON.parse(JSON.stringify(firstBackup))), firstBackup);
    await importCustomersData(db, validation);
    const repeated = await exportDatasetBackup(db);
    assert.equal(comparable(firstBackup, true), comparable(repeated, true));
    record("complete_backup_and_repeat_import_no_duplicates", { invoiceTotal: 440, counts: imported.counts, metadata: repeated.metadata, businessSha256: sha(comparable(repeated, true)) });

    await db.customer.update({ where: { id: customers[0].id }, data: { name: "Synthetic restore probe" } });
    await restoreDatasetBackup(db, JSON.parse(JSON.stringify(repeated)));
    assert.equal(comparable(await exportDatasetBackup(db)), comparable(repeated));
    record("restore_roundtrip", "Restored all business tables and metadata after a synthetic name change");

    for (const [name, operation] of [
      ["import", () => importCustomersData(failingCustomerWrite(db), validation)],
      ["restore", () => restoreDatasetBackup(failingCustomerWrite(db), repeated)],
    ] as const) {
      let code: string | undefined;
      try { await operation(); } catch (error) { code = (error as { code?: string }).code; }
      assert.equal(code, "P2002", `${name} must encounter a real PostgreSQL unique violation after deletion`);
      assert.equal(comparable(await exportDatasetBackup(db)), comparable(repeated));
      record(`${name}_actual_transaction_rollback`, { errorCode: code, allBusinessTablesAndMetadataPreserved: true });
    }
    const finalBackup = await exportDatasetBackup(db);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "synthetic-template-backup.json"), JSON.stringify(finalBackup, null, 2) + "\n");
    await writeFile(join(outputDir, "local-integration-results.json"), JSON.stringify({ status: "passed", verifiedAt: new Date().toISOString(), scope: "Direct production-service integration against real dedicated PostgreSQL; browser/auth separate", templateSha256: sha(TEMPLATE_CSV), checks, finalBusinessSha256: sha(comparable(finalBackup, true)) }, null, 2) + "\n");
    console.log(JSON.stringify({ status: "passed", checks: checks.length, dataset: "public synthetic template", currentMrr: 200, invoiceTotal: 440 }));
  } finally { await db.$disconnect(); }
}

main().catch(async (error) => {
  // Never print connection strings, runtime settings, credentials, or raw Prisma errors.
  const failure = { status: "failed", completedChecks: checks, error: { name: error?.name, code: error?.code, message: error?.name === "AssertionError" ? error.message : "Integration stopped; inspect the failing stage without exposing runtime credentials" } };
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "local-integration-failure.json"), JSON.stringify(failure, null, 2) + "\n");
  console.error(JSON.stringify(failure));
  process.exitCode = 1;
});
