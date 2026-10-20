import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "../mocks/prisma";
import { mockSubscription } from "../helpers/factories";
import { getRevenueMovements, getRevenueSummary } from "@/lib/revenue";

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("revenue reconciliation", () => {
  it("measures retention on the opening customer cohort, excluding same-month acquisition and churn", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2025-03-31T23:59:59.999Z");
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ customerId: "existing", currentMrr: 200 }),
      mockSubscription({ id: "new", customerId: "new", currentMrr: 500, startedAt: new Date("2025-03-01T00:00:00Z"), endedAt: new Date("2025-03-20T00:00:00Z") }),
    ]);
    const summary = await getRevenueSummary();
    expect(summary.nrr).toBe(1);
    expect(summary.grr).toBe(1);
    expect(summary.logo_churn_rate).toBe(0);
    expect(summary.revenue_churn_rate).toBe(0);
  });

  it("classifies a simultaneous downgrade without churn or reactivation", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ currentMrr: 200, endedAt: new Date("2025-03-01T00:00:00Z") }),
      mockSubscription({ id: "replacement", currentMrr: 80, startedAt: new Date("2025-03-01T00:00:00Z") }),
    ]);
    const movement = (await getRevenueMovements()).find((row) => row.month === "2025-03-01")!;
    expect(movement.contraction_mrr).toBe(120);
    expect(movement.churned_mrr).toBe(0);
    expect(movement.reactivation_mrr).toBe(0);
  });

  it("treats cancelling one of two subscriptions as contraction, not customer churn", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ currentMrr: 200, endedAt: new Date("2025-03-10T00:00:00Z") }),
      mockSubscription({ id: "second", currentMrr: 80 }),
    ]);
    const movement = (await getRevenueMovements()).find((row) => row.month === "2025-03-01")!;
    expect(movement.contraction_mrr).toBe(200);
    expect(movement.churned_mrr).toBe(0);
  });

  it("excludes future subscriptions and reconciles history with current MRR", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2025-03-31T23:59:59.999Z");
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ currentMrr: 200 }),
      mockSubscription({ id: "future", currentMrr: 500, startedAt: new Date("2025-04-01T00:00:00Z") }),
    ]);
    const summary = await getRevenueSummary();
    expect(summary.current_mrr).toBe(200);
    expect(summary.mrr_history.at(-1)?.mrr).toBe(summary.current_mrr);
    expect(summary.ltv).toBeNull();
    const movements = await getRevenueMovements({ to: new Date("2026-01-01T23:59:59.999Z") });
    expect(movements.some((row) => row.month >= "2025-04-01")).toBe(false);
  });

  it("uses industry alone for the shared industry filter", async () => {
    const subscription = mockSubscription({ currentMrr: 200 });
    subscription.customer.industry = "SaaS";
    subscription.customer.acquisitionChannel = "referral";
    mockPrisma.subscription.findMany.mockResolvedValue([subscription]);
    expect(await getRevenueMovements({ segment: "referral" })).toEqual([]);
    expect((await getRevenueMovements({ segment: "saas" }))[0].new_mrr).toBe(200);
  });
});
