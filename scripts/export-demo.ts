import assert from "node:assert/strict";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../lib/db";
import { getCustomersList, getCustomerDetail, getCustomerRevenueHistory } from "../lib/customers";
import { getRevenueSummary, getRevenueMovements } from "../lib/revenue";
import { getLogoRetentionCohorts, getRevenueRetentionCohorts, getPlanRetention, getSegmentRetention } from "../lib/cohorts";
import { getChurnAnalysis } from "../lib/analytics";
import { getForecastScenarios } from "../lib/forecast";
import { scopeKey, type DemoData, type DemoScope } from "../demo/types";
import { movementsInRange } from "../demo/movements";

async function main() {
  // ponytail: this bounded export only reads the identified fictional release database.
  assert.equal(process.env.DEMO_MODE, "true", "DEMO_MODE must be true");
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && ["revlens_demo","revlens_predictive_demo"].includes(database.pathname.slice(1)), "Use only an explicitly named isolated demo database");
  const [customers, intervals, catalog, summary, plans] = await Promise.all([
    getCustomersList(),
    prisma.subscription.findMany({ select: { startedAt: true, endedAt: true } }),
    getLogoRetentionCohorts(),
    getRevenueSummary(),
    prisma.plan.findMany({ select: { name: true }, distinct: ["name"], orderBy: { name: "asc" } }),
  ]);
  assert.equal(customers.length, 60);
  assert(intervals.length >= 60);
  assert(customers.every((customer) => customer.domain?.endsWith(".example")), "Export only the fictional .example accounts");
  assert.equal(summary.as_of, "2026-09-30T23:59:59.999Z");
  const eventDays = [...new Set(intervals.flatMap((interval) => [interval.startedAt, interval.endedAt]
    .filter((date): date is Date => !!date && date.toISOString() <= summary.as_of)
    .map((date) => date.toISOString().slice(0, 10))))].sort();
  const scopes: Record<string, DemoScope> = {};
  for (const segment of ["", ...catalog.segments]) {
    for (const plan of ["", ...catalog.plans]) {
      const filters = { segment: segment || undefined, plan: plan || undefined };
      const [logo, revenue, churn, movements] = await Promise.all([
        getLogoRetentionCohorts(filters), getRevenueRetentionCohorts(filters),
        getChurnAnalysis(filters), getRevenueMovements(filters),
      ]);
      const dailyMovements: DemoScope["dailyMovements"] = [];
      for (const date of eventDays) {
        const daily = await getRevenueMovements({ ...filters, from: new Date(`${date}T00:00:00.000Z`), to: new Date(`${date}T23:59:59.999Z`) });
        if (daily.length) dailyMovements.push({ date, movements: daily });
      }
      assert.deepEqual(movementsInRange(dailyMovements, null, null), movements, "Daily export must reconcile to production monthly movements");
      scopes[scopeKey(segment, plan)] = { logo, revenue, churn, movements, dailyMovements };
    }
  }
  const details: DemoData["details"] = {};
  const histories: DemoData["histories"] = {};
  for (const customer of customers) {
    const [detail, history] = await Promise.all([getCustomerDetail(customer.id), getCustomerRevenueHistory(customer.id)]);
    assert(detail && history);
    details[customer.id] = detail;
    histories[customer.id] = history;
  }
  const planMembership: DemoData["planMembership"] = {};
  for (const plan of plans) planMembership[plan.name] = (await getCustomersList({ plan: plan.name })).map((customer) => customer.id);
  const prediction = JSON.parse(await readFile(resolve("analytics/reports/demo-prediction.json"), "utf8"));
  assert.equal(prediction.status,"ready");
  assert.equal(prediction.coverage.completeMonths,48);
  assert.equal(prediction.history.at(-1).value,summary.current_mrr);
  const data: DemoData = { prediction,
    format: "revlens-fictional-demo", version: 2, summary, customers, details, histories, scopes,
    plans: plans.map((plan) => plan.name), planMembership,
    planRetention: await getPlanRetention(), segmentRetention: await getSegmentRetention(), forecast: await getForecastScenarios(),
  };
  await mkdir(resolve("demo"), { recursive: true });
  await writeFile(resolve("demo/data.json"), `${JSON.stringify(data)}\n`);
  console.log(JSON.stringify({ result: "PASS", customers: customers.length, intervals: intervals.length, scopes: Object.keys(scopes).length, asOf: summary.as_of }));
}

main().catch(() => { console.error("Synthetic export failed. Check the demo database and export assertions; no data was changed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
