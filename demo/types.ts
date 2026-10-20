import type { getRevenueSummary, RevenueMovement } from "../lib/revenue";
import type { CustomerDetail, CustomerListItem, CustomerRevenueLifecycle } from "../lib/customers";
import type { CohortData, PlanRetention, SegmentRetention } from "../lib/cohorts";
import type { ChurnAnalysis } from "../lib/analytics";
import type { ForecastScenarios } from "../lib/forecast-scenario";

export type DemoScope = {
  logo: CohortData;
  revenue: CohortData;
  churn: ChurnAnalysis;
  movements: RevenueMovement[];
  dailyMovements: { date: string; movements: RevenueMovement[] }[];
};

export type DemoData = {
  format: "revlens-fictional-demo";
  version: 1;
  summary: Awaited<ReturnType<typeof getRevenueSummary>>;
  customers: CustomerListItem[];
  details: Record<string, CustomerDetail>;
  histories: Record<string, CustomerRevenueLifecycle>;
  planMembership: Record<string, string[]>;
  plans: string[];
  scopes: Record<string, DemoScope>;
  planRetention: PlanRetention[];
  segmentRetention: SegmentRetention[];
  forecast: ForecastScenarios;
};

export function scopeKey(segment = "", plan = "") {
  return JSON.stringify([segment.toLowerCase(), plan.toLowerCase()]);
}
