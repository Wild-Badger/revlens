import type { RevenueMovement } from "../lib/revenue";

/** Sum production-calculated daily rows without classifying revenue a second time. */
export function movementsInRange(daily: { date: string; movements: RevenueMovement[] }[], from: string | null, to: string | null) {
  const months = new Map<string, RevenueMovement>();
  for (const day of daily) {
    if ((from && day.date < from) || (to && day.date > to)) continue;
    for (const row of day.movements) {
      const existing = months.get(row.month);
      if (!existing) months.set(row.month, { ...row });
      else for (const key of ["new_mrr", "expansion_mrr", "contraction_mrr", "churned_mrr", "reactivation_mrr", "stable_mrr"] as const) existing[key] = Math.round((existing[key] + row[key]) * 100) / 100;
    }
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
