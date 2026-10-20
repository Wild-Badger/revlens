import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAsOf, getDatasetContext, isActiveAt as isActiveOn } from "@/lib/dataset";

export type RevenueMovement = {
  month: string;
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  reactivation_mrr: number;
  stable_mrr: number;
};

export type MrrHistoryPoint = {
  month: string;
  mrr: number;
};

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: { customer: true; plan: true };
}>;

type MovementFilters = {
  from?: Date;
  to?: Date;
  segment?: string;
  plan?: string;
};

type CustomerState = {
  priorMrr: number;
  hasPriorRevenue: boolean;
};

const MONEY_PRECISION = 2;
const RATE_PRECISION = 4;

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function round(value: number, precision = MONEY_PRECISION) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function matchesSegment(subscription: SubscriptionWithRelations, segment?: string) {
  if (!segment) return true;
  const normalized = segment.toLowerCase();
  return subscription.customer.industry.toLowerCase() === normalized;
}

function ensureMovement(map: Map<string, RevenueMovement>, month: string) {
  const existing = map.get(month);
  if (existing) return existing;

  const movement = {
    month,
    new_mrr: 0,
    expansion_mrr: 0,
    contraction_mrr: 0,
    churned_mrr: 0,
    reactivation_mrr: 0,
    stable_mrr: 0,
  };
  map.set(month, movement);
  return movement;
}

async function loadSubscriptions(filters: MovementFilters = {}) {
  return prisma.subscription.findMany({
    where: {
      ...(filters.plan ? { plan: { name: { equals: filters.plan, mode: "insensitive" } } } : {}),
    },
    orderBy: [{ customerId: "asc" }, { startedAt: "asc" }, { endedAt: "asc" }],
    include: { customer: true, plan: true },
  });
}

export async function getRevenueMovements(filters: MovementFilters = {}) {
  const asOf = await getAsOf();
  const cutoff = filters.to && filters.to < asOf ? filters.to : asOf;
  const subscriptions = (await loadSubscriptions(filters)).filter((subscription) =>
    matchesSegment(subscription, filters.segment)
  );

  const events = subscriptions.flatMap((subscription) => [
    {
      customerId: subscription.customerId,
      date: subscription.startedAt,
      delta: toNumber(subscription.currentMrr),
    },
    ...(subscription.endedAt
      ? [
          {
            customerId: subscription.customerId,
            date: subscription.endedAt,
            delta: -toNumber(subscription.currentMrr),
          },
        ]
      : []),
  ]);

  events.sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    return byDate === 0 ? a.customerId.localeCompare(b.customerId) : byDate;
  });

  // Apply simultaneous starts/ends together so replacements preserve their net change.
  const mergedEvents: typeof events = [];
  for (const event of events) {
    const last = mergedEvents[mergedEvents.length - 1];
    if (last && last.customerId === event.customerId && last.date.getTime() === event.date.getTime()) {
      last.delta += event.delta;
    } else {
      mergedEvents.push(event);
    }
  }

  const customerStates = new Map<string, CustomerState>();
  const movements = new Map<string, RevenueMovement>();

  for (const event of mergedEvents) {
    if (filters.from && event.date < filters.from) {
      const state = customerStates.get(event.customerId) ?? {
        priorMrr: 0,
        hasPriorRevenue: false,
      };
      state.priorMrr = round(state.priorMrr + event.delta);
      state.hasPriorRevenue ||= state.priorMrr > 0;
      customerStates.set(event.customerId, state);
      continue;
    }
    if (event.date > cutoff) continue;

    const state = customerStates.get(event.customerId) ?? {
      priorMrr: 0,
      hasPriorRevenue: false,
    };
    const priorMrr = state.priorMrr;
    const currentMrr = round(priorMrr + event.delta);
    const movement = ensureMovement(movements, monthKey(event.date));

    if (priorMrr === 0 && currentMrr > 0) {
      if (state.hasPriorRevenue) {
        movement.reactivation_mrr += currentMrr;
      } else {
        movement.new_mrr += currentMrr;
      }
    } else if (priorMrr > 0 && currentMrr === 0) {
      movement.churned_mrr += priorMrr;
    } else if (currentMrr > priorMrr) {
      movement.expansion_mrr += currentMrr - priorMrr;
      movement.stable_mrr += priorMrr;
    } else if (currentMrr < priorMrr) {
      movement.contraction_mrr += priorMrr - currentMrr;
      movement.stable_mrr += currentMrr;
    } else {
      movement.stable_mrr += currentMrr;
    }

    state.hasPriorRevenue ||= priorMrr > 0 || currentMrr > 0;
    state.priorMrr = currentMrr;
    customerStates.set(event.customerId, state);
  }

  return Array.from(movements.values())
    .map((movement) => ({
      month: movement.month,
      new_mrr: round(movement.new_mrr),
      expansion_mrr: round(movement.expansion_mrr),
      contraction_mrr: round(movement.contraction_mrr),
      churned_mrr: round(movement.churned_mrr),
      reactivation_mrr: round(movement.reactivation_mrr),
      stable_mrr: round(movement.stable_mrr),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function getRevenueSummary() {
  const subscriptions = await loadSubscriptions();
  const context = await getDatasetContext();
  const asOf = context.asOf;
  const activeSubscriptions = subscriptions.filter((subscription) =>
    isActiveOn(subscription, asOf)
  );
  const currentMrr = activeSubscriptions.reduce(
    (sum, subscription) => sum + toNumber(subscription.currentMrr),
    0
  );
  const currentArr = currentMrr * 12;

  const currentMonth = startOfMonth(asOf);
  const historyStartMonth = addMonths(currentMonth, -11);
  const openingCutoff = new Date(currentMonth.getTime() - 1);
  const openingRevenue = new Map<string, number>();
  const currentRevenue = new Map<string, number>();
  for (const subscription of subscriptions) {
    if (isActiveOn(subscription, openingCutoff)) {
      openingRevenue.set(subscription.customerId, (openingRevenue.get(subscription.customerId) ?? 0) + toNumber(subscription.currentMrr));
    }
  }
  for (const subscription of activeSubscriptions) {
    currentRevenue.set(subscription.customerId, (currentRevenue.get(subscription.customerId) ?? 0) + toNumber(subscription.currentMrr));
  }
  const previousMrr = [...openingRevenue.values()].reduce((total, mrr) => total + mrr, 0);
  let retainedRevenue = 0;
  let grossRetainedRevenue = 0;
  let churnedMrr = 0;
  let churnedCustomerCount = 0;
  for (const [customerId, openingMrr] of openingRevenue) {
    const currentMrr = currentRevenue.get(customerId) ?? 0;
    retainedRevenue += currentMrr;
    grossRetainedRevenue += Math.min(openingMrr, currentMrr);
    if (currentMrr === 0) { churnedMrr += openingMrr; churnedCustomerCount++; }
  }
  const customerCount = new Set(activeSubscriptions.map((subscription) => subscription.customerId)).size;
  const arpa = customerCount > 0 ? currentMrr / customerCount : 0;
  const logoChurnRate =
    openingRevenue.size > 0 ? round(churnedCustomerCount / openingRevenue.size, RATE_PRECISION) : 0;
  const mrrHistory: MrrHistoryPoint[] = Array.from({ length: 12 }, (_, index) => {
    const month = addMonths(historyStartMonth, index);
    const monthEnd = month.getTime() === currentMonth.getTime() ? asOf : new Date(addMonths(month, 1).getTime() - 1);
    const mrr = subscriptions
      .filter((subscription) => isActiveOn(subscription, monthEnd))
      .reduce((sum, subscription) => sum + toNumber(subscription.currentMrr), 0);

    return {
      month: monthKey(month),
      mrr: round(mrr),
    };
  });

  return {
    as_of: asOf.toISOString(),
    dataset_kind: context.kind,
    current_mrr: round(currentMrr),
    opening_mrr: round(previousMrr),
    period_start: currentMonth.toISOString(),
    current_arr: round(currentArr),
    customer_count: customerCount,
    mrr_growth_rate: previousMrr > 0 ? round((currentMrr - previousMrr) / previousMrr, RATE_PRECISION) : 0,
    nrr:
      previousMrr > 0
        ? round(retainedRevenue / previousMrr, RATE_PRECISION)
        : 0,
    grr: previousMrr > 0 ? round(grossRetainedRevenue / previousMrr, RATE_PRECISION) : 0,
    logo_churn_rate: logoChurnRate,
    revenue_churn_rate: previousMrr > 0 ? round(churnedMrr / previousMrr, RATE_PRECISION) : 0,
    arpa: round(arpa),
    ltv: logoChurnRate > 0 ? round(arpa / logoChurnRate) : null,
    mrr_history: mrrHistory,
  };
}
