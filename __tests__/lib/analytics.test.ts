import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "../mocks/prisma";
import { getChurnAnalysis, getRevenueForecast, getCohortRetention } from "@/lib/analytics";
import { mockSubscription } from "../helpers/factories";

describe("getChurnAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not classify a simultaneous plan replacement as customer churn", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ customerId: "replacement", currentMrr: 100,
        startedAt: new Date("2025-01-01Z"), endedAt: new Date("2025-03-15Z") }),
      mockSubscription({ customerId: "replacement", currentMrr: 200,
        startedAt: new Date("2025-03-15Z"), endedAt: null }),
    ]);
    const result = await getChurnAnalysis();
    expect(result.totalRevenueLost).toBe(0);
    expect(result.churnOverTime.every((point) => point.churnedCustomers === 0)).toBe(true);
    expect(result.churnByPlan.every((point) => point.churnedCount === 0)).toBe(true);
  });

  it("returns empty analysis when no subscriptions exist", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    const result = await getChurnAnalysis();
    expect(result.churnOverTime).toHaveLength(0);
    expect(result.totalRevenueLost).toBe(0);
  });

  it("computes churn by plan correctly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        plan: { id: "plan-1", name: "Starter", billingInterval: "monthly", basePrice: 49, seatPrice: 10, createdAt: new Date("2024-01-01T00:00:00Z") },
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-2",
        plan: { id: "plan-1", name: "Starter", billingInterval: "monthly", basePrice: 49, seatPrice: 10, createdAt: new Date("2024-01-01T00:00:00Z") },
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getChurnAnalysis();
    expect(result.churnByPlan).toHaveLength(1);
    expect(result.churnByPlan[0].segment).toBe("Starter");
    expect(result.churnByPlan[0].churnRate).toBe(0.5);
    expect(result.churnByPlan[0].churnedCount).toBe(1);
    expect(result.churnByPlan[0].totalCount).toBe(2);
  });

  it("computes churn by industry and channel", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        customer: { id: "cust-1", name: "A", domain: "a.com", industry: "SaaS", companySize: "10-50", country: "US", acquisitionChannel: "organic", createdAt: new Date("2024-01-01T00:00:00Z"), convertedAt: new Date("2025-01-01T00:00:00Z"), churnedAt: new Date("2025-03-01T00:00:00Z"), status: "churned" },
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-2",
        customer: { id: "cust-2", name: "B", domain: "b.com", industry: "Fintech", companySize: "50-200", country: "GB", acquisitionChannel: "paid", createdAt: new Date("2024-01-01T00:00:00Z"), convertedAt: new Date("2025-01-01T00:00:00Z"), churnedAt: null, status: "active" },
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 200,
      }),
    ]);

    const result = await getChurnAnalysis();
    expect(result.churnByIndustry).toHaveLength(2);
    expect(result.churnByChannel).toHaveLength(2);
  });

  it("aggregates churnOverTime by month", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-15T00:00:00Z"),
        currentMrr: 100,
      }),
    ]);

    const result = await getChurnAnalysis();
    expect(result.churnOverTime.length).toBeGreaterThan(0);
    const march = result.churnOverTime.find((c) => c.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.logoChurnRate).toBe(1);
    expect(march!.revenueChurnRate).toBe(1);
  });
});

describe("getRevenueForecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty forecast with no subscriptions", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    const result = await getRevenueForecast();
    expect(result.historicalMrr).toHaveLength(0);
    expect(result.forecast).toHaveLength(0);
  });

  it("produces 3-month forecast with positive slope", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-1",
        startedAt: new Date("2025-02-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-3",
        customerId: "cust-1",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getRevenueForecast();
    expect(result.historicalMrr.length).toBeGreaterThanOrEqual(3);
    expect(result.forecast).toHaveLength(3);
    expect(result.forecast[0].projectedMrr).toBeGreaterThanOrEqual(0);
    expect(result.pipelineGap.target).toBeGreaterThan(0);
  });

  it("caps projected MRR at 0 for negative trends", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-02-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-1",
        startedAt: new Date("2025-02-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 50,
      }),
    ]);

    const result = await getRevenueForecast();
    expect(result.forecast.every((f) => f.projectedMrr >= 0)).toBe(true);
    expect(result.forecast.every((f) => f.commitMrr >= 0)).toBe(true);
    expect(result.forecast.every((f) => f.bestCaseMrr >= 0)).toBe(true);
  });
});

describe("getCohortRetention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty cohorts with no subscriptions", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    const result = await getCohortRetention();
    expect(result.rows).toHaveLength(0);
    expect(result.maxMonths).toBe(0);
  });

  it("builds retention rows for each cohort month", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-15T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-2",
        startedAt: new Date("2025-01-20T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-3",
        customerId: "cust-3",
        startedAt: new Date("2025-02-10T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getCohortRetention();
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const janCohort = result.rows.find((r) => r.cohort === "2025-01-01");
    expect(janCohort).toBeDefined();
    expect(janCohort!.cohortSize).toBe(2);
    // Month 0 retention should be 1 (both active at end of Jan)
    expect(janCohort!.retention[0]).toBe(1);
  });
});
