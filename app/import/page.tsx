"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { Card } from "@portfolio/ui/components/card";
import { DownloadButton } from "@/components/download-button";
import { IMPORT_COLUMNS, MAX_IMPORT_BYTES, type ColumnMappings, type ImportValidationResult, type ImportColumn } from "@/lib/import/csv-validator";
import type { ImportOptions } from "@/lib/import/options";
import type { ImportResult } from "@/lib/import/import-service";
import { MAPPING_STORAGE_KEY, reuseColumnMappings } from "@/lib/import/column-mappings";

type Preview = ImportValidationResult & { success: boolean; previewToken: string; revision: number };
const button = "inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";
const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const mappingGroups = [
  { title: "Customer and reporting facts · 10 required, website optional", columns: IMPORT_COLUMNS.filter(([column, required]) => required || column === "domain"), required: true },
  { title: "Subscription intervals · required for paying or churned customers", columns: IMPORT_COLUMNS.filter(([column]) => ["subscription_id", "plan_id", "plan_name", "plan_base_price", "plan_seat_price", "billing_interval", "seats", "mrr", "subscription_started_at", "subscription_ended_at"].includes(column)) },
  { title: "Optional invoice facts", columns: IMPORT_COLUMNS.filter(([column]) => column.startsWith("invoice_")) },
  { title: "Optional product events", columns: IMPORT_COLUMNS.filter(([column]) => column.startsWith("event_")) },
];

export default function ImportWizardPage() {
  const router = useRouter();
  const [options,setOptions] = useState<ImportOptions>({mode:"update",sourceName:"Local dataset",historyStart:null,historyComplete:false});
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMappings>({});
  const [totalRows, setTotalRows] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"detect" | "validate" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);
  const selection = useRef(0);
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const missing = IMPORT_COLUMNS.filter(([column, required]) => required && !mappings[column]);

  async function chooseFile(selected: File | null) {
    const current = ++selection.current;
    setFile(null); setHeaders([]); setMappings({}); setPreview(null); setResult(null); setError(null); setConfirmed(false); setTotalRows(0); setMappingNotice(null);
    if (!selected) return;
    if (!/\.csv$/i.test(selected.name)) { setError("Choose a UTF-8 .csv file."); return; }
    if (selected.size > MAX_IMPORT_BYTES) { setError("CSV exceeds 2 MiB. Split or reduce the source dataset before importing."); return; }
    setBusy("detect");
    try {
      const body = new FormData(); body.append("file", selected);
      const response = await fetch("/api/import/columns", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read the CSV");
      if (current !== selection.current) return;
      setFile(selected); setHeaders(data.headers); setTotalRows(data.totalRows);
      const detected = Object.fromEntries(data.mapping.map((item: { column: ImportColumn; sourceHeader: string | null }) => [item.column, item.sourceHeader]));
      let saved: string | null = null;
      try { saved = localStorage.getItem(MAPPING_STORAGE_KEY); } catch { /* Storage can be disabled; importing still works. */ }
      const restored = reuseColumnMappings(data.headers, detected, saved);
      setMappings(restored);
      if (JSON.stringify(restored) !== JSON.stringify(detected)) setMappingNotice("Remembered mapping applied to matching headers. Review it before replacing data.");
    } catch (error) { if (current === selection.current) setError(error instanceof Error ? error.message : "Could not inspect the file. Choose it again to retry."); }
    finally { if (current === selection.current) setBusy(null); }
  }
  function changeMapping(column: ImportColumn, value: string) {
    setMappings(current => ({ ...current, [column]: value || null })); setPreview(null); setResult(null); setConfirmed(false); setError(null);
  }
  async function validate() {
    if (!file) return;
    setBusy("validate"); setError(null); setPreview(null); setResult(null); setConfirmed(false);
    try {
      const body = new FormData(); body.append("file", file); body.append("mappings", JSON.stringify(mappings)); body.append("options", JSON.stringify(options));
      const response = await fetch("/api/import/validate", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Validation failed");
      setPreview(data); setOptions(current => ({ ...current, expectedRevision: data.revision }));
      if (data.success) {
        try { localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mappings)); setMappingNotice("Column mapping remembered on this browser. No CSV contents or customer records are saved in browser storage."); }
        catch { setMappingNotice("Browser storage is unavailable. This import works, but its mapping will not be remembered."); }
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not validate. Your current dataset is unchanged; retry validation."); }
    finally { setBusy(null); }
  }
  async function commit() {
    if (!file || !preview?.success || !confirmed) return;
    setBusy("import"); setError(null);
    try {
      const body = new FormData(); body.append("file", file); body.append("mappings", JSON.stringify(mappings)); body.append("options", JSON.stringify(options));
      body.append("confirmReplace", "true"); body.append("previewToken", preview.previewToken);
      const response = await fetch("/api/import/commit", { method: "POST", body });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Import failed. No changes saved; retry after reviewing the file.");
      setResult(data); setConfirmed(false); window.dispatchEvent(new Event("revlens:dataset-changed")); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Connection lost. Check Customers before retrying; a repeated import replaces the same dataset without duplicates."); }
    finally { setBusy(null); }
  }

  function changeOptions(value: Partial<ImportOptions>) { setOptions(current=>({...current,...value}));setPreview(null);setResult(null);setConfirmed(false); }
  return <>
    <PageHeader title="Import your data" description="Review a dated CSV, then replace the dataset in this local installation." />
    <div className="space-y-5">
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold">A local workspace, with an explicit data boundary</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-neutral-300">Your file is sent to this installation&apos;s server and stored in its PostgreSQL database. It persists after closing the browser or restarting, until you replace the dataset. Access is for this installation&apos;s owner; this is not a public multi-user service or browser-only storage.</p>
        <p className="max-w-3xl text-sm leading-relaxed text-neutral-300">Import USD subscription history, including dated price changes, churn and reactivation. Each interval has a constant MRR and a unique subscription_id; end the previous interval before the next starts. Your existing single-interval CSV also works without an ID. Optional invoices and events can wait. A paid invoice is not a confirmed bank payment.</p>
        <div className="flex flex-wrap gap-3">
          <DownloadButton className={secondary} href="/api/import/template" filename="revlens-synthetic-template-2026-09-30.csv">Download dated synthetic template</DownloadButton>
          {!demo && <><DownloadButton className={secondary} href="/api/import/example" filename="revlens-48-months.csv">Download 48-month MRR example</DownloadButton><DownloadButton className={secondary} href="/api/import/example?invalid=true" filename="revlens-invalid.csv">Download invalid example · validation check</DownloadButton></>}
          {!demo && <DownloadButton className={secondary} href="/api/dataset/backup" filename="revlens-backup.json">Download current dataset backup</DownloadButton>}
        </div>
        <p className="text-sm text-neutral-300">Template: 3 customers, 2 currently active subscriptions, MRR $200.00, 3 invoices with total face value $440.00, and 4 observed events. Observation date: 30 Sep 2026. These are fictional records, never your customers.</p>
      </Card>

      {!demo && <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">Source identity and historical coverage</h2>
        <p className="text-sm leading-6 text-neutral-300">Updating the same source preserves captured customer and plan versions. A new source starts a separate history; export the old backup before replacing it. Stable customer_id and plan_id values identify the same entities across imports.</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm"><span className="block">Import operation</span><select name="sourceMode" value={options.mode} onChange={event=>changeOptions({mode:event.target.value as "update"|"new"})} className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-950 p-2"><option value="update">Update this source · preserve SCD2 history</option><option value="new">New source · reset captured history</option></select></label>
        <label className="space-y-2 text-sm"><span className="block">Source name</span><input name="sourceName" autoComplete="off" value={options.sourceName} maxLength={100} onChange={event=>changeOptions({sourceName:event.target.value})} className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label>
        <label className="space-y-2 text-sm"><span className="block">First complete coverage month (optional)</span><input name="historyStart" autoComplete="off" type="month" value={options.historyStart?.slice(0,7)??""} onChange={event=>changeOptions({historyStart:event.target.value?`${event.target.value}-01`:null,historyComplete:false})} className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-950 p-2" /></label></div>
        <label className="flex items-start gap-3 text-sm leading-6"><input name="historyComplete" type="checkbox" checked={options.historyComplete} disabled={!options.historyStart} onChange={event=>changeOptions({historyComplete:event.target.checked})} className="mt-1 h-5 w-5 shrink-0"/>All subscription intervals from this coverage month through as_of are supplied. I understand that missing source records cannot be detected by RevLens.</label>
        <p className="text-sm text-neutral-400">A statistical forecast requires 24 complete months. Incomplete or unconfirmed history still supports descriptive analysis and manual scenarios.</p>
      </Card>}
      {demo ? <Card className="p-5"><p className="text-neutral-200">The shared synthetic demo is read-only. Run the dedicated local workspace to import your own data.</p></Card> : <>
        <Card className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">1. Choose and map your CSV</h2>
          <label className="block space-y-2 text-sm text-neutral-200">
            <span>UTF-8 CSV · maximum 2 MiB, 2,000 rows and 10,000 total product events</span>
            <input name="csvFile" type="file" accept=".csv,text/csv" disabled={busy !== null} onChange={event => { void chooseFile(event.target.files?.[0] ?? null); event.target.value = ""; }} className="block w-full rounded border border-neutral-600 p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-700 file:px-3 file:py-2 file:text-white" />
          </label>
          {busy === "detect" && <p role="status" className="text-sm text-neutral-300">Reading columns…</p>}
          {file && <>
            <p className="text-sm text-neutral-200">{file.name} · {totalRows} source rows. Start with 10 customer/reporting fields and five subscription facts. Repeat customer facts for each historical interval, invoice or event.</p>
            <p className="text-sm text-neutral-300">Matching headers are recognized automatically. Invoice and event groups are optional. Use decimal points and at most two decimals; remove unused non-empty source columns. Only validated column mappings are remembered on this browser.</p>
            {mappingNotice && <p role="status" className="text-sm text-emerald-300">{mappingNotice}</p>}
            <details open={missing.length > 0} className="rounded border border-neutral-700 p-3">
            <summary className="cursor-pointer text-sm font-medium">Review mapping · {10 - missing.length}/10 required customer/reporting fields matched</summary>
            <div className="mt-3 space-y-3">
              {mappingGroups.map(group => <details key={group.title} open={group.required} className="rounded border border-neutral-700 p-3">
                <summary className="cursor-pointer text-sm font-medium">{group.title} · {group.columns.filter(([column]) => mappings[column]).length}/{group.columns.length} matched</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">{group.columns.map(([column, required, description]) => <label key={column} className="block space-y-1 text-sm">
                <span className="font-medium text-neutral-100">{column}{required ? " *" : ""}</span>
                <span className="block text-neutral-300">{description}</span>
                <select value={mappings[column] ?? ""} onChange={event => changeMapping(column, event.target.value)} disabled={busy !== null} className="min-h-11 w-full rounded border border-neutral-600 bg-neutral-900 px-3 text-neutral-100">
                  <option value="">{required ? "Choose a source column" : "Not supplied"}</option>
                  {headers.map(header => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>)}</div></details>)}
            </div>
            </details>
            {missing.length > 0 && <p className="text-sm text-amber-200">Map {missing.length} required fields before validating: {missing.map(([column]) => column).join(", ")}.</p>}
            <button className={button} onClick={() => void validate()} disabled={busy !== null || missing.length > 0}>{busy === "validate" ? "Validating…" : "Validate and preview"}</button>
          </>}
        </Card>

        {error && <Card className="border border-red-500/50 p-5"><p role="alert" className="text-red-200">{error}</p><p className="mt-2 text-sm text-neutral-300">Correct the source or mapping and validate again. Validation never changes the stored dataset.</p></Card>}

        {preview && !result && <Card className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">2. Review the complete replacement</h2>
          <p className="text-sm text-neutral-200">Destination: revision {preview.revision} of the dedicated local PostgreSQL dataset · USD · observation date {preview.summary.asOf ?? "not valid"}. This operation replaces customers, subscriptions, plans, invoices, payments and product events; the owner account stays.</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Source rows", preview.summary.totalRows], ["Valid rows", preview.summary.validRows], ["Customers", preview.summary.customers], ["Subscriptions", preview.summary.subscriptions], ["Invoices", preview.summary.invoices], ["Events", preview.summary.events], ["Active MRR", usd(preview.summary.mrr)], ["Invoice face value", usd(preview.summary.invoiceTotal)]].map(([label, value]) => <div key={label} className="rounded border border-neutral-700 p-3"><dt className="text-sm text-neutral-300">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
          {preview.errors.length > 0 ? <div role="alert" className="space-y-2">
            <p className="font-medium text-red-200">No import permitted: {preview.errors.length} validation issues. No rows will be skipped or partially saved.</p>
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm text-neutral-200">{preview.errors.map((issue, index) => <li key={index}>Row {issue.row} · <strong>{issue.field}</strong>: {issue.message}</li>)}</ul>
          </div> : <>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left text-neutral-300">First {Math.min(5, preview.validRows.length)} normalized rows — the same mapping is used when saving</caption><thead><tr>{["Customer", "Plan", "MRR", "Start", "End", "Invoice date"].map(label => <th key={label} className="whitespace-nowrap border-b border-neutral-600 p-2">{label}</th>)}</tr></thead><tbody>{preview.validRows.slice(0, 5).map((row, index) => <tr key={index}><td className="p-2">{row.name}</td><td className="p-2">{row.plan_name ?? "No subscription"}</td><td className="p-2 text-right tabular-nums">{row.mrr === undefined ? "—" : usd(row.mrr)}</td><td className="whitespace-nowrap p-2">{row.subscription_started_at ?? "—"}</td><td className="whitespace-nowrap p-2">{row.subscription_ended_at ?? "Ongoing"}</td><td className="whitespace-nowrap p-2">{row.invoice_date ?? "Not supplied"}</td></tr>)}</tbody></table></div>
            <p className="text-sm text-amber-200">Export a full backup before replacement if you need the current dataset. A valid import is all-or-nothing; a failed database write preserves the previous dataset. Reimporting the same file does not accumulate duplicate facts. History uses only your supplied intervals; missing changes are never reconstructed.</p>
            <label className="flex items-start gap-3 rounded border border-amber-600/70 p-3 text-sm text-neutral-100"><input type="checkbox" checked={confirmed} disabled={busy !== null} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" /><span>I reviewed the date and totals. Replace the entire local dataset with these {preview.summary.customers} customers. I have exported any backup I need.</span></label>
            <button className={button} onClick={() => void commit()} disabled={busy !== null || !confirmed || !preview.success}>{busy === "import" ? "Saving transaction…" : `Replace dataset with ${preview.summary.customers} customers`}</button>
          </>}
        </Card>}

        {result && <Card className="space-y-4 border border-emerald-500/50 p-5" role="status">
          <h2 className="text-lg font-semibold">{result.imported} customers saved{result.analyticsStatus === "pending" ? " · analytics pending" : ""}</h2>{result.message && <p className="text-sm">{result.message}</p>}
          <p className="text-sm text-neutral-200">Complete replacement saved: {result.counts.subscriptions} subscriptions, {result.counts.invoices} invoices and {result.counts.events} events. USD · observed {result.asOf}. The dataset persists across browser reloads and server restarts.</p>
          {result.checkpointId && <a className="text-sm underline" href={`/api/dataset/checkpoints/${result.checkpointId}`} download>Download automatic checkpoint of the previous source</a>}<div className="flex flex-wrap gap-3"><Link className={button} href={result.analyticsStatus === "pending" ? "/data" : "/dashboard"}>{result.analyticsStatus === "pending" ? "Retry analytics from Data workspace" : "See what changed in revenue"}</Link><Link className={secondary} href="/customers">Analyze customers</Link><button className={secondary} onClick={() => { setResult(null); setPreview(null); setFile(null); setHeaders([]); }}>Import a different dataset</button></div>
        </Card>}
      </>}

      <details className="rounded-lg border border-neutral-700 p-5">
        <summary className="cursor-pointer font-medium">Dates, missing facts and supported history</summary>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-300"><p>A row describes a customer, one subscription interval, and optionally an invoice and event group. For a price or plan change, end the old interval and start a new one on the same date with a different subscription_id. For reactivation, leave the actual gap between intervals. Every row for that customer uses its current status at as_of, even rows describing ended history. Customer facts must agree across rows; each repeated interval, invoice and event ID must have identical facts.</p><p>A subscription_id identifies a constant-MRR interval in this format. If your billing tool reuses one subscription ID across price changes, append an interval suffix in your source, such as sub-123:2026-06-01. Blank IDs retain compatibility for a customer with only one interval. Overlapping intervals for one customer are rejected; this CSV format does not represent simultaneous subscriptions. An invoice links to the interval on its row.</p><p>MRR is the monthly recurring value for the whole interval, including annual billing. End dates stop the interval at the start of that UTC day; touching start/end dates are allowed. USD only: ARR, cash, currency conversion and inferred missing history are not supported. Invoice face values and statuses do not create bank-payment records. Event groups expand to their observed count and date, with no invented event times. Missing paid/failure dates remain unknown.</p><p>The single as_of date is the inclusive UTC cutoff; no fact may follow it. Source preparation is manual, with no live billing sync or external connector. Mapping preferences store only destination/source column names in this browser. Files and customer values go to this installation&apos;s server/database.</p></div>
      </details>
    </div>
  </>;
}
