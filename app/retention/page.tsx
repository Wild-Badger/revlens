"use client";

import { apiFetch } from "@/lib/api-fetch";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { cn } from "@portfolio/ui/lib/utils";

interface CohortRow {
  cohort: string;
  cohortSize: number;
  retention: number[];
}

interface CohortData {
  asOf: string;
  rows: CohortRow[];
  maxMonths: number;
  segments: string[];
  plans: string[];
}

interface PlanRetention {
  plan: string;
  retentionRate: number;
  sampleSize: number;
}

interface SegmentRetention {
  segment: string;
  retentionRate: number;
  sampleSize: number;
}

function formatMonth(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });
}

function retentionColor(value: number) {
  if (value > 1) return "bg-emerald-200 text-emerald-950";
  if (value >= 0.9) return "bg-emerald-800 text-emerald-50";
  if (value >= 0.7) return "bg-emerald-950 text-emerald-100";
  return "bg-neutral-800 text-neutral-100";
}

function retentionBarColor(value: number) {
  if (value >= 0.9) return "#059669"; // emerald-600
  if (value >= 0.7) return "#10b981"; // emerald-500
  if (value >= 0.5) return "#f59e0b"; // amber-500
  if (value >= 0.3) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}

export default function RetentionPage() {
  const [logoData, setLogoData] = useState<CohortData | null>(null);
  const [revenueData, setRevenueData] = useState<CohortData | null>(null);
  const [planData, setPlanData] = useState<PlanRetention[]>([]);
  const [segmentData, setSegmentData] = useState<SegmentRetention[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<string>("");
  const [plan, setPlan] = useState<string>("");
  const [availableSegments, setAvailableSegments] = useState<string[]>([]);
  const [availablePlans, setAvailablePlans] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [showCohorts, setShowCohorts] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const update = () => setShowCohorts(desktop.matches);
    update();
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, []);

  const fetchData = useCallback(() => {
    const currentRequest = ++requestId.current;
    const params = new URLSearchParams();
    if (segment) params.set("segment", segment);
    if (plan) params.set("plan", plan);

    Promise.all([
      `/api/cohorts/logo-retention?${params}`,
      `/api/cohorts/revenue-retention?${params}`,
      "/api/cohorts/plan-retention",
      "/api/cohorts/segment-retention",
    ].map(async (url) => {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("Retention could not load. Check the local server and retry.");
      return response.json();
    }))
      .then(([logo, revenue, plans, segments]) => {
        if (currentRequest !== requestId.current) return;
        setLogoData(logo);
        setAvailableSegments(logo.segments);
        setAvailablePlans(logo.plans);
        setRevenueData(revenue);
        setPlanData(plans);
        setSegmentData(segments);
        setLoading(false);
      })
      .catch(() => {
        if (currentRequest !== requestId.current) return;
        setLogoData(null);
        setRevenueData(null);
        setPlanData([]);
        setSegmentData([]);
        setError("Retention could not load. These are not zero-retention results.");
        setLoading(false);
      });
  }, [segment, plan]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const beginLoading = () => { requestId.current++; setLoading(true); setError(""); };
  const refreshData = () => { beginLoading(); fetchData(); };

  const averageRetention = (data: CohortData | null, monthOffset: number) => {
    if (!data || data.rows.length === 0) return null;
    const values = data.rows
      .filter((r) => r.retention.length > monthOffset)
      .map((r) => r.retention[monthOffset]);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const planChartData = planData.map((p) => ({
    name: p.plan,
    retention: Math.round(p.retentionRate * 100),
    sampleSize: p.sampleSize,
  }));

  const segmentChartData = segmentData.map((s) => ({
    name: s.segment.length > 20 ? s.segment.substring(0, 20) + "..." : s.segment,
    retention: Math.round(s.retentionRate * 100),
    sampleSize: s.sampleSize,
  }));

  return (
    <>
      <PageHeader
        title="Retention Dashboard"
        description="How many customers stayed, and how much recurring revenue did they retain?"
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
          {availableSegments.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Subscription plan"
          value={plan}
          onChange={(e) => { beginLoading(); setPlan(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All plans</option>
          {availablePlans.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>

        <button
          onClick={refreshData}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Refresh
        </button>
        {(segment || plan) && <button className="px-3 py-2 text-sm underline" onClick={() => { beginLoading(); setSegment(""); setPlan(""); }}>Clear filters</button>}
      </div>

      {error && <p role="alert" className="text-sm text-rose-200">{error} <button onClick={refreshData} className="ml-2 underline">Retry</button></p>}
      <p className="text-sm text-neutral-300">Cohort scope: {segment || "all industries"} · {plan || "all plans"}{logoData?.asOf ? ` · Snapshot ${logoData.asOf.slice(0, 10)} UTC` : ""}. M0 is the first subscription month; M1 is one month later. Customer retention counts accounts; revenue retention compares recurring revenue with the cohort’s starting MRR. Above 100% means expansion. Unobserved months are blank.</p>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
        {[
          { label: "Customers · month 1", value: averageRetention(logoData, 1) },
          { label: "Customers · month 3", value: averageRetention(logoData, 3) },
          { label: "Revenue · month 1", value: averageRetention(revenueData, 1) },
        ].map(({ label, value }) => <div key={label} className="bg-neutral-950 p-4"><dt className="text-sm text-neutral-400">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value === null ? "—" : `${(value * 100).toFixed(1)}%`}</dd></div>)}
        <div className="bg-neutral-950 p-4"><dt className="text-sm text-neutral-400">Cohorts tracked</dt><dd className="mt-2 text-2xl font-semibold">{logoData ? logoData.rows.length : "—"}</dd></div>
      </dl>
      <p className="text-sm text-neutral-400">Rates are an equal-weight average of cohorts with an observed month, not a customer-weighted workspace rate.</p>

      <details open={showCohorts} onToggle={(event) => setShowCohorts(event.currentTarget.open)} className="space-y-5">
      <summary className="min-h-11 cursor-pointer rounded-md border border-neutral-700 px-4 py-3 text-sm font-medium">Monthly cohort tables <span className="font-normal text-neutral-400">· expand to compare all months</span></summary>

      {/* Logo Retention Cohort Table */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-100">Customer retention cohorts</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800" tabIndex={0} role="region" aria-label="Monthly retention cohort table, scroll horizontally to all observed months">
          {loading ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              Loading cohort data...
            </div>
          ) : !logoData || logoData.rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              {error ? "Cohorts unavailable while the request failed." : "No cohorts match these filters. Clear filters to return to all cohorts."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/60">
                  <th className="sticky left-0 z-10 bg-neutral-900 px-4 py-2 text-left font-medium text-neutral-400">
                    Cohort
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-400">
                    Size
                  </th>
                  {Array.from({ length: logoData.maxMonths + 1 }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center font-medium text-neutral-400">
                      M{i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logoData.rows.map((row) => (
                  <tr key={row.cohort} className="border-b border-neutral-800/50 hover:bg-neutral-900/40">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-4 py-2 text-left font-medium text-neutral-200">
                      {formatMonth(row.cohort)}
                    </th>
                    <td className="px-3 py-2 text-right text-neutral-400">
                      {row.cohortSize}
                    </td>
                    {row.retention.map((rate, idx) => (
                      <td key={idx} className="px-1 py-1">
                        <div
                          className={cn(
                            "flex items-center justify-center rounded px-2 py-1 text-xs font-medium",
                            retentionColor(rate)
                          )}
                        >
                          {(rate * 100).toFixed(0)}%
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Revenue Retention Cohort Table */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-100">Revenue Retention Cohorts</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800" tabIndex={0} role="region" aria-label="Monthly retention cohort table, scroll horizontally to all observed months">
          {loading ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              Loading revenue cohort data...
            </div>
          ) : !revenueData || revenueData.rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              {error ? "Revenue cohorts unavailable while the request failed." : "No revenue cohorts match these filters. Clear filters to return to all cohorts."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/60">
                  <th className="sticky left-0 z-10 bg-neutral-900 px-4 py-2 text-left font-medium text-neutral-400">
                    Cohort
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-neutral-400">
                    Initial MRR
                  </th>
                  {Array.from({ length: revenueData.maxMonths + 1 }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center font-medium text-neutral-400">
                      M{i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {revenueData.rows.map((row) => (
                  <tr key={row.cohort} className="border-b border-neutral-800/50 hover:bg-neutral-900/40">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-4 py-2 text-left font-medium text-neutral-200">
                      {formatMonth(row.cohort)}
                    </th>
                    <td className="px-3 py-2 text-right text-neutral-400">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row.cohortSize)}
                    </td>
                    {row.retention.map((rate, idx) => (
                      <td key={idx} className="px-1 py-1">
                        <div
                          className={cn(
                            "flex items-center justify-center rounded px-2 py-1 text-xs font-medium",
                            retentionColor(rate)
                          )}
                        >
                          {(rate * 100).toFixed(0)}%
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      </details>

      {/* Plan-Level Retention Chart */}
      <section className="border-t border-neutral-800 pt-5">
        <h2 className="text-lg font-semibold">Whole-workspace comparisons</h2>
        <p className="mt-1 text-sm text-neutral-300">The two charts below include all customers and are unaffected by the cohort filters above.</p>
      </section>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-100">Plan-Level Retention</h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          {loading ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              Loading plan retention data...
            </div>
          ) : planChartData.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              No plan retention data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={planChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: "#9ca3af", fontSize: 12 }} />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  domain={[0, 100]}
                  label={{ value: "Retention %", angle: -90, fill: "#9ca3af" }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", color: "#f3f4f6" }}
                  formatter={(value: number) => [`${value}%`, "Retention"]}
                />
                <Bar dataKey="retention" name="Retention Rate" radius={[4, 4, 0, 0]}>
                  {planChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={retentionBarColor(entry.retention / 100)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Segment Retention Chart */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-100">Segment Retention</h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          {loading ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              Loading segment retention data...
            </div>
          ) : segmentChartData.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              No segment retention data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={segmentChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  label={{ value: "Retention %", position: "insideBottom", fill: "#9ca3af" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", color: "#f3f4f6" }}
                  formatter={(value: number) => [`${value}%`, "Retention"]}
                />
                <Bar dataKey="retention" name="Retention Rate" radius={[0, 4, 4, 0]} barSize={20}>
                  {segmentChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={retentionBarColor(entry.retention / 100)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}
