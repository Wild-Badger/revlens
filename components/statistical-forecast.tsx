"use client";
import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Link from "next/link";
import { Card } from "@portfolio/ui/components/card";
import { apiFetch } from "@/lib/api-fetch";
import { downloadFile } from "@/lib/export";
import type { PredictionReport } from "@/lib/prediction";

const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const percent = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
const button = "min-h-11 rounded-md border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-40";

export function StatisticalForecast() {
  const [report,setReport] = useState<PredictionReport | null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/forecast/prediction", { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Prediction could not load"); return data as PredictionReport; })
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Prediction could not load"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  if (loading) return <p role="status" className="py-12 text-sm text-neutral-300">Loading the evaluated monthly forecast…</p>;
  if (error) return <Card className="space-y-4 p-6"><h2 className="text-xl font-semibold">Prediction is unavailable</h2><p role="alert" className="text-sm text-neutral-300">{error}</p><div className="flex flex-wrap gap-3"><button className={button} onClick={() => { setError(""); setLoading(true); setAttempt(value => value+1); }}>Retry prediction</button><Link href="/data" className={button}>Open data workspace</Link></div></Card>;
  if (!report) return null;
  if (report.status !== "ready") return <Card className="space-y-4 p-6"><h2 className="text-xl font-semibold">{report.status === "insufficient_history" ? "More complete history is needed" : "Model fitting could not finish"}</h2><p className="max-w-3xl text-sm leading-6 text-neutral-300">{report.message}</p><p className="text-sm">{report.coverage.completeMonths} of {report.coverage.requiredMonths} required complete months · coverage {report.coverage.confirmed ? "confirmed" : "not confirmed"}</p><p className="text-sm text-neutral-300">Historical analytics and the What-if scenarios tab remain available. Confirm the coverage period when importing complete subscription intervals.</p></Card>;
  const latest = report.history.at(-1)!;
  const chart: { month: string; actual?: number; predicted?: number; range80?: number[]; range95?: number[] }[] = report.history.slice(-12).map(point => ({ month: point.month, actual: point.value, ...(point.month===latest.month ? {predicted:point.value} : {}) }));
  chart.push(...report.forecast.map(point => ({month:point.month,predicted:point.predicted,range80:[point.lower80,point.upper80],range95:[point.lower95,point.upper95]})));
  const selected = report.test!.selected, baseline = report.test!.baseline;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">The next three months</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-300">{report.coverage.completeMonths} complete months · {report.source} · observed through {report.asOf?.slice(0,10)} UTC. Forecasts use historical MRR, independently of the scenario sliders.</p></div><button className={button} onClick={() => downloadFile(`revlens-prediction-r${report.revision}.json`,JSON.stringify(report,null,2),"application/json")}>Export prediction JSON</button></div>
    <dl className="grid gap-4 rounded-lg border border-neutral-800 p-5 sm:grid-cols-3">
      <div><dt className="text-sm text-neutral-400">{date(report.forecast[0].month)} · forecast MRR</dt><dd className="mt-2 text-3xl font-medium tabular-nums">{money(report.forecast[0].predicted)}</dd><p className="mt-2 text-sm text-neutral-400">Latest observed: {money(latest.value)}</p></div>
      <div><dt className="text-sm text-neutral-400">Selected method</dt><dd className="mt-2 text-lg font-medium">{report.selectedLabel}</dd><p className="mt-2 text-sm text-neutral-400">Chosen on earlier validation months</p></div>
      <div><dt className="text-sm text-neutral-400">Final test · mean absolute error</dt><dd className="mt-2 text-3xl font-medium tabular-nums">{money(selected.mae)}</dd><p className="mt-2 text-sm text-neutral-400">Last-value baseline: {money(baseline.mae)} · {selected.count} forecasts</p></div>
    </dl>
    <Card className="space-y-4 p-4 sm:p-6"><div><h3 className="font-semibold">Observed MRR and statistical prediction</h3><p className="mt-1 text-sm text-neutral-400">Last 12 observed months shown; fitting uses all {report.coverage.completeMonths} complete months.</p></div>
      <div className="h-80 w-full" role="img" aria-label="Monthly MRR history and three-month forecast with nominal 80 and 95 percent prediction intervals. Exact amounts follow in a table."><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{top:12,right:12,left:0,bottom:8}} accessibilityLayer>
        <CartesianGrid stroke="#404040" strokeOpacity={0.35} vertical={false}/><XAxis dataKey="month" tickFormatter={date} minTickGap={35} tick={{fill:"var(--app-muted)",fontSize:12}}/><YAxis width={65} tickFormatter={value => new Intl.NumberFormat("en-US",{notation:"compact",style:"currency",currency:"USD",maximumFractionDigits:0}).format(value)} tick={{fill:"var(--app-muted)",fontSize:12}}/>
        <Tooltip labelFormatter={value=>date(String(value))} formatter={value=>Array.isArray(value) ? value.map(item=>money(Number(item))).join(" – ") : money(Number(value))} contentStyle={{background:"var(--tooltip-bg, #171717)",borderColor:"#525252",borderRadius:6}}/><Legend/>
        <Area type="linear" dataKey="range95" name="95% nominal interval" fill="#737373" fillOpacity={0.18} stroke="none" isAnimationActive={false}/><Area type="linear" dataKey="range80" name="80% nominal interval" fill="#10b981" fillOpacity={0.14} stroke="none" isAnimationActive={false}/>
        <Line type="linear" dataKey="actual" name="Observed MRR" stroke="#a3a3a3" strokeWidth={2} dot={false} isAnimationActive={false}/><Line type="linear" dataKey="predicted" name="Statistical prediction" stroke="#10b981" strokeWidth={2} strokeDasharray="5 4" dot={{r:3}} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer></div>
      <p className="text-sm leading-6 text-neutral-400">Bands describe uncertainty under the selected model’s assumptions. Nominal coverage is not a guarantee; the observed test coverage is reported below.</p>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Forecast amounts, scroll horizontally if needed"><table className="w-full min-w-[560px] text-sm"><caption className="sr-only">Forecast MRR in USD</caption><thead><tr className="border-b border-neutral-700 text-neutral-400"><th scope="col" className="py-3 text-left font-normal">Month</th><th scope="col" className="text-right font-normal">Point forecast</th><th scope="col" className="text-right font-normal">80% interval</th><th scope="col" className="text-right font-normal">95% interval</th></tr></thead><tbody>{report.forecast.map(point=><tr key={point.month} className="border-b border-neutral-800 tabular-nums"><th scope="row" className="py-3 text-left font-normal">{date(point.month)}</th><td className="text-right">{money(point.predicted)}</td><td className="text-right">{money(point.lower80)} – {money(point.upper80)}</td><td className="text-right">{money(point.lower95)} – {money(point.upper95)}</td></tr>)}</tbody></table></div>
    </Card>
    <details className="rounded-lg border border-neutral-800 p-5"><summary className="cursor-pointer font-medium">How the methods were compared</summary><div className="mt-4 space-y-5 text-sm leading-6 text-neutral-300"><p>Models were selected with rolling-origin validation starting at 12 training months, through {date(report.validation!.developmentEnd)}. The final six months, {date(report.test!.start)}–{date(report.test!.end)}, were reserved for testing. During the test, parameters were refitted only as observations became available; the chosen method stayed fixed.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><caption className="mb-2 text-left text-neutral-400">Earlier validation · selection by lowest MAE</caption><thead><tr className="border-b border-neutral-700"><th scope="col" className="py-2 text-left font-normal">Candidate</th><th scope="col" className="text-right font-normal">MAE</th><th scope="col" className="text-right font-normal">WAPE</th><th scope="col" className="text-right font-normal">Evaluated forecasts</th></tr></thead><tbody>{report.validation!.candidates.map(candidate=><tr key={candidate.model} className="border-b border-neutral-800"><th scope="row" className="py-3 text-left font-normal">{candidate.label}{candidate.status==="failed" ? ` · fit failed (${candidate.failures.length})` : ""}</th><td className="text-right tabular-nums">{money(candidate.mae)}</td><td className="text-right tabular-nums">{percent(candidate.wape)}</td><td className="text-right tabular-nums">{candidate.count}</td></tr>)}</tbody></table></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[510px] text-sm"><caption className="mb-2 text-left text-neutral-400">Final test · selected method versus last observed value</caption><thead><tr className="border-b border-neutral-700"><th scope="col" className="py-2 text-left font-normal">Horizon</th><th scope="col" className="text-right font-normal">MAE</th><th scope="col" className="text-right font-normal">Baseline MAE</th><th scope="col" className="text-right font-normal">80% / 95% observed coverage</th><th scope="col" className="text-right font-normal">Count</th></tr></thead><tbody>{report.test!.intervalCoverage.map((coverage,i)=><tr key={coverage.horizon} className="border-b border-neutral-800 tabular-nums"><th scope="row" className="py-3 text-left font-normal">{coverage.horizon} month{coverage.horizon>1?"s":""}</th><td className="text-right">{money(selected.byHorizon![i].mae)}</td><td className="text-right">{money(baseline.byHorizon![i].mae)}</td><td className="text-right">{percent(coverage.coverage80)} / {percent(coverage.coverage95)}</td><td className="text-right">{coverage.count}</td></tr>)}</tbody></table></div>
      <p>Final-test WAPE: {percent(selected.wape)}. WAPE is unavailable when actual values sum to zero. The small test set limits conclusions; no real SaaS accuracy is established by fictional subscriptions.</p>
      <ul className="list-disc space-y-1 pl-5">{report.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
      <p><a className="underline" href="https://github.com/Wild-Badger/revlens/blob/main/docs/forecast-evaluation.md" target="_blank" rel="noreferrer">Read the reproducible evaluation and separate real-sales benchmark ↗</a></p><p className="break-all text-xs text-neutral-400">{report.methodVersion} · data SHA-256 {report.dataHash} · revision {report.revision} · generated {report.generatedAt}</p>
    </div></details>
  </div>;
}
