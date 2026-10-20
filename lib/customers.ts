import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAsOf, isActiveAt } from "@/lib/dataset";
import { filterCustomerList } from "@/lib/customer-filter";

export type CustomerListItem = {
  id: string;
  name: string;
  domain: string | null;
  industry: string;
  companySize: string;
  country: string;
  currentMrr: number;
  plan: string | null;
  status: string;
  paymentStatus: "current" | "at_risk" | "failed" | "not_supplied";
  churnRisk: "low" | "medium" | "high" | "not_applicable";
  churnRiskReason: string;
  subscriptionCount: number;
  lastActivityAt: string | null;
};

export type RevenueHistoryPoint = {
  month: string;
  mrr: number;
};

export type PlanChange = {
  date: string;
  plan: string;
  seats: number;
  mrr: number;
  change: "started" | "upgraded" | "downgraded" | "cancelled" | "reactivated";
};

export type PaymentSummary = {
  totalInvoices: number;
  paidInvoices: number;
  failedInvoices: number;
  openInvoices: number;
  totalBilled: number;
  totalPaid: number;
  totalFailed: number;
  lastPaymentStatus: string | null;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  lastFailedInvoiceDate: string | null;
  lastFailedAt: string | null;
};

export type UsageSummary = {
  totalEvents: number;
  uniqueEvents: number;
  eventBreakdown: Record<string, number>;
  lastEventAt: string | null;
};

export type CustomerRevenueLifecycle = {
  revenueHistory: RevenueHistoryPoint[];
  planTimeline: PlanChange[];
  subscriptions: {
    id: string;
    plan: string;
    startedAt: string;
    endedAt: string | null;
    mrr: number;
    seats: number;
    status: string;
  }[];
};

export type CustomerDetail = {
  asOf: string;
  id: string;
  name: string;
  domain: string | null;
  industry: string;
  companySize: string;
  country: string;
  acquisitionChannel: string;
  status: string;
  createdAt: string;
  convertedAt: string | null;
  churnedAt: string | null;
  currentMrr: number;
  plan: string | null;
  paymentStatus: "current" | "at_risk" | "failed" | "not_supplied";
  churnRisk: "low" | "medium" | "high" | "not_applicable";
  churnRiskReason: string;
  revenueHistory: RevenueHistoryPoint[];
  planTimeline: PlanChange[];
  paymentSummary: PaymentSummary;
  usageSummary: UsageSummary;
};

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function computePaymentStatus(
  invoices: { status: string; failedAt: Date | null }[]
): CustomerListItem["paymentStatus"] {
  if (invoices.length === 0) return "not_supplied";
  const failedCount = invoices.filter((i) => i.status === "failed").length;
  const openCount = invoices.filter((i) => i.status === "open").length;

  if (failedCount > 0) return "failed";
  if (openCount > 2) return "at_risk";
  return "current";
}

function computeChurnRisk(
  customer: { status: string; churnedAt: Date | null },
  paymentStatus: CustomerListItem["paymentStatus"],
  invoices: { status: string }[],
  subscriptions: { currentMrr: Prisma.Decimal; startedAt: Date; endedAt: Date | null }[],
  productEvents: { timestamp: Date }[],
  asOf: Date
): { risk: CustomerListItem["churnRisk"]; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  if (customer.status === "churned") {
    return { risk: "not_applicable", reason: "Customer has already churned; future churn risk is not scored." };
  }

  if (customer.status === "lead") {
    return { risk: "not_applicable", reason: "Lead has not converted to paid; subscription churn risk is not scored." };
  }

  if (paymentStatus === "failed") {
    score += 3;
    reasons.push("Invoices are still marked failed in the supplied records; this is not a recency claim.");
  } else if (paymentStatus === "at_risk") {
    score += 2;
    reasons.push("Multiple unpaid invoices.");
  }

  // Check for contraction (current MRR lower than previous max)
  const activeSubs = subscriptions.filter((s) => isActiveAt(s, asOf));
  const currentMrr = activeSubs.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);
  const maxMrr = subscriptions.length > 0
    ? Math.max(...subscriptions.map((s) => toNumber(s.currentMrr)))
    : 0;

  if (maxMrr > 0 && currentMrr < maxMrr * 0.8) {
    score += 2;
    reasons.push("Current MRR is below 80% of the largest recorded subscription amount.");
  }

  // Low usage
  const eventCount = productEvents.length;
  if (eventCount > 0 && eventCount < 20) {
    score += 2;
    reasons.push("Fewer than 20 product events were supplied; this is a count of recorded data, not a recent-usage window.");
  }

  // Recent reactivation is slightly risky
  if (customer.status === "reactivated") {
    score += 1;
    reasons.push("The supplied customer status is reactivated.");
  }

  if (score >= 4) {
    return { risk: "high", reason: reasons.join(" ") || "Multiple risk factors detected." };
  }
  if (score >= 2) {
    return { risk: "medium", reason: reasons.join(" ") || "Some risk factors present." };
  }
  return { risk: "low", reason: `No scored risk flags in supplied records.${!invoices.length ? " Invoice history was not supplied." : ""}${!eventCount ? " Usage records were not supplied; usage is unknown." : ""}` };
}

export async function getCustomersList(options: {
  search?: string;
  status?: string;
  plan?: string;
  paymentStatus?: string;
  churnRisk?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
} = {}): Promise<CustomerListItem[]> {
  const { plan } = options;
  const asOf = await getAsOf();

  const customers = await prisma.customer.findMany({
    include: {
      subscriptions: { where: { startedAt: { lte: asOf } }, include: { plan: true }, orderBy: { startedAt: "desc" } },
      invoices: { where: { invoiceDate: { lte: asOf } }, orderBy: { invoiceDate: "desc" } },
      productEvents: { where: { timestamp: { lte: asOf } }, orderBy: { timestamp: "desc" } },
    },
  });

  const result: CustomerListItem[] = customers.map((customer) => {
    const activeSubscriptions = customer.subscriptions.filter((s) => isActiveAt(s, asOf));
    const currentMrr = activeSubscriptions.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);
    const currentPlan = [...new Set(activeSubscriptions.map((s) => s.plan.name))].join(" + ") || null;

    const payStatus = computePaymentStatus(customer.invoices);
    const churn = computeChurnRisk(
      customer,
      payStatus,
      customer.invoices,
      customer.subscriptions,
      customer.productEvents, asOf
    );

    const lastActivity = customer.productEvents[0]?.timestamp ?? null;

    return {
      id: customer.id,
      name: customer.name,
      domain: customer.domain,
      industry: customer.industry,
      companySize: customer.companySize,
      country: customer.country,
      currentMrr,
      plan: currentPlan,
      status: customer.status,
      paymentStatus: payStatus,
      churnRisk: churn.risk,
      churnRiskReason: churn.reason,
      subscriptionCount: customer.subscriptions.length,
      lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
    };
  });

  let filtered = result;
  if (plan) {
    const matchingIds = new Set(customers.filter((customer) => customer.subscriptions.some(
      (subscription) => isActiveAt(subscription, asOf) && subscription.plan.name === plan
    )).map((customer) => customer.id));
    filtered = filtered.filter((customer) => matchingIds.has(customer.id));
  }
  return filterCustomerList(filtered, options);
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail | null> {
  const asOf = await getAsOf();
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      subscriptions: { where: { startedAt: { lte: asOf } }, include: { plan: true }, orderBy: { startedAt: "asc" } },
      invoices: { where: { invoiceDate: { lte: asOf } }, orderBy: { invoiceDate: "desc" } },
      productEvents: { where: { timestamp: { lte: asOf } }, orderBy: { timestamp: "desc" } },
    },
  });

  if (!customer) return null;

  const activeSubscriptions = customer.subscriptions.filter((s) => isActiveAt(s, asOf));
  const currentMrr = activeSubscriptions.reduce((sum, s) => sum + toNumber(s.currentMrr), 0);
  const currentPlan = [...new Set(activeSubscriptions.map((s) => s.plan.name))].join(" + ") || null;

  const payStatus = computePaymentStatus(customer.invoices);
  const churn = computeChurnRisk(
    customer,
    payStatus,
    customer.invoices,
    customer.subscriptions,
    customer.productEvents, asOf
  );

  // Revenue history: build monthly MRR from subscription timeline
  const revenueHistory = buildCustomerRevenueHistory(customer.subscriptions, asOf);

  const planTimeline = buildPlanTimeline(customer.subscriptions, asOf);

  // Payment summary
  const paidInvoices = customer.invoices.filter((i) => i.status === "paid");
  const failedInvoices = customer.invoices.filter((i) => i.status === "failed");
  const openInvoices = customer.invoices.filter((i) => i.status === "open");

  const paymentSummary: PaymentSummary = {
    totalInvoices: customer.invoices.length,
    paidInvoices: paidInvoices.length,
    failedInvoices: failedInvoices.length,
    openInvoices: openInvoices.length,
    totalBilled: customer.invoices.reduce((sum, i) => sum + toNumber(i.amount), 0),
    totalPaid: paidInvoices.reduce((sum, i) => sum + toNumber(i.amount), 0),
    totalFailed: failedInvoices.reduce((sum, i) => sum + toNumber(i.amount), 0),
    lastPaymentStatus: customer.invoices[0]?.status ?? null,
    firstInvoiceDate: customer.invoices.at(-1)?.invoiceDate.toISOString() ?? null,
    lastInvoiceDate: customer.invoices[0]?.invoiceDate.toISOString() ?? null,
    lastFailedInvoiceDate: failedInvoices[0]?.invoiceDate.toISOString() ?? null,
    lastFailedAt: failedInvoices[0]?.failedAt?.toISOString() ?? null,
  };

  // Usage summary
  const eventBreakdown: Record<string, number> = {};
  for (const event of customer.productEvents) {
    eventBreakdown[event.eventName] = (eventBreakdown[event.eventName] || 0) + 1;
  }

  const usageSummary: UsageSummary = {
    totalEvents: customer.productEvents.length,
    uniqueEvents: Object.keys(eventBreakdown).length,
    eventBreakdown,
    lastEventAt: customer.productEvents[0]?.timestamp.toISOString() ?? null,
  };

  return {
    asOf: asOf.toISOString(),
    id: customer.id,
    name: customer.name,
    domain: customer.domain,
    industry: customer.industry,
    companySize: customer.companySize,
    country: customer.country,
    acquisitionChannel: customer.acquisitionChannel,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    convertedAt: customer.convertedAt?.toISOString() ?? null,
    churnedAt: customer.churnedAt?.toISOString() ?? null,
    currentMrr,
    plan: currentPlan,
    paymentStatus: payStatus,
    churnRisk: churn.risk,
    churnRiskReason: churn.reason,
    revenueHistory,
    planTimeline,
    paymentSummary,
    usageSummary,
  };
}

export async function getCustomerRevenueHistory(customerId: string): Promise<CustomerRevenueLifecycle | null> {
  const asOf = await getAsOf();
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      subscriptions: { where: { startedAt: { lte: asOf } }, include: { plan: true }, orderBy: { startedAt: "asc" } },
    },
  });

  if (!customer) return null;

  const revenueHistory = buildCustomerRevenueHistory(customer.subscriptions, asOf);

  const planTimeline = buildPlanTimeline(customer.subscriptions, asOf);

  const subscriptions = customer.subscriptions.map((sub) => ({
    id: sub.id,
    plan: sub.plan.name,
    startedAt: sub.startedAt.toISOString(),
    endedAt: sub.endedAt?.toISOString() ?? null,
    mrr: toNumber(sub.currentMrr),
    seats: sub.seats,
    status: sub.status,
  }));

  return {
    revenueHistory,
    planTimeline,
    subscriptions,
  };
}

function buildPlanTimeline(
  subscriptions: Prisma.SubscriptionGetPayload<{ include: { plan: true } }>[], asOf: Date
): PlanChange[] {
  const observed = subscriptions.filter((sub) => sub.startedAt <= asOf).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id));
  const timeline: PlanChange[] = [];
  // ponytail: small per-account histories; replace these scans with an event sweep if they grow large.
  for (const sub of observed) {
    const prior = observed.filter((other) => other.startedAt < sub.startedAt);
    const concurrent = prior.some((other) => !other.endedAt || other.endedAt > sub.startedAt);
    const ended = prior.filter((other) => other.endedAt?.getTime() === sub.startedAt.getTime());
    const starts = observed.filter((other) => other.startedAt.getTime() === sub.startedAt.getTime());
    let change: PlanChange["change"] = "started";
    if (prior.length && !concurrent && !ended.length) change = "reactivated";
    else if (!concurrent && ended.length === 1 && starts.length === 1) {
      if (toNumber(sub.currentMrr) > toNumber(ended[0].currentMrr)) change = "upgraded";
      else if (toNumber(sub.currentMrr) < toNumber(ended[0].currentMrr)) change = "downgraded";
    }
    timeline.push({ date: sub.startedAt.toISOString(), plan: sub.plan.name, seats: sub.seats, mrr: toNumber(sub.currentMrr), change });
    if (sub.endedAt && sub.endedAt <= asOf && !observed.some((other) => other.startedAt.getTime() === sub.endedAt!.getTime())) {
      timeline.push({ date: sub.endedAt.toISOString(), plan: sub.plan.name, seats: sub.seats, mrr: 0, change: "cancelled" });
    }
  }
  return timeline.sort((a, b) => a.date.localeCompare(b.date));
}

function buildCustomerRevenueHistory(
  subscriptions: Prisma.SubscriptionGetPayload<{ include: { plan: true } }>[], asOf: Date
): RevenueHistoryPoint[] {
  if (subscriptions.length === 0) return [];

  const earliest = new Date(Math.min(...subscriptions.map((sub) => sub.startedAt.getTime())));
  const history: RevenueHistoryPoint[] = [];
  for (let month = startOfMonth(earliest); month <= asOf; month = addMonths(month, 1)) {
    const cutoff = new Date(Math.min(addMonths(month, 1).getTime() - 1, asOf.getTime()));
    const mrr = subscriptions
      .filter((sub) => sub.startedAt <= cutoff && (!sub.endedAt || sub.endedAt > cutoff))
      .reduce((total, sub) => total + toNumber(sub.currentMrr), 0);
    history.push({ month: monthKey(month), mrr: Math.round(mrr * 100) / 100 });
  }
  return history;
}
