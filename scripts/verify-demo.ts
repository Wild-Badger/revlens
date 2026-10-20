import assert from "node:assert/strict";
import { prisma } from "../lib/db";
import { getRevenueMovements, getRevenueSummary } from "../lib/revenue";

async function main() {
  assert.equal(process.env.DEMO_MODE, "true", "Run only against the isolated demo database");
  const summary = await getRevenueSummary();
  const asOf = new Date(summary.as_of);
  const [customers, subscriptions, movements] = await Promise.all([
    prisma.customer.findMany(),
    prisma.subscription.findMany(),
    getRevenueMovements({ to: asOf }),
  ]);
  assert.equal(customers.length, 60);
  assert(customers.every((customer) => customer.domain?.endsWith(".example")));
  assert(subscriptions.every((sub) => sub.startedAt.getUTCFullYear() >= 2025
    && sub.startedAt <= asOf && (!sub.endedAt || (sub.endedAt >= sub.startedAt && sub.endedAt <= asOf))));
  const active = subscriptions.filter((sub) => sub.startedAt <= asOf && (!sub.endedAt || sub.endedAt > asOf));
  const mrr = active.reduce((total, sub) => total + Number(sub.currentMrr), 0);
  const netMovements = movements.reduce((total, point) => total + point.new_mrr + point.expansion_mrr
    + point.reactivation_mrr - point.contraction_mrr - point.churned_mrr, 0);
  assert(Math.abs(summary.current_mrr - mrr) < 0.01);
  assert(Math.abs(netMovements - mrr) < 0.01);
  assert.equal(summary.current_arr, summary.current_mrr * 12);
  assert.equal(summary.mrr_history.at(-1)?.mrr, summary.current_mrr);
  assert.equal(summary.customer_count, new Set(active.map((sub) => sub.customerId)).size);
  console.log(JSON.stringify({ result: "PASS", syntheticCustomers: customers.length,
    subscriptions: subscriptions.length, asOf: summary.as_of, mrr: summary.current_mrr,
    activeCustomers: summary.customer_count, reconciledMovementNet: netMovements }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
