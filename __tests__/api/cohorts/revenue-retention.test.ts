import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPrisma } from "../../mocks/prisma";
import { Prisma } from "@prisma/client";
import { GET } from "@/app/api/cohorts/revenue-retention/route";

describe("GET /api/cohorts/revenue-retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid query parameters", async () => {
    const request = new Request("http://localhost/api/cohorts/revenue-retention?segment=");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_query");
  });

  it("returns revenue retention cohorts", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-15T00:00:00Z"),
        endedAt: null,
        currentMrr: new Prisma.Decimal(100),
        seats: 1,
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
          convertedAt: new Date("2025-01-15T00:00:00Z"),
          churnedAt: null,
          status: "active",
        },
        plan: {
          id: "plan-1",
          name: "Starter",
          billingInterval: "monthly",
          basePrice: new Prisma.Decimal(49),
          seatPrice: new Prisma.Decimal(10),
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      },
      {
        id: "sub-2",
        customerId: "cust-2",
        startedAt: new Date("2025-01-20T00:00:00Z"),
        endedAt: new Date("2025-02-20T00:00:00Z"),
        currentMrr: new Prisma.Decimal(200),
        seats: 1,
        status: "cancelled",
        customer: {
          id: "cust-2",
          name: "Customer 2",
          domain: "c2.com",
          industry: "Fintech",
          companySize: "50-200",
          country: "GB",
          acquisitionChannel: "paid",
          createdAt: new Date("2024-12-01T00:00:00Z"),
          convertedAt: new Date("2025-01-20T00:00:00Z"),
          churnedAt: new Date("2025-02-20T00:00:00Z"),
          status: "churned",
        },
        plan: {
          id: "plan-2",
          name: "Growth",
          billingInterval: "monthly",
          basePrice: new Prisma.Decimal(199),
          seatPrice: new Prisma.Decimal(20),
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      },
    ]);

    const request = new Request("http://localhost/api/cohorts/revenue-retention");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.rows).toBeDefined();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.maxMonths).toBeDefined();
    expect(body.segments).toBeDefined();

    const cohort = body.rows.find((r: { cohort: string }) => r.cohort === "2025-01-01");
    expect(cohort).toBeDefined();
    expect(cohort.cohortSize).toBe(300); // 100 + 200 initial MRR
    expect(cohort.retention[0]).toBe(1); // month 0: both active at end of Jan
  });

  it("filters by plan name", async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        customerId: "cust-1",
        startedAt: new Date("2025-01-15T00:00:00Z"),
        endedAt: null,
        currentMrr: new Prisma.Decimal(100),
        seats: 1,
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
          convertedAt: new Date("2025-01-15T00:00:00Z"),
          churnedAt: null,
          status: "active",
        },
        plan: {
          id: "plan-1",
          name: "Starter",
          billingInterval: "monthly",
          basePrice: new Prisma.Decimal(49),
          seatPrice: new Prisma.Decimal(10),
          createdAt: new Date("2024-01-01T00:00:00Z"),
        },
      },
    ]);

    const request = new Request("http://localhost/api/cohorts/revenue-retention?plan=Starter");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.segments).toContain("SaaS");
  });
});
