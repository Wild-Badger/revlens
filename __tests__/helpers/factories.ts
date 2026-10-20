import { Prisma } from "@prisma/client";

export function mockSubscription(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "sub-1",
    customerId: "cust-1",
    planId: "plan-1",
    status: "active",
    startedAt: new Date("2025-01-01T00:00:00Z"),
    endedAt: null,
    billingInterval: "monthly",
    currentMrr: new Prisma.Decimal(100),
    seats: 1,
    customer: {
      id: "cust-1",
      name: "Test Customer",
      domain: "test.com",
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
      name: "Starter",
      billingInterval: "monthly",
      basePrice: new Prisma.Decimal(49),
      seatPrice: new Prisma.Decimal(10),
      createdAt: new Date("2024-01-01T00:00:00Z"),
    },
    ...overrides,
  };
}

export function mockInvoice(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "inv-1",
    customerId: "cust-1",
    subscriptionId: "sub-1",
    amount: new Prisma.Decimal(100),
    currency: "USD",
    status: "paid",
    invoiceDate: new Date("2025-01-01T00:00:00Z"),
    paidAt: new Date("2025-01-05T00:00:00Z"),
    failedAt: null,
    ...overrides,
  };
}

export function mockProductEvent(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 1n,
    customerId: "cust-1",
    userId: "user-1",
    eventName: "login",
    properties: null,
    timestamp: new Date("2025-01-15T00:00:00Z"),
    ...overrides,
  };
}
