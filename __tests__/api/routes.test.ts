import { describe, it, expect, vi, beforeEach } from "vitest";

// Ensure prisma mock is registered before route imports
import "../mocks/prisma";
import { mockPrisma } from "../mocks/prisma";
import { mockSubscription } from "../helpers/factories";

describe("API route tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan.findMany.mockResolvedValue([]);
  });

  describe("GET /api/revenue/summary", () => {
    it("returns revenue summary on happy path", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        mockSubscription({ id: "sub-1", customerId: "cust-1", currentMrr: 100, startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: null }),
      ]);

      const { GET } = await import("@/app/api/revenue/summary/route");
      const req = new Request("http://localhost/api/revenue/summary");
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("current_mrr");
      expect(body).toHaveProperty("current_arr");
      expect(body).toHaveProperty("nrr");
      expect(body).toHaveProperty("grr");
    });
  });

  describe("GET /api/revenue/movements", () => {
    it("returns movements on happy path", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/revenue/movements/route");
      const req = new Request("http://localhost/api/revenue/movements");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("movements");
    });

    it("rejects invalid date format with 400", async () => {
      const { GET } = await import("@/app/api/revenue/movements/route");
      const req = new Request("http://localhost/api/revenue/movements?from=bad-date");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_query");
      expect(body.error.issues).toHaveProperty("from");
    });

    it("rejects from after to with 400", async () => {
      const { GET } = await import("@/app/api/revenue/movements/route");
      const req = new Request("http://localhost/api/revenue/movements?from=2025-06-01&to=2025-01-01");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_query");
      expect(body.error.issues).toHaveProperty("from");
    });

    it("rejects a calendar date that would otherwise roll into the next month", async () => {
      const { GET } = await import("@/app/api/revenue/movements/route");
      const res = await GET(new Request("http://localhost/api/revenue/movements?to=2025-02-31"));
      expect(res.status).toBe(400);
    });

    it("accepts valid segment and plan filters", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/revenue/movements/route");
      const req = new Request("http://localhost/api/revenue/movements?segment=saas&plan=starter&from=2025-01-01&to=2025-03-01");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("movements");
    });
  });

  describe("GET /api/customers", () => {
    it("returns customer list on happy path", async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/customers/route");
      const req = new Request("http://localhost/api/customers");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("customers");
    });

    it("accepts query filters", async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/customers/route");
      const req = new Request("http://localhost/api/customers?status=active&sortBy=name&sortOrder=desc");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("customers");
    });
  });

  describe("GET /api/customers/[id]", () => {
    it("returns customer detail on happy path", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        name: "A",
        domain: "a.com",
        industry: "SaaS",
        companySize: "10-50",
        country: "US",
        acquisitionChannel: "organic",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        convertedAt: new Date("2025-01-01T00:00:00Z"),
        churnedAt: null,
        status: "active",
        subscriptions: [mockSubscription({ currentMrr: 100, plan: { name: "Starter" } })],
        invoices: [],
        productEvents: [],
      });

      const { GET } = await import("@/app/api/customers/[id]/route");
      const req = new Request("http://localhost/api/customers/a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      const res = await GET(req, { params: Promise.resolve({ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("customer");
    });

    it("returns 400 for invalid UUID", async () => {
      const { GET } = await import("@/app/api/customers/[id]/route");
      const req = new Request("http://localhost/api/customers/not-a-uuid");
      const res = await GET(req, { params: Promise.resolve({ id: "not-a-uuid" }) });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_params");
    });

    it("returns 404 for missing customer", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      const { GET } = await import("@/app/api/customers/[id]/route");
      const req = new Request("http://localhost/api/customers/a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      const res = await GET(req, { params: Promise.resolve({ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }) });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe("GET /api/forecast/revenue", () => {
    it("returns forecast on happy path", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/forecast/revenue/route");
      const req = new Request("http://localhost/api/forecast/revenue");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("baseline");
      expect(body).toHaveProperty("conservative");
      expect(body).toHaveProperty("optimistic");
    });

    it("rejects out-of-range parameters with 400", async () => {
      const { GET } = await import("@/app/api/forecast/revenue/route");
      const req = new Request("http://localhost/api/forecast/revenue?churnRate=5");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_query");
    });
  });

  describe("GET /api/analytics/churn", () => {
    it("returns churn analysis on happy path", async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const { GET } = await import("@/app/api/analytics/churn/route");
      const req = new Request("http://localhost/api/analytics/churn");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("churnOverTime");
    });
  });
});
