"use client";

import { apiFetch } from "@/lib/api-fetch";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card } from "@portfolio/ui/components/card";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { formatCurrency } from "@portfolio/ui/lib/utils";

type MovementApiRow = {
  month: string;
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  reactivation_mrr: number;
  stable_mrr: number;
};

type MovementRow = {
  month: string;
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  reactivationMrr: number;
  stableMrr: number;
};

type MovementFilters = {
  from: string;
  to: string;
  segment: string;
  plan: string;
};

const DEFAULT_FILTERS: MovementFilters = {
  from: "",
  to: "",
  segment: "",
  plan: "",
};

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

function toMovementRow(row: MovementApiRow): MovementRow {
  return {
    month: row.month,
    newMrr: row.new_mrr,
    expansionMrr: row.expansion_mrr,
    contractionMrr: row.contraction_mrr,
    churnedMrr: row.churned_mrr,
    reactivationMrr: row.reactivation_mrr,
    stableMrr: row.stable_mrr,
  };
}

function formatMonth(value: string) {
  const date = new Date(value);

  return date.toLocaleDateString("en-US", { timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
}

function formatLongMonth(value: string) {
  const date = new Date(value);

  return date.toLocaleDateString("en-US", { timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

function movementTotal(row: MovementRow) {
  return (
    row.newMrr +
    row.expansionMrr +
    row.reactivationMrr -
    row.contractionMrr -
    row.churnedMrr
  );
}

function buildMovementUrl(filters: MovementFilters) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  const query = params.toString();
  return query ? `/api/revenue/movements?${query}` : "/api/revenue/movements";
}

export default function MovementsPage() {
  const [filters, setFilters] = useState<MovementFilters>(DEFAULT_FILTERS);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{ segments: string[]; plans: string[]; asOf: string } | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // Reuse Retention's stable industry/plan catalog from the same dataset.
    apiFetch("/api/cohorts/logo-retention", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { setCatalog(data); setCatalogError(false); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true); });
    return () => controller.abort();
  }, [retry]);

  const movementUrl = useMemo(() => buildMovementUrl(filters), [filters]);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch(movementUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Revenue movements could not be loaded.");
        }
        return response.json() as Promise<{ movements: MovementApiRow[] }>;
      })
      .then((data) => setMovements(data.movements.map(toMovementRow)))
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }

        setMovements([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Revenue movements could not be loaded."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [movementUrl, retry]);

  function updateFilter(key: keyof MovementFilters, value: string) {
    setIsLoading(true);
    setError(null);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <PageHeader
        title="Revenue Movements"
        description="Analyze how new, expansion, contraction, churn, and reactivation revenue change MRR."
      />

      <Card className="p-5">
        <p className="mb-4 text-sm text-neutral-400">{catalog ? `USD · supplied subscription intervals through ${catalog.asOf.slice(0, 10)} UTC. Losses are negative; months without changes are omitted.` : "Loading dataset scope…"}</p>
        {catalogError && <p role="alert" className="mb-4 text-sm text-amber-200">Filter options could not be loaded. <button onClick={() => setRetry((value) => value + 1)} className="underline">Retry options</button></p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-2 text-sm font-medium text-neutral-300">
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter("from", event.target.value)}
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-400"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-neutral-300">
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter("to", event.target.value)}
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-400"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-neutral-300">
            <span>Industry</span>
            <select
              value={filters.segment}
              onChange={(event) => updateFilter("segment", event.target.value)}
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-400"
            >
              <option value="">All industries</option>
              {(catalog?.segments ?? []).map((segment) => (
                <option key={segment} value={segment}>
                  {segment}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-neutral-300">
            <span>Plan</span>
            <select
              value={filters.plan}
              onChange={(event) => updateFilter("plan", event.target.value)}
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none transition-colors focus:border-emerald-400"
            >
              <option value="">All plans</option>
              {(catalog?.plans ?? []).map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => { setIsLoading(true); setError(null); setFilters(DEFAULT_FILTERS); setRetry((value) => value + 1); }}
              className="h-10 w-full rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 hover:bg-neutral-900"
            >
              Reset
            </button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-neutral-50">
            Revenue Movement Breakdown
          </h2>
          <p className="text-sm text-neutral-400">
            {isLoading ? "Loading" : `${movements.length} months`}
          </p>
        </div>

        {error ? (
          <p role="alert" className="mt-6 rounded-md border border-rose-900/70 bg-rose-950/40 p-4 text-sm text-rose-200">
            {error}
            <button onClick={() => { setIsLoading(true); setError(null); setRetry((value) => value + 1); }} className="ml-3 underline">Retry</button>
          </p>
        ) : isLoading ? <p className="py-8 text-neutral-400" role="status">Loading movements…</p> : (
          <div className="mt-5 h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={movements.map((point) => ({ ...point, contractionMrr: -point.contractionMrr, churnedMrr: -point.churnedMrr }))} stackOffset="sign">
                <ReferenceLine y={0} stroke="#a3a3a3" />
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonth}
                  stroke="#71717a"
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={(value) => compactCurrencyFormatter.format(value)}
                  stroke="#71717a"
                  fontSize={12}
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={formatLongMonth}
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                />
                <Legend />
                <Bar dataKey="newMrr" name="New" fill="#10b981" stackId="a" />
                <Bar
                  dataKey="expansionMrr"
                  name="Expansion"
                  fill="#3b82f6"
                  stackId="a"
                />
                <Bar
                  dataKey="contractionMrr"
                  name="Contraction"
                  fill="#f59e0b"
                  stackId="a"
                />
                <Bar
                  dataKey="churnedMrr"
                  name="Churn"
                  fill="#f43f5e"
                  stackId="a"
                />
                <Bar
                  dataKey="reactivationMrr"
                  name="Reactivation"
                  fill="#8b5cf6"
                  stackId="a"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-neutral-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-50">
            Monthly Movement Data
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-800 text-sm">
            <thead className="bg-neutral-950/60 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Month</th>
                <th className="px-6 py-3 font-semibold">New</th>
                <th className="px-6 py-3 font-semibold">Expansion</th>
                <th className="px-6 py-3 font-semibold">Contraction</th>
                <th className="px-6 py-3 font-semibold">Churn</th>
                <th className="px-6 py-3 font-semibold">Reactivation</th>
                <th className="px-6 py-3 font-semibold">Net Movement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {!error && !isLoading && movements.map((movement) => (
                <tr key={movement.month} className="text-neutral-300">
                  <td className="whitespace-nowrap px-6 py-4 font-medium text-neutral-100">
                    {formatLongMonth(movement.month)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {formatCurrency(movement.newMrr)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {formatCurrency(movement.expansionMrr)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {formatCurrency(movement.contractionMrr ? -movement.contractionMrr : 0)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {formatCurrency(movement.churnedMrr ? -movement.churnedMrr : 0)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {formatCurrency(movement.reactivationMrr)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 font-medium text-neutral-100">
                    {formatCurrency(movementTotal(movement))}
                  </td>
                </tr>
              ))}
              {!error && !isLoading && movements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-neutral-400">
                    No movement data matches the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
