import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getAsOf, isActiveAt as isActiveOn } from "@/lib/dataset";

export type { ForecastAssumptions, ScenarioPoint, ForecastScenarios } from "@/lib/forecast-scenario";
import { buildForecastScenarios, type ForecastAssumptions, type ForecastScenarios } from "@/lib/forecast-scenario";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONEY_PRECISION = 2;

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

// ---------------------------------------------------------------------------
// Historical data
// ---------------------------------------------------------------------------

async function loadHistoricalMrr(months = 6): Promise<{ month: string; mrr: number }[]> {
  const subscriptions = await prisma.subscription.findMany({
    include: { customer: true, plan: true },
  });

  const allDates = subscriptions.flatMap((s) => [s.startedAt, s.endedAt].filter(Boolean) as Date[]);
  if (allDates.length === 0) {
    return [];
  }

  const asOf = await getAsOf();
  const latestDate = startOfMonth(asOf);
  const historyStart = addMonths(latestDate, -(months - 1));

  const result: { month: string; mrr: number }[] = [];
  let current = historyStart;

  while (current <= latestDate) {
    const monthEnd = new Date(Math.min(addMonths(current, 1).getTime() - 1, asOf.getTime()));
    const mrr = subscriptions
      .filter((s) => isActiveOn(s, monthEnd))
      .reduce((sum, s) => sum + toNumber(s.currentMrr), 0);

    result.push({
      month: monthKey(current),
      mrr: round(mrr),
    });

    current = addMonths(current, 1);
  }

  return result;
}

export async function getForecastScenarios(overrides?: Partial<ForecastAssumptions>): Promise<ForecastScenarios> {
  return buildForecastScenarios(await loadHistoricalMrr(6), (await getAsOf()).toISOString(), overrides);
}