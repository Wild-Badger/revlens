import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "@/__tests__/mocks/prisma";
import { mockSubscription } from "@/__tests__/helpers/factories";
import { getChurnAnalysis, getCohortRetention, getRevenueForecast } from "./analytics";

describe("analytics snapshot cutoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2026-09-10T23:59:59.999Z");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the current partial month and excludes future starts and churn", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ customerId: "existing", startedAt: new Date("2026-01-01Z"), endedAt: new Date("2026-09-15Z"), currentMrr: 100 }),
      mockSubscription({ customerId: "future", startedAt: new Date("2026-09-20Z"), currentMrr: 900 }),
    ]);

    const churn = await getChurnAnalysis();
    expect(churn.churnOverTime.at(-1)).toMatchObject({ month: "2026-09-01", totalCustomers: 1, totalRevenue: 100, churnedCustomers: 0 });
    expect(churn.totalRevenueLost).toBe(0);
    expect(churn.churnByPlan[0]).toMatchObject({ totalCount: 1, churnedCount: 0, revenueLost: 0 });
    const forecast = await getRevenueForecast();
    expect(forecast.historicalMrr.at(-1)).toEqual({ month: "2026-09-01", mrr: 100 });
    expect(forecast.forecast[0]).toMatchObject({ month: "2026-10-01", projectedMrr: 100 });
  });

  it("counts boundary churn in the month it occurs and continues through the snapshot", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      mockSubscription({ startedAt: new Date("2026-01-01Z"), endedAt: new Date("2026-03-01Z"), currentMrr: 125.5 }),
    ]);
    const churn = await getChurnAnalysis();
    expect(churn.churnOverTime.find((point) => point.month === "2026-03-01")).toMatchObject({ totalRevenue: 125.5, churnedRevenue: 125.5, churnedCustomers: 1, logoChurnRate: 1 });
    expect(churn.churnOverTime.at(-1)?.month).toBe("2026-09-01");
    expect(churn.totalRevenueLost).toBe(125.5);
  });

  it("uses the canonical cohorts and retains their industry catalog after filtering", async () => {
    const software = mockSubscription({ customerId: "software", startedAt: new Date("2026-01-01Z") });
    const education = mockSubscription({ customerId: "education", startedAt: new Date("2026-01-01Z") });
    software.customer.industry = "Software";
    education.customer.industry = "Education";
    education.plan.name = "Team";
    mockPrisma.subscription.findMany.mockResolvedValue([software, education]);
    const cohorts = await getCohortRetention({ plan: "Starter", segment: "Education" });
    expect(cohorts.rows).toEqual([]);
    expect(cohorts.segments).toEqual(["Education", "Software"]);
  });

  it("treats segment as industry rather than matching another customer attribute", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([mockSubscription({
      startedAt: new Date("2026-01-01Z"), endedAt: new Date("2026-03-01Z"),
    })]);
    expect((await getChurnAnalysis({ segment: "US" })).churnOverTime).toEqual([]);
    expect((await getRevenueForecast({ segment: "US" })).historicalMrr).toEqual([]);
  });
});
