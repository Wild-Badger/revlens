"use client";

import { apiFetch } from "@/lib/api-fetch";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { MetricCard } from "@portfolio/ui/components/metric-card";
import { formatCurrency as formatUsd } from "@portfolio/ui/lib/utils";

const formatCurrency = (value: number) => formatUsd(value, { maximumFractionDigits: 2 });

interface Summary {
  dataset_kind: "demo" | "local" | "empty";
  as_of: string;
  current_mrr: number;
  opening_mrr: number;
  period_start: string;
  current_arr: number;
  customer_count: number;
  mrr_growth_rate: number;
  nrr: number;
  grr: number;
  logo_churn_rate: number;
  revenue_churn_rate: number;
  arpa: number;
  ltv: number | null;
  mrr_history: MrrHistoryPoint[];
}

interface MrrHistoryPoint {
  month: string;
  mrr: number;
}

interface Movement {
  month: string;
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  reactivation_mrr: number;
  stable_mrr: number;
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

function formatPercent(value: number) {
  return percentFormatter.format(value);
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

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all(["/api/revenue/summary", "/api/revenue/movements"].map(async (url) => {
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("Revenue data is unavailable. Please try again.");
      return response.json();
    })).then(([nextSummary, data]) => {
      if (active) { setSummary(nextSummary); setMovements(data.movements); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Revenue data could not load."); });
    return () => { active = false; };
  }, [attempt]);

  const period = summary?.as_of.slice(0, 7);
  const movement = movements.find((point) => point.month.startsWith(period ?? "none"));
  const gains = (movement?.new_mrr ?? 0) + (movement?.expansion_mrr ?? 0) + (movement?.reactivation_mrr ?? 0);
  const losses = (movement?.contraction_mrr ?? 0) + (movement?.churned_mrr ?? 0);
  const net = gains - losses;
  const bridgeAgrees = summary && Math.abs(summary.opening_mrr + net - summary.current_mrr) < 0.01;
  const signedMovements = movements.map((point) => ({ ...point, contraction_mrr: -point.contraction_mrr, churned_mrr: -point.churned_mrr }));

  return (
    <>
      <PageHeader
        title="Revenue overview"
        description={summary?.dataset_kind === "empty" ? "Your local workspace is empty. Import a dated CSV to start." : summary ? `Subscription performance as of ${new Date(summary.as_of).toLocaleDateString("en-US", { timeZone: "UTC",month: "long", day: "numeric", year: "numeric"})}. All amounts in USD.` : "Loading subscription performance…"}
      >
        <Link href="/customers" className="rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/40">Explore customers →</Link>
        <button onClick={() => window.print()} className="rounded-md border border-neutral-700 px-3 py-2 text-sm">Print summary</button>
      </PageHeader>

      {error && <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">{error} <button className="ml-3 underline" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry</button></div>}
      {!summary && !error && <p role="status" className="text-sm text-neutral-400">Calculating subscription metrics…</p>}

      {summary?.dataset_kind === "empty" ? <section className="space-y-4 rounded-lg border border-neutral-700 p-6"><h2 className="text-xl font-semibold">Start with your dated records</h2><p className="max-w-2xl text-sm leading-6 text-neutral-300">No business data has been imported. Download the fictional example to check the format, then preview your own CSV before saving. Revenue charts and retention will appear after import.</p><Link href="/import" className="inline-block rounded-md bg-emerald-700 px-4 py-3 text-sm text-white">Import and preview CSV →</Link></section> : <>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>div]:p-4 [&>div>p:nth-child(2)]:text-xl lg:[&>div>p:nth-child(2)]:text-2xl">
        <MetricCard label="Monthly recurring revenue" value={summary ? formatCurrency(summary.current_mrr) : "—"} change={summary ? `${formatPercent(summary.mrr_growth_rate)} vs. prior month end` : undefined} changeType={!summary || summary.mrr_growth_rate === 0 ? "neutral" : summary.mrr_growth_rate < 0 ? "negative" : "positive"} className="border-emerald-900 bg-emerald-950/20" />
        <MetricCard label="Annual run rate" value={summary ? formatCurrency(summary.current_arr) : "—"} change="Monthly recurring revenue × 12" />
        <MetricCard label="Net revenue retention" value={summary && summary.opening_mrr > 0 ? formatPercent(summary.nrr) : "No prior base"} change="Opening accounts, month to snapshot" />
        <MetricCard label="Paying customers" value={summary ? String(summary.customer_count) : "—"} change="With an active subscription" />
      </div>

      {summary && <section aria-label="Monthly revenue reconciliation" className="rounded-lg border border-neutral-800 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div><h2 className="text-lg font-semibold">What changed in {formatLongMonth(summary.as_of)}?</h2><p className="mt-1 text-sm text-neutral-300">{formatCurrency(Math.abs(net))} {net < 0 ? "lost" : "added"} in monthly recurring revenue since the prior month end.</p></div>
          <Link className="text-sm text-emerald-200 underline" href="/customers?status=active&paymentStatus=failed&sortBy=currentMrr&sortOrder=desc">Review payment flags →</Link>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[["Opening MRR", summary.opening_mrr], ["Gains (+)", gains], ["Losses (−)", losses === 0 ? 0 : -losses], ["Closing MRR", summary.current_mrr]].map(([label, amount]) => <div key={String(label)}><dt className="text-sm text-neutral-300">{label}</dt><dd className="mt-1 text-lg font-semibold">{formatCurrency(Number(amount))}</dd></div>)}
        </dl>
        <p className="mt-3 text-sm text-neutral-300">Gains = new + expansion + reactivation. Losses = contraction + churn. {bridgeAgrees ? "Opening + gains − losses reconciles to closing MRR." : "The movement totals do not reconcile; investigate the source data before using this figure."} This measures recurring revenue, not cash collected.</p>
      </section>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">
          MRR Trend
        </h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary?.mrr_history ?? []}>
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
              <Line
                type="monotone"
                dataKey="mrr"
                name="MRR"
                stroke="#34d399"
                strokeWidth={3}
                dot={{ r: 3, fill: "#34d399" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">
          Revenue Movement Breakdown
        </h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={signedMovements} stackOffset="sign">
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
              <Bar dataKey="new_mrr" name="New" fill="#10b981" stackId="a" />
              <Bar
                dataKey="expansion_mrr"
                name="Expansion (+)"
                fill="#059669"
                stackId="a"
              />
              <Bar
                dataKey="contraction_mrr"
                name="Contraction (−)"
                fill="#f59e0b"
                stackId="a"
              />
              <Bar
                dataKey="churned_mrr"
                name="Churn (−)"
                fill="#f43f5e"
                stackId="a"
              />
              <Bar
                dataKey="reactivation_mrr"
                name="Reactivation (+)"
                fill="#a3a3a3"
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>
      <section className="border-t border-neutral-800 pt-6" aria-label="Supporting metrics">
        <h2 className="mb-4 text-lg font-semibold">Retention &amp; unit economics</h2>
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-5">
          {[
            ["Gross retention", summary && summary.opening_mrr > 0 ? formatPercent(summary.grr) : "No prior base"],
            ["Customer churn", summary && summary.opening_mrr > 0 ? formatPercent(summary.logo_churn_rate) : "No prior base"],
            ["Revenue churn", summary && summary.opening_mrr > 0 ? formatPercent(summary.revenue_churn_rate) : "No prior base"],
            ["Revenue per account", summary ? formatCurrency(summary.arpa) : "—"],
            ["Implied LTV", summary?.ltv != null ? formatCurrency(summary.ltv) : "Not estimable"],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-neutral-400">{label}</dt><dd className="mt-2 text-xl font-semibold">{value}</dd></div>)}
        </dl>
        <p className="mt-5 max-w-3xl text-sm leading-6 text-neutral-300">NRR compares current revenue from accounts present at the prior month end with their opening MRR, including expansion and losses. GRR caps each account at its opening revenue. New accounts are excluded from both. Implied LTV = revenue per account ÷ this month’s customer churn; it excludes gross margin and is unavailable with zero observed churn. {process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Synthetic demonstration, not a customer outcome." : "Based on the subscription intervals supplied in your local dataset."}</p>
      </section>
      </>}
    </>
  );
}
