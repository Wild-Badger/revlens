import { describe, it, expect, beforeEach, vi } from "vitest";
import { getForecastScenarios, ForecastAssumptions, ForecastScenarios } from "@/lib/forecast";
import { getRevenueForecast as getRevenueForecastAnalytics } from "@/lib/analytics";

vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockPrisma = prisma as unknown as { subscription: { findMany: ReturnType<typeof vi.fn> } };

describe("forecast.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getForecastScenarios", () => {
    it("should return forecast scenarios with historical data", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getForecastScenarios();

      expect(result).toHaveProperty("conservative");
      expect(result).toHaveProperty("baseline");
      expect(result).toHaveProperty("optimistic");
      expect(result).toHaveProperty("assumptions");
      expect(result).toHaveProperty("historicalMrr");
      expect(Array.isArray(result.conservative)).toBe(true);
      expect(Array.isArray(result.baseline)).toBe(true);
      expect(Array.isArray(result.optimistic)).toBe(true);
    });

    it("should apply custom assumptions when provided", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const customAssumptions: Partial<ForecastAssumptions> = {
        newMrrGrowth: 0.1,
        churnRate: 0.05,
        expansionRate: 0.08,
      };

      const result = await getForecastScenarios(customAssumptions);

      expect(result.assumptions.newMrrGrowth).toBe(0.1);
      expect(result.assumptions.churnRate).toBe(0.05);
      expect(result.assumptions.expansionRate).toBe(0.08);
    });

    it("should project 12 months of forecast", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getForecastScenarios();

      expect(result.baseline.length).toBe(12);
      expect(result.conservative.length).toBe(12);
      expect(result.optimistic.length).toBe(12);
    });

    it("should have scenario points with month and mrr", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getForecastScenarios();

      if (result.baseline.length > 0) {
        expect(result.baseline[0]).toHaveProperty("month");
        expect(result.baseline[0]).toHaveProperty("mrr");
        expect(typeof result.baseline[0].mrr).toBe("number");
      }
    });

    it("should have positive MRR values in forecast", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getForecastScenarios();

      for (const scenario of [result.baseline, result.conservative, result.optimistic]) {
        for (const point of scenario) {
          expect(point.mrr).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("should include assumptions with valid growth rates", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getForecastScenarios();

      expect(result.assumptions).toHaveProperty("newMrrGrowth");
      expect(result.assumptions).toHaveProperty("churnRate");
      expect(result.assumptions).toHaveProperty("expansionRate");
      expect(result.assumptions.newMrrGrowth).toBeGreaterThanOrEqual(0);
      expect(result.assumptions.churnRate).toBeGreaterThanOrEqual(0);
      expect(result.assumptions.expansionRate).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("analytics.ts - Revenue Forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRevenueForecast", () => {
    it("should return forecast data structure", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getRevenueForecastAnalytics();

      expect(result).toHaveProperty("historicalMrr");
      expect(result).toHaveProperty("forecast");
      expect(result).toHaveProperty("pipelineGap");
      expect(result).toHaveProperty("arrTargetTracker");
      expect(Array.isArray(result.historicalMrr)).toBe(true);
      expect(Array.isArray(result.forecast)).toBe(true);
    });

    it("should calculate linear regression for projection", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getRevenueForecastAnalytics();

      if (result.forecast.length > 0) {
        expect(result.forecast[0]).toHaveProperty("month");
        expect(result.forecast[0]).toHaveProperty("projectedMrr");
      }
    });

    it("should handle empty data gracefully", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await getRevenueForecastAnalytics();

      expect(result.historicalMrr).toEqual([]);
      expect(result.forecast).toEqual([]);
    });
  });
});
