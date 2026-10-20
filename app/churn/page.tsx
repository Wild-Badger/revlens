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
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { MetricCard } from "@portfolio/ui/components/metric-card";
import { Card } from "@portfolio/ui/components/card";
import { formatCurrency } from "@portfolio/ui/lib/utils";

interface ChurnRatePoint {
  month: string;
  logoChurnRate: number;
  revenueChurnRate: number;
  churnedCustomers: number;
  churnedRevenue: number;
  totalCustomers: number;
  totalRevenue: number;
}

interface ChurnBySegment {
  segment: string;
  churnRate: number;
  churnedCount: number;
  totalCount: number;
  revenueLost: number;
}

interface ChurnAnalysis {
  churnOverTime: ChurnRatePoint[];
  churnByPlan: ChurnBySegment[];
  churnByIndustry: ChurnBySegment[];
  churnByChannel: ChurnBySegment[];
  totalRevenueLost: number;
}

function formatMonth(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
}

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

function churnColor(rate: number) {
  if (rate <= 0.02) return "#10b981"; // emerald-500
  if (rate <= 0.05) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

export default function ChurnPage() {
  const [data, setData] = useState<ChurnAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<string>("");
  const [plan, setPlan] = useState<string>("");
  const [catalog, setCatalog] = useState<{ segments: string[]; plans: string[]; asOf: string } | null>(null);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const fetchData = useCallback((signal?: AbortSignal) => {
    const currentRequest = ++requestId.current;
    const params = new URLSearchParams();
    if (segment) params.set("segment", segment);
    if (plan) params.set("plan", plan);

    Promise.all([`/api/analytics/churn?${params}`, "/api/cohorts/logo-retention"].map(async (url) => {
      const response = await apiFetch(url, { signal });
      if (!response.ok) throw new Error("Churn analysis could not load. Check the local server and retry.");
      return response.json();
    }))
      .then(([d, options]) => {
        if (signal?.aborted || currentRequest !== requestId.current) return;
        setData(d);
        setCatalog(options);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (signal?.aborted || currentRequest !== requestId.current) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Churn analysis could not load.");
        setLoading(false);
      });
  }, [segment, plan]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  const beginLoading = () => { requestId.current++; setLoading(true); setError(""); setData(null); };
  const refreshData = () => { beginLoading(); fetchData(); };

  const chartData = data?.churnOverTime.map((point) => ({
    month: formatMonth(point.month),
    logoChurnRate: point.totalCustomers > 0 ? point.logoChurnRate : null,
    revenueChurnRate: point.totalRevenue > 0 ? point.revenueChurnRate : null,
    churnedCustomers: point.churnedCustomers,
    churnedRevenue: point.churnedRevenue,
    totalCustomers: point.totalCustomers,
    totalRevenue: point.totalRevenue,
  })) ?? [];

  const logoMonths = data?.churnOverTime.filter((point) => point.totalCustomers > 0) ?? [];
  const revenueMonths = data?.churnOverTime.filter((point) => point.totalRevenue > 0) ?? [];
  const avgLogoChurn = logoMonths.reduce((sum, point) => sum + point.logoChurnRate, 0) / logoMonths.length;
  const avgRevenueChurn = revenueMonths.reduce((sum, point) => sum + point.revenueChurnRate, 0) / revenueMonths.length;

  const totalChurnedCustomers =
    data?.churnOverTime.reduce((sum, p) => sum + p.churnedCustomers, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Churn Analysis"
        description="Logo and revenue churn over time, segmented by plan, industry, and channel."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Customer industry"
          value={segment}
          onChange={(e) => { beginLoading(); setSegment(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All industries</option>
          {(catalog?.segments ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>

        <select
          aria-label="Subscription plan"
          value={plan}
          onChange={(e) => { beginLoading(); setPlan(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All plans</option>
          {(catalog?.plans ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>

        <button
          onClick={refreshData}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Refresh
        </button>
        {(segment || plan) && <button onClick={() => { beginLoading(); setSegment(""); setPlan(""); }} className="px-3 py-2 text-sm underline">Clear filters</button>}
      </div>

      <p className="text-sm text-neutral-300">Scope: {segment || "all industries"} · {plan || "all plans"}{catalog && ` · Supplied subscription intervals through ${catalog.asOf.slice(0, 10)} UTC · USD`}. These filters apply to every chart. Monthly rates use accounts and recurring revenue present at the prior month end; monthly averages exclude periods without an opening base. Grouped bars show accounts with a recorded churn event as a share of all recorded accounts in that group, across the supplied history. MRR lost is recurring revenue, not cash.</p>
      {error ? <p role="alert" className="rounded-lg border border-rose-900 p-4 text-sm text-rose-200">{error} These are unavailable results, not zero churn. <button onClick={refreshData} className="ml-2 underline">Retry</button></p> : <>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Avg monthly customer churn"
          value={loading ? "—" : logoMonths.length ? percentFormatter.format(avgLogoChurn) : "No opening base"}
        />
        <MetricCard
          label="Avg monthly MRR churn"
          value={loading ? "—" : revenueMonths.length ? percentFormatter.format(avgRevenueChurn) : "No opening base"}
        />
        <MetricCard
          label="Monthly churn events"
          value={loading || !data?.churnOverTime.length ? "—" : String(totalChurnedCustomers)}
        />
        <MetricCard
          label="MRR lost to churn"
          value={loading || !data?.churnOverTime.length ? "—" : formatCurrency(data.totalRevenueLost)}
        />
      </div>

      {/* Churn over time chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">
          Churn Rate Over Time
        </h2>
        {loading ? (
          <div className="mt-4 h-72 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : chartData.length === 0 ? (
          <div className="mt-4 h-72 flex items-center justify-center text-sm text-neutral-500">
            No churn data available.
          </div>
        ) : (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" stroke="#71717a" fontSize={12} />
                <YAxis
                  tickFormatter={(v) => percentFormatter.format(v)}
                  stroke="#71717a"
                  fontSize={12}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                  formatter={(value: number, name: string) => [
                    percentFormatter.format(value),
                    name,
                  ]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="logoChurnRate"
                  name="Logo Churn"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#f43f5e" }}
                />
                <Line
                  type="monotone"
                  dataKey="revenueChurnRate"
                  name="Revenue Churn"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#f59e0b" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Revenue lost to churn chart */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">
          Revenue Lost to Churn
        </h2>
        {loading ? (
          <div className="mt-4 h-72 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : chartData.length === 0 ? (
          <div className="mt-4 h-72 flex items-center justify-center text-sm text-neutral-500">
            No data available.
          </div>
        ) : (
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="month" stroke="#71717a" fontSize={12} />
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
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Bar dataKey="churnedRevenue" name="Revenue Lost" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Churn by Plan */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">Churn by Plan</h2>
        {loading ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : !data || data.churnByPlan.length === 0 ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            No plan churn data available.
          </div>
        ) : (
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.churnByPlan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="segment" stroke="#71717a" fontSize={12} />
                <YAxis
                  tickFormatter={(v) => percentFormatter.format(v)}
                  stroke="#71717a"
                  fontSize={12}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                  formatter={(value: number) => [percentFormatter.format(value), "Churn Rate"]}
                />
                <Bar dataKey="churnRate" name="Churn Rate" radius={[4, 4, 0, 0]}>
                  {data.churnByPlan.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={churnColor(entry.churnRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Churn by Industry */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">Churn by Industry</h2>
        {loading ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : !data || data.churnByIndustry.length === 0 ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            No industry churn data available.
          </div>
        ) : (
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.churnByIndustry} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => percentFormatter.format(v)}
                  stroke="#71717a"
                  fontSize={12}
                  domain={[0, "auto"]}
                />
                <YAxis
                  type="category"
                  dataKey="segment"
                  stroke="#71717a"
                  fontSize={12}
                  width={120}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                  formatter={(value: number) => [percentFormatter.format(value), "Churn Rate"]}
                />
                <Bar dataKey="churnRate" name="Churn Rate" radius={[0, 4, 4, 0]} barSize={24}>
                  {data.churnByIndustry.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={churnColor(entry.churnRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Churn by Acquisition Channel */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-50">
          Churn by Acquisition Channel
        </h2>
        {loading ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            Loading...
          </div>
        ) : !data || data.churnByChannel.length === 0 ? (
          <div className="mt-4 h-64 flex items-center justify-center text-sm text-neutral-500">
            No channel churn data available.
          </div>
        ) : (
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.churnByChannel} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => percentFormatter.format(v)}
                  stroke="#71717a"
                  fontSize={12}
                  domain={[0, "auto"]}
                />
                <YAxis
                  type="category"
                  dataKey="segment"
                  stroke="#71717a"
                  fontSize={12}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "0.5rem",
                    color: "#fafafa",
                  }}
                  formatter={(value: number) => [percentFormatter.format(value), "Churn Rate"]}
                />
                <Bar dataKey="churnRate" name="Churn Rate" radius={[0, 4, 4, 0]} barSize={24}>
                  {data.churnByChannel.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={churnColor(entry.churnRate)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      </>}
    </>
  );
}
