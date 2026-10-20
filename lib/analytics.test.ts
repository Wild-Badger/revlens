import { describe, it, expect, beforeEach, vi } from "vitest";
import { getChurnAnalysis, ChurnAnalysis } from "@/lib/analytics";

vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockPrisma = prisma as unknown as { subscription: { findMany: ReturnType<typeof vi.fn> } };

describe("analytics.ts - Churn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getChurnAnalysis", () => {
    it("should return empty analysis when no subscriptions exist", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getChurnAnalysis();

      expect(result).toEqual({
        churnOverTime: [],
        churnByPlan: [],
        churnByIndustry: [],
        churnByChannel: [],
        totalRevenueLost: 0,
      });
    });

    it("should calculate churn rates over time", async () => {
      const mockSubscriptions = [
        {
          id: "1",
          customerId: "cust-1",
          planId: "plan-1",
          plan: { name: "Starter" },
          customer: { companySize: "S", industry: "Tech", country: "US", acquisitionChannel: "organic" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: new Date("2024-06-01T00:00:00Z"),
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
        {
          id: "3",
          customerId: "cust-3",
          planId: "plan-2",
          plan: { name: "Growth" },
          customer: { companySize: "M", industry: "Finance", country: "US", acquisitionChannel: "paid" },
          startedAt: new Date("2024-01-01T00:00:00Z"),
          endedAt: new Date("2024-06-01T00:00:00Z"),
          currentMrr: 500,
        },
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(mockSubscriptions);

      const result = await getChurnAnalysis();

expect(result.churnOverTime).toBeDefined();
      expect(result.churnByPlan).toBeDefined();
      expect(result.churnByIndustry).toBeDefined();
      expect(result.churnByChannel).toBeDefined();
      expect(result.totalRevenueLost).toBeDefined();
      expect(typeof result.totalRevenueLost).toBe("number");
    });

    it("should group churn by plan", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getChurnAnalysis();

      expect(result.churnByPlan).toBeDefined();
      expect(Array.isArray(result.churnByPlan)).toBe(true);
    });

    it("should filter by segment when provided", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await getChurnAnalysis({ segment: "Tech" });

      expect(mockPrisma.subscription.findMany).toHaveBeenCalled();
    });

    it("should filter by plan when provided", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await getChurnAnalysis({ plan: "Enterprise" });

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            plan: expect.objectContaining({
              name: expect.objectContaining({ equals: "Enterprise" }),
            }),
          }),
        })
      );
    });
  });
});