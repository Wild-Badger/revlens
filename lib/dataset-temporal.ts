export function coverageError(asOf: string, start?: string | null, complete?: boolean) {
  if (complete && !start) return "Complete history needs a coverage start month";
  if (start && (!/^\d{4}-\d{2}-01(?:T00:00:00\.000Z)?$/.test(start) || start.slice(0, 10) > asOf.slice(0, 10))) return "Coverage must start on the first day of a month, no later than asOf";
}

export function factDateError(date: string | null | undefined, asOf: string, earliest?: string) {
  if (date && date > asOf) return "Fact date cannot be after dataset asOf";
  if (date && earliest && date < earliest) return "Fact date precedes its related creation/start date";
}

export function invalidIntervals<T extends { customerId: string; startedAt: string; endedAt: string | null }>(intervals: T[]): T[] {
  const groups = new Map<string, T[]>(), invalid: T[] = [];
  for (const interval of intervals) { const rows = groups.get(interval.customerId) ?? []; rows.push(interval); groups.set(interval.customerId, rows); }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    let end: string | null | undefined;
    for (const row of rows) {
      if ((row.endedAt !== null && row.endedAt <= row.startedAt) || end === null || (end !== undefined && row.startedAt < end)) invalid.push(row);
      end = end === null || row.endedAt === null ? null : end && end > row.endedAt ? end : row.endedAt;
    }
  }
  return invalid;
}
