export type ForecastAssumptions = {
  newMrrGrowth: number;
  churnRate: number;
  expansionRate: number;
};

export type ScenarioPoint = { month: string; mrr: number };
export type ForecastScenarios = {
  asOf: string;
  conservative: ScenarioPoint[];
  baseline: ScenarioPoint[];
  optimistic: ScenarioPoint[];
  assumptions: ForecastAssumptions;
  historicalMrr: ScenarioPoint[];
};

function projectScenario(startMrr: number, startMonth: Date, assumptions: ForecastAssumptions): ScenarioPoint[] {
  const result: ScenarioPoint[] = [];
  let currentMrr = startMrr;
  for (let i = 1; i <= 12; i++) {
    const newMrr = currentMrr * assumptions.newMrrGrowth;
    const churnedMrr = currentMrr * assumptions.churnRate;
    const expansionMrr = currentMrr * assumptions.expansionRate;
    currentMrr = Math.max(0, currentMrr + newMrr + expansionMrr - churnedMrr);
    const month = new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1));
    result.push({ month: month.toISOString().slice(0, 10), mrr: Math.round(currentMrr * 100) / 100 });
  }
  return result;
}

/** One projection shared by the local API and its read-only fictional demo. */
export function buildForecastScenarios(historicalMrr: ScenarioPoint[], asOf: string, overrides?: Partial<ForecastAssumptions>): ForecastScenarios {
  // ponytail: editable example rates; fitting them requires observed billing history.
  const assumptions = {
    newMrrGrowth: overrides?.newMrrGrowth ?? 0.05,
    churnRate: overrides?.churnRate ?? 0.02,
    expansionRate: overrides?.expansionRate ?? 0.02,
  };
  const latest = historicalMrr.at(-1);
  const lastMrr = latest?.mrr ?? 0;
  const lastMonth = new Date(latest ? `${latest.month}T00:00:00.000Z` : asOf);
  return {
    asOf, assumptions, historicalMrr,
    baseline: projectScenario(lastMrr, lastMonth, assumptions),
    conservative: projectScenario(lastMrr, lastMonth, {
      newMrrGrowth: assumptions.newMrrGrowth * 0.75,
      churnRate: Math.min(assumptions.churnRate * 1.3, 0.99),
      expansionRate: assumptions.expansionRate * 0.8,
    }),
    optimistic: projectScenario(lastMrr, lastMonth, {
      newMrrGrowth: assumptions.newMrrGrowth * 1.25,
      churnRate: assumptions.churnRate * 0.7,
      expansionRate: assumptions.expansionRate * 1.2,
    }),
  };
}
