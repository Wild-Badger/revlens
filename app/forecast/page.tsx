"use client";

import { apiFetch } from "@/lib/api-fetch";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { MetricCard } from "@portfolio/ui/components/metric-card";
import { Card } from "@portfolio/ui/components/card";
import { downloadFile } from "@/lib/export";
import { formatCurrency, formatPercent } from "@portfolio/ui/lib/utils";

interface ScenarioPoint {
  month: string;
  mrr: number;
}

interface ForecastAssumptions {
  newMrrGrowth: number;
  churnRate: number;
  expansionRate: number;
}

interface ForecastData {
  asOf: string;
  conservative: ScenarioPoint[];
  baseline: ScenarioPoint[];
  optimistic: ScenarioPoint[];
  assumptions: ForecastAssumptions;
  historicalMrr: { month: string; mrr: number }[];
}

function formatMonth(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
}

function formatMonthShort(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
}

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

function buildChartData(data: ForecastData) {
  const months = new Set<string>();
  data.historicalMrr.forEach((h) => months.add(h.month));
  data.baseline.forEach((b) => months.add(b.month));

  const sortedMonths = Array.from(months).sort();

  return sortedMonths.map((month) => {
    const historical = data.historicalMrr.find((h) => h.month === month);
    const conservative = data.conservative.find((c) => c.month === month);
    const baseline = data.baseline.find((b) => b.month === month);
    const optimistic = data.optimistic.find((o) => o.month === month);

    return {
      month: formatMonth(month),
      shortMonth: formatMonthShort(month),
      actualMrr: historical?.mrr ?? null,
      conservative: conservative?.mrr ?? null,
      baseline: baseline?.mrr ?? null,
      optimistic: optimistic?.mrr ?? null,
      isForecast: !historical,
    };
  });
}

export default function ForecastPage() {
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const [assumptions, setAssumptions] = useState<ForecastAssumptions>({
    newMrrGrowth: 0.05,
    churnRate: 0.02,
    expansionRate: 0.02,
  });

  const fetchData = useCallback(() => {
    const currentRequest = ++requestId.current;
    const params = new URLSearchParams();
    params.set("newMrrGrowth", String(assumptions.newMrrGrowth));
    params.set("churnRate", String(assumptions.churnRate));
    params.set("expansionRate", String(assumptions.expansionRate));

    apiFetch(`/api/forecast/revenue?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error("Scenario data could not load. Check your local server and retry."); return r.json(); })
      .then((d: ForecastData) => {
        if (currentRequest !== requestId.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (currentRequest !== requestId.current) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Scenario data could not load.");
        setLoading(false);
      });
  }, [assumptions]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const beginLoading = () => { requestId.current++; setLoading(true); setError(""); };
  const refreshData = () => { beginLoading(); fetchData(); };

  const chartData = data ? buildChartData(data) : [];

  const lastBaseline = data?.baseline[data.baseline.length - 1];
  const lastConservative = data?.conservative[data.conservative.length - 1];
  const lastOptimistic = data?.optimistic[data.optimistic.length - 1];

  return (
    <>
      <PageHeader
        title="Revenue Forecast"
        description="Explore 12 months of recurring revenue under assumptions you choose."
      ><button disabled={!data || loading || !!error} onClick={() => data && downloadFile(`revlens-scenario-${data.asOf.slice(0, 10)}.json`, JSON.stringify({ format: "revlens-scenario", version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2), "application/json")} className="rounded-md border border-neutral-700 px-3 py-2 text-sm disabled:opacity-40">Export scenario JSON</button></PageHeader>

      {error && <p role="alert" className="text-sm text-rose-200">{error} <button onClick={refreshData} className="ml-2 underline">Retry</button></p>}

      {/* Controls */}
      <Card className="p-6">
        <p className="mb-4 text-sm leading-6 text-neutral-300">Starting inputs are editable examples, not rates fitted to your data. Each rate applies to the previous month’s MRR. {data?.asOf && `History uses supplied intervals through ${data.asOf.slice(0, 10)} UTC.`}</p>
        <h3 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide mb-4">
          Assumptions
        </h3>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div>
            <label
              htmlFor="new-mrr-growth"
              className="block text-sm font-medium text-neutral-300"
            >
              Monthly New-MRR Growth
            </label>
            <input
              id="new-mrr-growth"
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={assumptions.newMrrGrowth}
              onChange={(e) => {
                beginLoading();
                setAssumptions((prev) => ({
                  ...prev,
                  newMrrGrowth: Number(e.target.value),
                }));
              }}
              className="mt-2 w-full accent-emerald-500"
            />
            <div className="mt-1 text-sm text-neutral-400">
              {formatPercent(assumptions.newMrrGrowth, { maximumFractionDigits: 1 })}
            </div>
          </div>

          <div>
            <label
              htmlFor="churn-rate"
              className="block text-sm font-medium text-neutral-300"
            >
              Monthly Churn Rate
            </label>
            <input
              id="churn-rate"
              type="range"
              min={0}
              max={0.25}
              step={0.001}
              value={assumptions.churnRate}
              onChange={(e) => {
                beginLoading();
                setAssumptions((prev) => ({
                  ...prev,
                  churnRate: Number(e.target.value),
                }));
              }}
              className="mt-2 w-full accent-rose-500"
            />
            <div className="mt-1 text-sm text-neutral-400">
              {formatPercent(assumptions.churnRate, { maximumFractionDigits: 1 })}
            </div>
          </div>

          <div>
            <label
              htmlFor="expansion-rate"
              className="block text-sm font-medium text-neutral-300"
            >
              Monthly Expansion Rate
            </label>
            <input
              id="expansion-rate"
              type="range"
              min={0}
              max={0.5}
              step={0.005}
              value={assumptions.expansionRate}
              onChange={(e) => {
                beginLoading();
                setAssumptions((prev) => ({
                  ...prev,
                  expansionRate: Number(e.target.value),
                }));
              }}
              className="mt-2 w-full accent-sky-500"
            />
            <div className="mt-1 text-sm text-neutral-400">
              {formatPercent(assumptions.expansionRate, { maximumFractionDigits: 1 })}
            </div>
          </div>
        </div>

        {data && (
          <div className="mt-4 text-xs text-neutral-500">
            Scenario inputs (adjustable, not a statistical prediction): New-MRR{" "}
            {formatPercent(data.assumptions.newMrrGrowth, { maximumFractionDigits: 1 })},
            Churn {formatPercent(data.assumptions.churnRate, { maximumFractionDigits: 1 })},
            Expansion {formatPercent(data.assumptions.expansionRate, { maximumFractionDigits: 1 })}.
          </div>
        )}
      </Card>

      {/* Scenario summary cards */}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:p-4">
          <MetricCard
            label="Conservative ARR (12mo)"
            value={
              lastConservative
                ? formatCurrency(lastConservative.mrr * 12)
                : "-"
            }
            change="Lower growth, higher churn"
            changeType="neutral"
          />
          <MetricCard
            label="Baseline ARR (12mo)"
            value={
              lastBaseline ? formatCurrency(lastBaseline.mrr * 12) : "-"
            }
            change="Your assumptions"
            changeType="neutral"
          />
          <MetricCard
            label="Optimistic ARR (12mo)"
            value={
              lastOptimistic
                ? formatCurrency(lastOptimistic.mrr * 12)
                : "-"
            }
            change="Higher growth, lower churn"
            changeType="neutral"
          />
        </div>
      )}

      {/* Forecast chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">
          MRR Forecast (12-Month Projection)
        </h2>
        {loading ? (
          <div className="mt-4 h-72 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" stroke="#71717a" fontSize={11} minTickGap={24} />
                <YAxis
                  tickFormatter={(v) => compactCurrencyFormatter.format(v)}
                  stroke="#71717a"
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                  labelFormatter={(label) => {
                    const point = chartData.find((d) => d.month === label);
                    return point?.month ?? label;
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="actualMrr"
                  name="Actual MRR"
                  stroke="#38bdf8"
                  strokeWidth={3}
                  dot={{ r: 3, fill: "#38bdf8" }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="conservative"
                  name="Conservative"
                  stroke="#f87171"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: "#f87171" }}
                />
                <Line
                  type="monotone"
                  dataKey="baseline"
                  name="Baseline"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: "#a78bfa" }}
                />
                <Line
                  type="monotone"
                  dataKey="optimistic"
                  name="Optimistic"
                  stroke="#34d399"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, fill: "#34d399" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </>
  );
}
