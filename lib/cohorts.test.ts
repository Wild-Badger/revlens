import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLogoRetentionCohorts, getRevenueRetentionCohorts, getPlanRetention, getSegmentRetention } from "@/lib/cohorts";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockPrisma = prisma as unknown as { subscription: { findMany: ReturnType<typeof vi.fn> } };

describe("cohorts.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-31T23:59:59.999Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("does not inflate acquisition MRR with a later plan replacement", async () => {
    const base = { customerId: "one", plan: { name: "Starter" },
      customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" } };
    mockPrisma.subscription.findMany.mockResolvedValue([
      { ...base, startedAt: new Date("2025-01-01Z"), endedAt: new Date("2025-03-15Z"), currentMrr: 100 },
      { ...base, startedAt: new Date("2025-03-15Z"), endedAt: null, currentMrr: 200 },
    ]);
    const result = await getRevenueRetentionCohorts();
    expect(result.rows[0].cohortSize).toBe(100);
    expect(result.rows[0].retention).toEqual([1, 1, 2]);
  });

  describe("getLogoRetentionCohorts", () => {
    it("should return empty data when no subscriptions exist", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getLogoRetentionCohorts();

      expect(result).toEqual({
        rows: [],
        maxMonths: 0,
        segments: [],
        plans: [],
        asOf: "2025-03-31T23:59:59.999Z",
      });
    });

    it("should calculate logo retention for single cohort", async () => {
      const mockSubscriptions = [
        {
          id: "1",
          customerId: "cust-1",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: null as unknown as Date,
          currentMrr: 100,
        },
        {
          id: "2",
          customerId: "cust-1",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-02-01T00:00:00Z"),
          endedAt: null as unknown as Date,
          currentMrr: 150,
        },
        {
          id: "3",
          customerId: "cust-2",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: null as unknown as Date,
          currentMrr: 200,
        },
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(mockSubscriptions);

      const result = await getLogoRetentionCohorts();

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]).toHaveProperty("cohort");
      expect(result.rows[0]).toHaveProperty("cohortSize");
      expect(result.rows[0]).toHaveProperty("retention");
      expect(Array.isArray(result.rows[0].retention)).toBe(true);
      expect(result).toHaveProperty("maxMonths");
      expect(result).toHaveProperty("segments");
    });

    it("keeps a stable industry catalogue while filtering both cohort types by industry and plan", async () => {
      const base = { startedAt: new Date("2025-01-01Z"), endedAt: null, currentMrr: 100 };
      mockPrisma.subscription.findMany.mockResolvedValue([
        { ...base, customerId: "tech", plan: { name: "Starter" }, customer: { industry: "Tech" } },
        { ...base, customerId: "retail", plan: { name: "Growth" }, customer: { industry: "Retail" } },
      ]);
      for (const calculate of [getLogoRetentionCohorts, getRevenueRetentionCohorts]) {
        const all = await calculate();
        expect(all.segments).toEqual(["Retail", "Tech"]);
        expect(all.rows[0].retention).toEqual([1, 1, 1]);
        for (const segment of all.segments) {
          const selected = await calculate({ segment });
          expect(selected.rows).toHaveLength(1);
          expect(selected.segments).toEqual(all.segments);
        }
        expect((await calculate({ segment: "tech", plan: "starter" })).rows).toHaveLength(1);
        const empty = await calculate({ segment: "Tech", plan: "Growth" });
        expect(empty.rows).toEqual([]);
        expect(empty.segments).toEqual(all.segments);
        expect((await calculate()).rows).toHaveLength(1);
      }
    });
  });

  describe("getPlanRetention", () => {
    it("counts a customer as retained only in the same plan and excludes future subscriptions", async () => {
      const customer = { industry: "Tech", companySize: "S", country: "US" };
      mockPrisma.subscription.findMany.mockResolvedValue([
        { customerId: "moved", plan: { name: "Starter" }, customer, startedAt: new Date("2025-01-01Z"), endedAt: new Date("2025-03-01Z") },
        { customerId: "moved", plan: { name: "Growth" }, customer, startedAt: new Date("2025-03-01Z"), endedAt: null },
        { customerId: "future", plan: { name: "Starter" }, customer, startedAt: new Date("2025-04-01Z"), endedAt: null },
        { customerId: "future-only", plan: { name: "Enterprise" }, customer, startedAt: new Date("2025-04-01Z"), endedAt: null },
      ]);
      expect(await getPlanRetention()).toEqual([
        { plan: "Starter", sampleSize: 1, retentionRate: 0 },
        { plan: "Growth", sampleSize: 1, retentionRate: 1 },
      ]);
    });

    it("should return plan retention rates", async () => {
      const mockSubscriptions = [
        {
          id: "1",
          customerId: "cust-1",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: null as unknown as Date,
          currentMrr: 100,
        },
        {
          id: "2",
          customerId: "cust-2",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: null as unknown as Date,
          currentMrr: 200,
        },
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(mockSubscriptions);

      const result = await getPlanRetention();

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("plan");
        expect(result[0]).toHaveProperty("retentionRate");
        expect(result[0]).toHaveProperty("sampleSize");
        expect(typeof result[0].retentionRate).toBe("number");
        expect(result[0].retentionRate).toBeGreaterThanOrEqual(0);
        expect(result[0].retentionRate).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("getSegmentRetention", () => {
    it("excludes customers whose first subscription is after the snapshot from every denominator", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { customerId: "past", plan: { name: "Starter" }, customer: { industry: "Tech", companySize: "S", country: "US" }, startedAt: new Date("2025-01-01Z"), endedAt: null },
        { customerId: "future", plan: { name: "Growth" }, customer: { industry: "Retail", companySize: "S", country: "US" }, startedAt: new Date("2025-04-01Z"), endedAt: null },
      ]);
      expect(await getSegmentRetention()).toEqual([
        { segment: "Industry: Tech", sampleSize: 1, retentionRate: 1 },
        { segment: "Size: S", sampleSize: 1, retentionRate: 1 },
        { segment: "Country: US", sampleSize: 1, retentionRate: 1 },
      ]);
      for (const calculate of [getLogoRetentionCohorts, getRevenueRetentionCohorts]) {
        expect((await calculate()).segments).toEqual(["Tech"]);
      }
    });

    it("should return segment retention rates", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getSegmentRetention();

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
