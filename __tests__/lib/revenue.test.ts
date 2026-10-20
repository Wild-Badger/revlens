import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "../mocks/prisma";
import { getRevenueMovements, getRevenueSummary } from "@/lib/revenue";
import { mockSubscription } from "../helpers/factories";

describe("getRevenueMovements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2025-03-31T23:59:59.999Z");
  });

  it("classifies new MRR for first-time customers", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getRevenueMovements();
    const march = result.find((m) => m.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.new_mrr).toBe(100);
    expect(march!.expansion_mrr).toBe(0);
    expect(march!.churned_mrr).toBe(0);
  });

  it("classifies expansion MRR when customer adds another subscription", async () => {
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
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 200,
      }),
    ]);

    const result = await getRevenueMovements();
    const march = result.find((m) => m.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.expansion_mrr).toBe(200);
    expect(march!.stable_mrr).toBe(100);
  });

  it("classifies contraction MRR when a subscription is replaced at a lower MRR", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 200,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-1",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getRevenueMovements();
    const march = result.find((m) => m.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.contraction_mrr).toBe(100);
    expect(march!.stable_mrr).toBe(100);
  });

  it("classifies churn MRR when customer cancels", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-15T00:00:00Z"),
        currentMrr: 100,
      }),
    ]);

    const result = await getRevenueMovements();
    const march = result.find((m) => m.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.churned_mrr).toBe(100);
  });

  it("classifies reactivation MRR for returning customers", async () => {
    vi.stubEnv("DEMO_AS_OF", "2025-04-30T23:59:59.999Z");
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
        startedAt: new Date("2025-04-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 150,
      }),
    ]);

    const result = await getRevenueMovements();
    const april = result.find((m) => m.month === "2025-04-01");
    expect(april).toBeDefined();
    expect(april!.reactivation_mrr).toBe(150);
    expect(april!.new_mrr).toBe(0);
  });

  it("classifies stable MRR when no change", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-1",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const result = await getRevenueMovements();
    const march = result.find((m) => m.month === "2025-03-01");
    expect(march).toBeDefined();
    expect(march!.stable_mrr).toBe(100);
    expect(march!.new_mrr).toBe(0);
    expect(march!.expansion_mrr).toBe(0);
    expect(march!.contraction_mrr).toBe(0);
    expect(march!.churned_mrr).toBe(0);
    expect(march!.reactivation_mrr).toBe(0);
  });

  it("normalizes annual plan MRR to monthly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        billingInterval: "annual",
        currentMrr: 1200,
      }),
    ]);

    const result = await getRevenueMovements();
    const jan = result.find((m) => m.month === "2025-01-01");
    expect(jan).toBeDefined();
    expect(jan!.new_mrr).toBe(1200);
  });

  it("respects from/to filters", async () => {
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
        startedAt: new Date("2025-06-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 200,
      }),
    ]);

    const result = await getRevenueMovements({
      from: new Date("2025-03-01T00:00:00Z"),
      to: new Date("2025-04-01T00:00:00Z"),
    });
    expect(result).toHaveLength(0);
  });
});

describe("getRevenueSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2025-03-31T23:59:59.999Z");
  });

  it("calculates current MRR and ARR correctly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ id: "sub-1", customerId: "cust-1", currentMrr: 100, startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: null }),
      mockSubscription({ id: "sub-2", customerId: "cust-2", currentMrr: 200, startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: null }),
    ]);

    const summary = await getRevenueSummary();
    expect(summary.current_mrr).toBe(300);
    expect(summary.current_arr).toBe(3600);
  });

  it("calculates NRR and GRR correctly", async () => {
    // Setup: Feb MRR = 500 (cust1 100 + cust2 300 + cust3 100)
    // March: cust1 expands by 100, cust2 contracts by 200, cust3 churns 100
    mockPrisma.subscription.findMany.mockResolvedValue([
      // cust-1: active through Feb and Mar, expansion in March via overlapping sub
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-1",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 200,
      }),
      // cust-2: active through Feb and Mar, contraction in March via overlapping sub
      mockSubscription({
        id: "sub-3",
        customerId: "cust-2",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-01T00:00:00Z"),
        currentMrr: 300,
      }),
      mockSubscription({
        id: "sub-4",
        customerId: "cust-2",
        startedAt: new Date("2025-03-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
      // cust-3: churns in March
      mockSubscription({
        id: "sub-5",
        customerId: "cust-3",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-15T00:00:00Z"),
        currentMrr: 100,
      }),
    ]);

    const summary = await getRevenueSummary();
    // Starting MRR (Feb) = 100 + 300 + 100 = 500
    // Expansion = 100, Contraction = 200, Churn = 100
    // NRR = (500 + 100 - 200 - 100) / 500 = 0.6
    // GRR = (500 - 200 - 100) / 500 = 0.4
    expect(summary.nrr).toBe(0.6);
    expect(summary.grr).toBe(0.4);
  });

  it("calculates logo churn rate correctly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-15T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-2",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 200,
      }),
    ]);

    const summary = await getRevenueSummary();
    // 2 customers at start of current month, 1 churned
    expect(summary.logo_churn_rate).toBe(0.5);
  });

  it("calculates revenue churn rate correctly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: new Date("2025-03-15T00:00:00Z"),
        currentMrr: 100,
      }),
      mockSubscription({
        id: "sub-2",
        customerId: "cust-2",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 400,
      }),
    ]);

    const summary = await getRevenueSummary();
    // Starting MRR = 500, churned = 100
    expect(summary.revenue_churn_rate).toBe(0.2);
  });

  it("calculates ARPA and LTV correctly", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ id: "sub-1", customerId: "cust-1", currentMrr: 100, startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: null }),
      mockSubscription({ id: "sub-2", customerId: "cust-2", currentMrr: 300, startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: null }),
    ]);

    const summary = await getRevenueSummary();
    expect(summary.arpa).toBe(200);
    // With zero observed churn, LTV cannot be estimated.
    expect(summary.ltv).toBeNull();
  });

  it("returns MRR history for 12 months", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2024-06-01T00:00:00Z"),
        endedAt: null,
        currentMrr: 100,
      }),
    ]);

    const summary = await getRevenueSummary();
    expect(summary.mrr_history).toHaveLength(12);
  });
});
