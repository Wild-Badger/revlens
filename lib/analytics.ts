import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAsOf, isActiveAt } from "@/lib/dataset";
import { getLogoRetentionCohorts, matchesSegment, type CohortData } from "@/lib/cohorts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: { customer: true; plan: true };
}>;

export type AnalyticsFilters = {
  segment?: string;
  plan?: string;
};

// ---------------------------------------------------------------------------
// Helpers (mirror patterns from lib/revenue.ts)
// ---------------------------------------------------------------------------

const MONEY_PRECISION = 2;
const RATE_PRECISION = 4;

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function round(value: number, precision = MONEY_PRECISION) {
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

async function loadSubscriptions(filters: AnalyticsFilters = {}) {
  return prisma.subscription.findMany({
    where: {
      ...(filters.plan ? { plan: { name: { equals: filters.plan, mode: "insensitive" } } } : {}),
    },
    orderBy: [{ customerId: "asc" }, { startedAt: "asc" }],
    include: { customer: true, plan: true },
  });
}

// ---------------------------------------------------------------------------
// Cohort Retention
// ---------------------------------------------------------------------------

export type { CohortData, CohortRow } from "@/lib/cohorts";

export async function getCohortRetention(filters: AnalyticsFilters = {}): Promise<CohortData> {
  return getLogoRetentionCohorts(filters);
}

// ---------------------------------------------------------------------------
// Churn Analysis
// ---------------------------------------------------------------------------

export type ChurnRatePoint = {
  month: string;
  logoChurnRate: number;
  revenueChurnRate: number;
  churnedCustomers: number;
  churnedRevenue: number;
  totalCustomers: number;
  totalRevenue: number;
};

export type ChurnBySegment = {
  segment: string;
  churnRate: number;
  churnedCount: number;
  totalCount: number;
  revenueLost: number;
};

export type ChurnAnalysis = {
  churnOverTime: ChurnRatePoint[];
  churnByPlan: ChurnBySegment[];
  churnByIndustry: ChurnBySegment[];
  churnByChannel: ChurnBySegment[];
  totalRevenueLost: number;
};

export async function getChurnAnalysis(filters: AnalyticsFilters = {}): Promise<ChurnAnalysis> {
  const asOf = await getAsOf();
  const subscriptions = await loadSubscriptions(filters);
  const filtered = subscriptions.filter((s) => s.startedAt <= asOf && matchesSegment(s, filters.segment));

  const churnedSubs = filtered.filter((s) => s.endedAt !== null && s.endedAt <= asOf && !filtered.some((other) => other.customerId === s.customerId && isActiveAt(other, s.endedAt!)));

  const allDates = filtered.map((s) => s.startedAt);
  if (allDates.length === 0) {
    return {
      churnOverTime: [],
      churnByPlan: [],
      churnByIndustry: [],
      churnByChannel: [],
      totalRevenueLost: 0,
    };
  }

  const earliestDate = startOfMonth(new Date(Math.min(...allDates.map((d) => d.getTime()))));
  const latestDate = startOfMonth(asOf);

  const churnedByMonth = new Map<string, typeof churnedSubs>();
  for (const sub of churnedSubs) {
    if (!sub.endedAt) continue;
    const mKey = monthKey(startOfMonth(sub.endedAt));
    if (!churnedByMonth.has(mKey)) churnedByMonth.set(mKey, []);
    churnedByMonth.get(mKey)!.push(sub);
  }

  const churnOverTime: ChurnRatePoint[] = [];
  let current = earliestDate;

  while (current <= latestDate) {
    const mKey = monthKey(current);
    const monthEnd = new Date(Math.min(addMonths(current, 1).getTime() - 1, asOf.getTime()));
    const openingCutoff = new Date(current.getTime() - 1);

    const activeAtStart = new Set(
      filtered.filter((s) => isActiveAt(s, openingCutoff)).map((s) => s.customerId)
    );

    const activeSubsAtStart = filtered.filter((s) => isActiveAt(s, openingCutoff));
    const revenueAtStart = activeSubsAtStart.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);

    const churnedThisMonth = (churnedByMonth.get(mKey) ?? []).filter((sub) => activeAtStart.has(sub.customerId) && !filtered.some((other) => other.customerId === sub.customerId && isActiveAt(other, monthEnd)));
    const churnedCustomerIds = new Set(churnedThisMonth.map((s) => s.customerId));
    const churnedRevenue = activeSubsAtStart.filter((sub) => churnedCustomerIds.has(sub.customerId)).reduce((sum, sub) => sum + toNumber(sub.currentMrr), 0);

    churnOverTime.push({
      month: mKey,
      logoChurnRate: activeAtStart.size > 0 ? round(churnedCustomerIds.size / activeAtStart.size, RATE_PRECISION) : 0,
      revenueChurnRate: revenueAtStart > 0 ? round(churnedRevenue / revenueAtStart, RATE_PRECISION) : 0,
      churnedCustomers: churnedCustomerIds.size,
      churnedRevenue: round(churnedRevenue),
      totalCustomers: activeAtStart.size,
      totalRevenue: round(revenueAtStart),
    });

    current = addMonths(current, 1);
  }

  const churnByPlan = computeChurnByDimension(filtered, (s) => s.plan.name, asOf);
  const churnByIndustry = computeChurnByDimension(filtered, (s) => s.customer.industry, asOf);
  const churnByChannel = computeChurnByDimension(filtered, (s) => s.customer.acquisitionChannel, asOf);

  const totalRevenueLost = churnOverTime.reduce((sum, point) => sum + point.churnedRevenue, 0);

  return {
    churnOverTime,
    churnByPlan,
    churnByIndustry,
    churnByChannel,
    totalRevenueLost: round(totalRevenueLost),
  };
}

function computeChurnByDimension(
  subscriptions: SubscriptionWithRelations[],
  dimensionFn: (s: SubscriptionWithRelations) => string,
  asOf: Date
): ChurnBySegment[] {
  const byDimension = new Map<string, SubscriptionWithRelations[]>();

  for (const sub of subscriptions) {
    const key = dimensionFn(sub);
    if (!byDimension.has(key)) byDimension.set(key, []);
    byDimension.get(key)!.push(sub);
  }

  const result: ChurnBySegment[] = [];

  for (const [segment, subs] of byDimension) {
    const uniqueCustomers = new Set(subs.map((s) => s.customerId));
    const churnedSubs = subs.filter((s) => s.endedAt !== null && s.endedAt <= asOf && !subscriptions.some((other) => other.customerId === s.customerId && isActiveAt(other, s.endedAt!)));
    const churnedCustomerIds = new Set(churnedSubs.map((s) => s.customerId));
    const revenueLost = churnedSubs.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);

    result.push({
      segment,
      churnRate: uniqueCustomers.size > 0 ? round(churnedCustomerIds.size / uniqueCustomers.size, RATE_PRECISION) : 0,
      churnedCount: churnedCustomerIds.size,
      totalCount: uniqueCustomers.size,
      revenueLost: round(revenueLost),
    });
  }

  return result.sort((a, b) => b.revenueLost - a.revenueLost);
}

// ---------------------------------------------------------------------------
// Revenue Forecasting
// ---------------------------------------------------------------------------

export type ForecastPoint = {
  month: string;
  projectedMrr: number;
  commitMrr: number;
  bestCaseMrr: number;
};

export type PipelineGap = {
  target: number;
  projected: number;
  gap: number;
  monthsToTarget: number | null;
};

export type ForecastData = {
  historicalMrr: { month: string; mrr: number }[];
  forecast: ForecastPoint[];
  pipelineGap: PipelineGap;
  arrTargetTracker: {
    currentArr: number;
    targetArr: number;
    progressPercent: number;
  };
};

export async function getRevenueForecast(filters: AnalyticsFilters = {}): Promise<ForecastData> {
  const asOf = await getAsOf();
  const subscriptions = await loadSubscriptions(filters);
  const filtered = subscriptions.filter((s) => s.startedAt <= asOf && matchesSegment(s, filters.segment));

  const allDates = filtered.map((s) => s.startedAt);
  if (allDates.length === 0) {
    return {
      historicalMrr: [],
      forecast: [],
      pipelineGap: { target: 0, projected: 0, gap: 0, monthsToTarget: null },
      arrTargetTracker: { currentArr: 0, targetArr: 0, progressPercent: 0 },
    };
  }

  const earliestDate = startOfMonth(new Date(Math.min(...allDates.map((d) => d.getTime()))));
  const latestDate = startOfMonth(asOf);

  const historicalMrr: { month: string; mrr: number }[] = [];
  let current = earliestDate;

  while (current <= latestDate) {
    const monthEnd = new Date(Math.min(addMonths(current, 1).getTime() - 1, asOf.getTime()));
    const mrr = filtered
      .filter((s) => isActiveAt(s, monthEnd))
      .reduce((sum, s) => sum + toNumber(s.currentMrr), 0);

    historicalMrr.push({
      month: monthKey(current),
      mrr: round(mrr),
    });

    current = addMonths(current, 1);
  }

  const trendWindow = Math.min(6, historicalMrr.length);
  const trendData = historicalMrr.slice(-trendWindow);

  const { slope, intercept } = linearRegression(
    trendData.map((_, i) => i),
    trendData.map((d) => d.mrr)
  );

  const lastMrr = historicalMrr[historicalMrr.length - 1]?.mrr ?? 0;
  const lastMonth = new Date(`${historicalMrr[historicalMrr.length - 1]?.month}T00:00:00.000Z`);

  const forecast: ForecastPoint[] = [];
  for (let i = 1; i <= 3; i++) {
    const projected = Math.max(0, intercept + slope * (trendData.length - 1 + i));
    const commitGrowth = (projected - lastMrr) * 0.8;
    const commit = Math.max(0, lastMrr + commitGrowth);
    const bestCaseGrowth = (projected - lastMrr) * 1.2;
    const bestCase = Math.max(0, lastMrr + bestCaseGrowth);

    forecast.push({
      month: monthKey(addMonths(lastMonth, i)),
      projectedMrr: round(projected),
      commitMrr: round(commit),
      bestCaseMrr: round(bestCase),
    });
  }

  const currentArr = round(lastMrr * 12);
  const targetArr = round(currentArr * 1.5);
  const lastProjectedMrr = forecast.length > 0 ? forecast[forecast.length - 1].projectedMrr : lastMrr;
  const projectedArr = round(lastProjectedMrr * 12);
  const gap = round(Math.max(0, targetArr - projectedArr));

  const monthlyArrGrowth = slope * 12;
  const monthsToTarget = monthlyArrGrowth > 0 ? Math.ceil(gap / monthlyArrGrowth) : null;

  const progressPercent = targetArr > 0 ? round(currentArr / targetArr, RATE_PRECISION) : 0;

  return {
    historicalMrr,
    forecast,
    pipelineGap: {
      target: targetArr,
      projected: projectedArr,
      gap,
      monthsToTarget,
    },
    arrTargetTracker: {
      currentArr,
      targetArr,
      progressPercent,
    },
  };
}

function linearRegression(x: number[], y: number[]) {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0 };

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}
