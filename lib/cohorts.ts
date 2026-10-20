import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAsOf, isActiveAt as isActiveOn } from "@/lib/dataset";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: { customer: true; plan: true };
}>;

export type CohortRow = {
  cohort: string; // YYYY-MM-01
  cohortSize: number;
  retention: number[]; // percentage retained at month 0, 1, 2, ...
};

export type CohortData = {
  asOf: string;
  rows: CohortRow[];
  maxMonths: number;
  segments: string[];
  plans: string[];
};

export type PlanRetention = {
  plan: string;
  retentionRate: number; // 0-1
  sampleSize: number;
};

export type SegmentRetention = {
  segment: string;
  retentionRate: number; // 0-1
  sampleSize: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RATE_PRECISION = 4;

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function round(value: number, precision = RATE_PRECISION) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// ---------------------------------------------------------------------------
// Shared subscription loader
// ---------------------------------------------------------------------------

async function loadSubscriptions() {
  return prisma.subscription.findMany({
    where: {},
    orderBy: [{ customerId: "asc" }, { startedAt: "asc" }],
    include: { customer: true, plan: true },
  });
}

function matchesFilters(subscription: SubscriptionWithRelations, filters?: { plan?: string; segment?: string }) {
  return (!filters?.plan || subscription.plan.name.toLowerCase() === filters.plan.toLowerCase()) &&
    matchesSegment(subscription, filters?.segment);
}

// ---------------------------------------------------------------------------
// Logo Retention Cohorts
// ---------------------------------------------------------------------------

export async function getLogoRetentionCohorts(filters?: {
  segment?: string;
  plan?: string;
}): Promise<CohortData> {
  const asOf = await getAsOf();
  const subscriptions = (await loadSubscriptions()).filter((s) => s.startedAt <= asOf);
  const filtered = subscriptions.filter((s) => matchesFilters(s, filters));

  // Group customers by their first subscription start month (cohort)
  const customerFirstSub = new Map<string, { customerId: string; startedAt: Date }>();

  for (const sub of filtered) {
    if (!customerFirstSub.has(sub.customerId)) {
      customerFirstSub.set(sub.customerId, {
        customerId: sub.customerId,
        startedAt: sub.startedAt,
      });
    } else {
      const existing = customerFirstSub.get(sub.customerId)!;
      if (sub.startedAt < existing.startedAt) {
        existing.startedAt = sub.startedAt;
      }
    }
  }

  // Determine the latest month to calculate max retention periods
  const latestMonth = startOfMonth(asOf);

  // Build cohort map: cohortMonth -> Set<customerId>
  const cohorts = new Map<string, Set<string>>();

  for (const { customerId, startedAt } of customerFirstSub.values()) {
    const cohort = monthKey(startOfMonth(startedAt));
    if (!cohorts.has(cohort)) {
      cohorts.set(cohort, new Set());
    }
    cohorts.get(cohort)!.add(customerId);
  }

  // For each cohort, calculate how many customers are still active at each month offset
  const rows: CohortRow[] = [];
  let maxMonths = 0;

  const sortedCohorts = Array.from(cohorts.keys()).sort();

  for (const cohortKey of sortedCohorts) {
    const cohortDate = new Date(`${cohortKey}T00:00:00.000Z`);
    const customerIds = cohorts.get(cohortKey)!;
    const cohortSize = customerIds.size;
    const maxOffset = monthsBetween(cohortDate, latestMonth);
    if (maxOffset < 0) continue;

    if (maxOffset > maxMonths) maxMonths = maxOffset;

    const retention: number[] = [];

    for (let offset = 0; offset <= maxOffset; offset++) {
      const checkDate = new Date(Math.min(addMonths(cohortDate, offset + 1).getTime() - 1, asOf.getTime()));
      let activeCount = 0;

      for (const customerId of customerIds) {
        const customerSubs = filtered.filter((s) => s.customerId === customerId);
        if (customerSubs.some((s) => isActiveOn(s, checkDate))) {
          activeCount++;
        }
      }

      retention.push(round(activeCount / cohortSize, RATE_PRECISION));
    }

    rows.push({ cohort: cohortKey, cohortSize, retention });
  }

  // Derive available segment options
  const segments = [
    ...new Set(subscriptions.map((s) => s.customer.industry)),
  ].sort();

  return { rows, maxMonths, segments, plans: [...new Set(subscriptions.map((s) => s.plan.name))].sort(), asOf: asOf.toISOString() };
}

// ---------------------------------------------------------------------------
// Revenue Retention Cohorts
// ---------------------------------------------------------------------------

export async function getRevenueRetentionCohorts(filters?: {
  segment?: string;
  plan?: string;
}): Promise<CohortData> {
  const asOf = await getAsOf();
  const subscriptions = (await loadSubscriptions()).filter((s) => s.startedAt <= asOf);
  const filtered = subscriptions.filter((s) => matchesFilters(s, filters));

  // Group customers by their first subscription start month (cohort)
  const customerFirstSub = new Map<string, { customerId: string; startedAt: Date }>();

  for (const sub of filtered) {
    if (!customerFirstSub.has(sub.customerId)) {
      customerFirstSub.set(sub.customerId, {
        customerId: sub.customerId,
        startedAt: sub.startedAt,
      });
    } else {
      const existing = customerFirstSub.get(sub.customerId)!;
      if (sub.startedAt < existing.startedAt) {
        existing.startedAt = sub.startedAt;
      }
    }
  }

  // Determine the latest month to calculate max retention periods
  const latestMonth = startOfMonth(asOf);

  // Build cohort map: cohortMonth -> Map<customerId, initialMrr>
  const cohorts = new Map<string, Map<string, number>>();

  for (const { customerId, startedAt } of customerFirstSub.values()) {
    const cohort = monthKey(startOfMonth(startedAt));
    if (!cohorts.has(cohort)) {
      cohorts.set(cohort, new Map());
    }
    // Store the initial MRR for this customer
    const customerSubs = filtered.filter((s) => s.customerId === customerId && s.startedAt.getTime() == startedAt.getTime());
    const initialMrr = customerSubs.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);
    cohorts.get(cohort)!.set(customerId, initialMrr);
  }

  // For each cohort, calculate revenue retention at each month offset
  const rows: CohortRow[] = [];
  let maxMonths = 0;

  const sortedCohorts = Array.from(cohorts.keys()).sort();

  for (const cohortKey of sortedCohorts) {
    const cohortDate = new Date(`${cohortKey}T00:00:00.000Z`);
    const customerMrrMap = cohorts.get(cohortKey)!;
    const cohortSize = Array.from(customerMrrMap.values()).reduce((a, b) => a + b, 0); // total initial MRR
    const maxOffset = monthsBetween(cohortDate, latestMonth);
    if (maxOffset < 0) continue;

    if (maxOffset > maxMonths) maxMonths = maxOffset;

    const retention: number[] = [];

    for (let offset = 0; offset <= maxOffset; offset++) {
      const checkDate = new Date(Math.min(addMonths(cohortDate, offset + 1).getTime() - 1, asOf.getTime()));
      let activeRevenue = 0;

      for (const customerId of customerMrrMap.keys()) {
        const customerSubs = filtered.filter((s) => s.customerId === customerId);
        if (customerSubs.some((s) => isActiveOn(s, checkDate))) {
          // Add the MRR this customer is generating at check date
          const activeSubs = customerSubs.filter((s) => isActiveOn(s, checkDate));
          activeRevenue += activeSubs.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);
        }
      }

      retention.push(cohortSize > 0 ? round(activeRevenue / cohortSize, RATE_PRECISION) : 0);
    }

    rows.push({ cohort: cohortKey, cohortSize, retention });
  }

  // Derive available segment options
  const segments = [
    ...new Set(subscriptions.map((s) => s.customer.industry)),
  ].sort();

  return { rows, maxMonths, segments, plans: [...new Set(subscriptions.map((s) => s.plan.name))].sort(), asOf: asOf.toISOString() };
}

// ---------------------------------------------------------------------------
// Plan-Level Retention
// ---------------------------------------------------------------------------

export async function getPlanRetention(): Promise<PlanRetention[]> {
  const now = await getAsOf();
  const subscriptions = (await loadSubscriptions()).filter((s) => s.startedAt <= now);

  // Group customers by plan
  const planCustomers = new Map<string, { customerIds: Set<string> }>();

  for (const sub of subscriptions) {
    if (!planCustomers.has(sub.plan.name)) {
      planCustomers.set(sub.plan.name, { customerIds: new Set() });
    }
    const entry = planCustomers.get(sub.plan.name)!;
    entry.customerIds.add(sub.customerId);
  }

  const result: PlanRetention[] = [];

  for (const [plan, { customerIds }] of planCustomers) {
    // Calculate retention rate: customers still active / total customers
    let activeCount = 0;
    for (const customerId of customerIds) {
      const customerSubs = subscriptions.filter((s) => s.customerId === customerId && s.plan.name === plan);
      if (customerSubs.some((s) => isActiveOn(s, now))) {
        activeCount++;
      }
    }

    result.push({
      plan,
      retentionRate: customerIds.size > 0 ? round(activeCount / customerIds.size, RATE_PRECISION) : 0,
      sampleSize: customerIds.size,
    });
  }

  return result.sort((a, b) => b.sampleSize - a.sampleSize);
}

// ---------------------------------------------------------------------------
// Segment Retention
// ---------------------------------------------------------------------------

export async function getSegmentRetention(): Promise<SegmentRetention[]> {
  const now = await getAsOf();
  const subscriptions = (await loadSubscriptions()).filter((s) => s.startedAt <= now);

  // Group customers by segment (industry, companySize, country)
  const segmentCustomers = new Map<string, { customerIds: Set<string> }>();

  for (const sub of subscriptions) {
    const segments = [
      `Industry: ${sub.customer.industry}`,
      `Size: ${sub.customer.companySize}`,
      `Country: ${sub.customer.country}`,
    ];

    for (const seg of segments) {
      if (!segmentCustomers.has(seg)) {
        segmentCustomers.set(seg, { customerIds: new Set() });
      }
      const entry = segmentCustomers.get(seg)!;
      entry.customerIds.add(sub.customerId);
      }
  }

  const result: SegmentRetention[] = [];

  for (const [segment, { customerIds }] of segmentCustomers) {
    // Calculate retention rate: customers still active / total customers
    let activeCount = 0;
    for (const customerId of customerIds) {
      const customerSubs = subscriptions.filter((s) => s.customerId === customerId);
      if (customerSubs.some((s) => isActiveOn(s, now))) {
        activeCount++;
      }
    }

    result.push({
      segment,
      retentionRate: customerIds.size > 0 ? round(activeCount / customerIds.size, RATE_PRECISION) : 0,
      sampleSize: customerIds.size,
    });
  }

  return result.sort((a, b) => b.sampleSize - a.sampleSize);
}

// ---------------------------------------------------------------------------
// Segment matching helper
// ---------------------------------------------------------------------------

export function matchesSegment(subscription: SubscriptionWithRelations, segment?: string) {
  if (!segment) return true;
  const normalized = segment.toLowerCase();
  return subscription.customer.industry.toLowerCase() === normalized;
}
