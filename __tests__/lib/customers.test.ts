import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockPrisma } from "../mocks/prisma";
import { getCustomersList, getCustomerDetail, getCustomerRevenueHistory } from "@/lib/customers";
import { mockSubscription, mockInvoice, mockProductEvent } from "../helpers/factories";

const asOf = new Date("2026-09-30T23:59:59.999Z");

vi.mock("@/lib/dataset", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/dataset")>(),
  getAsOf: vi.fn(async () => new Date("2026-09-30T23:59:59.999Z")),
}));

describe("getCustomersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns current payment status current when no issues", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
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
        invoices: [mockInvoice({ status: "paid" }), mockInvoice({ status: "paid" })],
        productEvents: [mockProductEvent()],
      },
    ]);

    const result = await getCustomersList();
    expect(result[0].paymentStatus).toBe("current");
  });

  it("returns paymentStatus failed when invoices are failed", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
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
        subscriptions: [mockSubscription()],
        invoices: [mockInvoice({ status: "failed" })],
        productEvents: [mockProductEvent()],
      },
    ]);

    const result = await getCustomersList();
    expect(result[0].paymentStatus).toBe("failed");
  });

  it("returns paymentStatus at_risk when more than 2 open invoices", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
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
        subscriptions: [mockSubscription()],
        invoices: [
          mockInvoice({ status: "open" }),
          mockInvoice({ status: "open" }),
          mockInvoice({ status: "open" }),
        ],
        productEvents: [mockProductEvent()],
      },
    ]);

    const result = await getCustomersList();
    expect(result[0].paymentStatus).toBe("at_risk");
  });

  it("does not score future churn risk for already churned customers", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
        name: "A",
        domain: "a.com",
        industry: "SaaS",
        companySize: "10-50",
        country: "US",
        acquisitionChannel: "organic",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        convertedAt: new Date("2025-01-01T00:00:00Z"),
        churnedAt: new Date("2025-03-01T00:00:00Z"),
        status: "churned",
        subscriptions: [],
        invoices: [],
        productEvents: [],
      },
    ]);

    const result = await getCustomersList();
    expect(result[0].churnRisk).toBe("not_applicable");
  });

  it("does not score subscription churn risk for unconverted leads", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
        name: "A",
        domain: "a.com",
        industry: "SaaS",
        companySize: "10-50",
        country: "US",
        acquisitionChannel: "organic",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        convertedAt: null,
        churnedAt: null,
        status: "lead",
        subscriptions: [],
        invoices: [],
        productEvents: [],
      },
    ]);

    const result = await getCustomersList();
    expect(result[0].churnRisk).toBe("not_applicable");
  });

  it("classifies churn risk medium for failed payments", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
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
        subscriptions: [mockSubscription()],
        invoices: [mockInvoice({ status: "failed" })],
        productEvents: Array.from({ length: 25 }, () => mockProductEvent()),
      },
    ]);

    const result = await getCustomersList();
    // failed payment = +3, no contraction, events >= 20 = no low-usage penalty
    // score = 3 -> medium (>= 4 is high)
    expect(result[0].churnRisk).toBe("medium");
  });

  it("filters by status", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
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
        subscriptions: [mockSubscription()],
        invoices: [],
        productEvents: [],
      },
      {
        id: "cust-2",
        name: "B",
        domain: "b.com",
        industry: "Fintech",
        companySize: "50-200",
        country: "GB",
        acquisitionChannel: "paid",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        convertedAt: null,
        churnedAt: null,
        status: "lead",
        subscriptions: [],
        invoices: [],
        productEvents: [],
      },
    ]);

    const result = await getCustomersList({ status: "lead" });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("lead");
  });

  it("searches by name, domain, industry, or country", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      {
        id: "cust-1",
        name: "Acme Corp",
        domain: "acme.com",
        industry: "SaaS",
        companySize: "10-50",
        country: "US",
        acquisitionChannel: "organic",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        convertedAt: new Date("2025-01-01T00:00:00Z"),
        churnedAt: null,
        status: "active",
        subscriptions: [mockSubscription()],
        invoices: [],
        productEvents: [],
      },
    ]);

    const byName = await getCustomersList({ search: "acme" });
    expect(byName).toHaveLength(1);

    const byDomain = await getCustomersList({ search: "acme.com" });
    expect(byDomain).toHaveLength(1);

    const byIndustry = await getCustomersList({ search: "saas" });
    expect(byIndustry).toHaveLength(1);

    const byCountry = await getCustomersList({ search: "us" });
    expect(byCountry).toHaveLength(1);

    const noMatch = await getCustomersList({ search: "xyz" });
    expect(noMatch).toHaveLength(0);
  });
});

describe("getCustomerDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for missing customer", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    const result = await getCustomerDetail("missing");
    expect(result).toBeNull();
  });

  it("computes revenue history and plan timeline", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      id: "cust-1",
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
      subscriptions: [
        mockSubscription({
          id: "sub-extra",
          startedAt: new Date("2025-01-01T00:00:00Z"),
          endedAt: new Date("2025-02-01T00:00:00Z"),
          currentMrr: 50,
          plan: { name: "Starter" },
        }),
        mockSubscription({
          id: "sub-1",
          startedAt: new Date("2025-01-01T00:00:00Z"),
          endedAt: new Date("2025-03-01T00:00:00Z"),
          currentMrr: 100,
          plan: { name: "Starter" },
        }),
        mockSubscription({
          id: "sub-2",
          startedAt: new Date("2025-03-01T00:00:00Z"),
          endedAt: null,
          currentMrr: 200,
          plan: { name: "Growth" },
        }),
      ],
      invoices: [mockInvoice({ amount: 100, status: "paid" })],
      productEvents: [mockProductEvent({ eventName: "login" })],
    });

    const result = await getCustomerDetail("cust-1");
    expect(result).not.toBeNull();
    expect(result!.revenueHistory.length).toBeGreaterThan(0);
    expect(result!.planTimeline).toHaveLength(4);
    expect(result!.planTimeline.find((event) => event.plan === "Growth")?.change).toBe("upgraded");
    expect(result!.paymentSummary.totalInvoices).toBe(1);
    expect(result!.usageSummary.totalEvents).toBe(1);
    expect(result!.revenueHistory.find((point) => point.month === "2025-01-01")?.mrr).toBe(150);
    expect(result!.revenueHistory.find((point) => point.month === "2025-02-01")?.mrr).toBe(100);
    expect(result!.revenueHistory.find((point) => point.month === "2025-03-01")?.mrr).toBe(200);
  });
});

describe("customer snapshot evidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies the same plan changes regardless of the caller's subscription order", async () => {
    const first = mockSubscription({ id: "first", currentMrr: 100, startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: new Date("2026-02-01T00:00:00Z") });
    const second = mockSubscription({ id: "second", currentMrr: 200, startedAt: first.endedAt!, endedAt: null });
    const customer = { ...first.customer, invoices: [], productEvents: [] };
    mockPrisma.customer.findUnique.mockResolvedValueOnce({ ...customer, subscriptions: [second, first] });
    mockPrisma.customer.findUnique.mockResolvedValueOnce({ ...customer, subscriptions: [first, second] });
    const detail = await getCustomerDetail("cust-1");
    const history = await getCustomerRevenueHistory("cust-1");
    expect(detail!.planTimeline).toEqual(history!.planTimeline);
    expect(detail!.planTimeline.find((event) => event.mrr === 200)?.change).toBe("upgraded");
    expect(detail!.planTimeline.some((event) => event.change === "cancelled")).toBe(false);
  });

  it("dates cancellation at the actual end in both timelines and excludes future events", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      ...mockSubscription().customer,
      subscriptions: [
        mockSubscription({ startedAt: new Date("2026-09-01T00:00:00Z"), endedAt: new Date("2026-09-12T00:00:00Z") }),
        mockSubscription({ id: "returned", startedAt: new Date("2026-09-15T00:00:00Z"), endedAt: new Date("2026-10-05T00:00:00Z") }),
        mockSubscription({ id: "future", startedAt: new Date("2026-10-05T00:00:00Z") }),
      ],
      invoices: [], productEvents: [],
    });
    const detail = await getCustomerDetail("cust-1");
    const history = await getCustomerRevenueHistory("cust-1");
    expect(detail!.planTimeline).toEqual(history!.planTimeline);
    expect(detail!.planTimeline.map(({ date, change, mrr }) => ({ date, change, mrr }))).toEqual([
      { date: "2026-09-01T00:00:00.000Z", change: "started", mrr: 100 },
      { date: "2026-09-12T00:00:00.000Z", change: "cancelled", mrr: 0 },
      { date: "2026-09-15T00:00:00.000Z", change: "reactivated", mrr: 100 },
    ]);
  });

  it("sums concurrent active subscriptions with inclusive starts and exclusive ends in both views", async () => {
    const customer = {
      ...mockSubscription().customer,
      subscriptions: [
        mockSubscription({ id: "active-a", currentMrr: 100, plan: { name: "Core" } }),
        mockSubscription({ id: "active-b", startedAt: asOf, currentMrr: 50, plan: { name: "Support" } }),
        mockSubscription({ id: "ended", endedAt: asOf, currentMrr: 80, plan: { name: "Old" } }),
        mockSubscription({ id: "future", startedAt: new Date("2026-10-01T00:00:00Z"), currentMrr: 100, plan: { name: "Future" } }),
      ],
      invoices: [],
      productEvents: [],
    };
    mockPrisma.customer.findMany.mockResolvedValue([customer]);
    mockPrisma.customer.findUnique.mockResolvedValue(customer);

    const list = await getCustomersList({ plan: "Support" });
    const detail = await getCustomerDetail(customer.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ currentMrr: 150, plan: "Core + Support" });
    expect(detail).toMatchObject({ currentMrr: 150, plan: "Core + Support" });
    expect(detail!.revenueHistory.at(-1)).toEqual({ month: "2026-09-01", mrr: 150 });
    expect(await getCustomersList({ plan: "Old" })).toHaveLength(0);
    expect(await getCustomersList({ plan: "Future" })).toHaveLength(0);
  });

  it("does not call missing invoice and usage records healthy", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([{
      ...mockSubscription().customer,
      subscriptions: [mockSubscription()], invoices: [], productEvents: [],
    }]);
    const [customer] = await getCustomersList();
    expect(customer.paymentStatus).toBe("not_supplied");
    expect(customer.lastActivityAt).toBeNull();
    expect(customer.churnRiskReason).toContain("Invoice history was not supplied.");
    expect(customer.churnRiskReason).toContain("usage is unknown");
    expect(customer.churnRiskReason).not.toMatch(/healthy|low usage|recent/i);
  });

  it("retains a historical failed invoice and separately dates the newer paid invoice", async () => {
    mockPrisma.customer.findUnique.mockResolvedValue({
      ...mockSubscription().customer,
      subscriptions: [mockSubscription()], productEvents: [],
      invoices: [
        mockInvoice({ id: "new-paid", status: "paid", invoiceDate: new Date("2026-09-01T00:00:00Z") }),
        mockInvoice({ id: "old-failed", status: "failed", invoiceDate: new Date("2025-01-01T00:00:00Z"), failedAt: new Date("2025-01-03T00:00:00Z") }),
      ],
    });
    const detail = await getCustomerDetail("cust-1");
    expect(detail).toMatchObject({
      paymentStatus: "failed",
      paymentSummary: {
        lastPaymentStatus: "paid", lastInvoiceDate: "2026-09-01T00:00:00.000Z",
        lastFailedInvoiceDate: "2025-01-01T00:00:00.000Z", lastFailedAt: "2025-01-03T00:00:00.000Z",
      },
    });
    expect(detail!.churnRiskReason).toContain("still marked failed");
    expect(detail!.churnRiskReason).toContain("not a recency claim");
  });

  it("bounds all customer reads to the dataset date rather than today's date", async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.findUnique.mockResolvedValue(null);
    await getCustomersList();
    await getCustomerDetail("cust-1");
    await getCustomerRevenueHistory("cust-1");
    const include = {
      subscriptions: expect.objectContaining({ where: { startedAt: { lte: asOf } } }),
      invoices: expect.objectContaining({ where: { invoiceDate: { lte: asOf } } }),
      productEvents: expect.objectContaining({ where: { timestamp: { lte: asOf } } }),
    };
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining(include) }));
    expect(mockPrisma.customer.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ include: expect.objectContaining(include) }));
    expect(mockPrisma.customer.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ include: expect.objectContaining({ subscriptions: include.subscriptions }) }));
  });
});
