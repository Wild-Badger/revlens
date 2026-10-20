import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPrisma } from "../../mocks/prisma";
import { Prisma } from "@prisma/client";
import { GET } from "@/app/api/customers/[id]/revenue-history/route";

describe("GET /api/customers/:id/revenue-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid UUID", async () => {
    const request = new Request("http://localhost/api/customers/not-a-uuid/revenue-history");
    const response = await GET(request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_params");
  });

  it("returns 404 when customer is not found", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    const request = new Request("http://localhost/api/customers/123e4567-e89b-12d3-a456-426614174000/revenue-history");
    const response = await GET(request, {
      params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Customer not found");
  });

  it("returns revenue lifecycle for a customer", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: "cust-1",
      status: "active",
      subscriptions: [
        {
          id: "sub-1",
          status: "active",
          startedAt: new Date("2025-01-15T00:00:00Z"),
          endedAt: null,
          currentMrr: new Prisma.Decimal(100),
          seats: 5,
          plan: { name: "Starter" },
        },
      ],
    });

    const request = new Request("http://localhost/api/customers/123e4567-e89b-12d3-a456-426614174000/revenue-history");
    const response = await GET(request, {
      params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.revenueHistory).toBeDefined();
    expect(body.revenueHistory.length).toBeGreaterThan(0);
    expect(body.planTimeline).toBeDefined();
    expect(body.planTimeline.length).toBe(1);
    expect(body.planTimeline[0].plan).toBe("Starter");
    expect(body.planTimeline[0].change).toBe("started");
    expect(body.subscriptions).toBeDefined();
    expect(body.subscriptions.length).toBe(1);
    expect(body.subscriptions[0].mrr).toBe(100);
  });

  it("dates cancellation and a later reactivation separately", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: "cust-1",
      status: "active",
      subscriptions: [
        {
          id: "sub-1",
          status: "cancelled",
          startedAt: new Date("2025-01-01T00:00:00Z"),
          endedAt: new Date("2025-03-01T00:00:00Z"),
          currentMrr: new Prisma.Decimal(100),
          seats: 5,
          plan: { name: "Starter" },
        },
        {
          id: "sub-2",
          status: "active",
          startedAt: new Date("2025-03-05T00:00:00Z"),
          endedAt: null,
          currentMrr: new Prisma.Decimal(199),
          seats: 10,
          plan: { name: "Growth" },
        },
      ],
    });

    const request = new Request("http://localhost/api/customers/123e4567-e89b-12d3-a456-426614174000/revenue-history");
    const response = await GET(request, {
      params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.planTimeline).toEqual([
      { date: "2025-01-01T00:00:00.000Z", plan: "Starter", seats: 5, mrr: 100, change: "started" },
      { date: "2025-03-01T00:00:00.000Z", plan: "Starter", seats: 5, mrr: 0, change: "cancelled" },
      { date: "2025-03-05T00:00:00.000Z", plan: "Growth", seats: 10, mrr: 199, change: "reactivated" },
    ]);
    expect(body.revenueHistory.some((h: { mrr: number }) => h.mrr === 100)).toBe(true);
    expect(body.revenueHistory.some((h: { mrr: number }) => h.mrr === 199)).toBe(true);
  });
});
