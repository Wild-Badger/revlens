import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { mockPrisma } from "../../mocks/prisma";
import { GET } from "@/app/api/forecast/revenue/route";

describe("GET /api/forecast/revenue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid query parameters", async () => {
    const request = new Request("http://localhost/api/forecast/revenue?churnRate=2.5");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_query");
  });

  it("returns forecast scenarios with historical data", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: new Prisma.Decimal(1000),
        seats: 10,
        status: "active",
        customer: {
          id: "cust-1",
          name: "Customer 1",
          domain: "c1.com",
          industry: "SaaS",
          companySize: "10-50",
          country: "US",
          acquisitionChannel: "organic",
          createdAt: new Date("2024-12-01T00:00:00Z"),
          convertedAt: new Date("2025-01-01T00:00:00Z"),
          churnedAt: null,
          status: "active",
        },
        plan: {
          id: "plan-1",
          name: "Growth",
          billingInterval: "monthly",
          basePrice: new Prisma.Decimal(199),
          seatPrice: new Prisma.Decimal(20),
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      },
    ]);

    const request = new Request("http://localhost/api/forecast/revenue");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.baseline).toBeDefined();
    expect(body.baseline.length).toBe(12);
    expect(body.conservative).toBeDefined();
    expect(body.conservative.length).toBe(12);
    expect(body.optimistic).toBeDefined();
    expect(body.optimistic.length).toBe(12);
    expect(body.assumptions).toBeDefined();
    expect(body.historicalMrr).toBeDefined();
    expect(body.historicalMrr.length).toBeGreaterThan(0);
  });

  it("accepts override parameters", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-01T00:00:00Z"),
        endedAt: null,
        currentMrr: new Prisma.Decimal(1000),
        seats: 10,
        status: "active",
        customer: {
          id: "cust-1",
          name: "Customer 1",
          domain: "c1.com",
          industry: "SaaS",
          companySize: "10-50",
          country: "US",
          acquisitionChannel: "organic",
          createdAt: new Date("2024-12-01T00:00:00Z"),
          convertedAt: new Date("2025-01-01T00:00:00Z"),
          churnedAt: null,
          status: "active",
        },
        plan: {
          id: "plan-1",
          name: "Growth",
          billingInterval: "monthly",
          basePrice: new Prisma.Decimal(199),
          seatPrice: new Prisma.Decimal(20),
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      },
    ]);

    const request = new Request(
      "http://localhost/api/forecast/revenue?newMrrGrowth=0.1&churnRate=0.05&expansionRate=0.03"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.assumptions.newMrrGrowth).toBe(0.1);
    expect(body.assumptions.churnRate).toBe(0.05);
    expect(body.assumptions.expansionRate).toBe(0.03);
  });

  it("uses disclosed example assumptions and preserves scenario ordering after a large observed loss", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_AS_OF", "2026-09-30T23:59:59.999Z");
    mockPrisma.subscription.findMany.mockResolvedValue([
      { startedAt: new Date("2026-01-01"), endedAt: null, currentMrr: new Prisma.Decimal(200) },
      { startedAt: new Date("2026-01-01"), endedAt: new Date("2026-09-10"), currentMrr: new Prisma.Decimal(240) },
    ]);
    const response = await GET(new Request("http://localhost/api/forecast/revenue"));
    const body = await response.json();
    expect(body.assumptions).toEqual({ newMrrGrowth: 0.05, churnRate: 0.02, expansionRate: 0.02 });
    expect(body.historicalMrr.at(-1).mrr).toBe(200);
    expect(body.conservative[0].mrr).toBeLessThanOrEqual(body.baseline[0].mrr);
    expect(body.baseline[0].mrr).toBeLessThanOrEqual(body.optimistic[0].mrr);
    vi.unstubAllEnvs();
  });
});
