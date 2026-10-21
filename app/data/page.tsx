import Link from "next/link";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { getDatasetContext } from "@/lib/dataset";
import { DatasetControls } from "@/components/dataset-controls";

// This server page reads mutable local metadata; never freeze its empty build-time dataset.
export const dynamic = "force-dynamic";

export default async function DataPage() {
  const context = await getDatasetContext();
  const local = process.env.LOCAL_WORKSPACE_MODE === "true" && process.env.DEMO_MODE !== "true";
  return <>
    <PageHeader title="Data workspace" description="Know which dataset you are using, where it lives, and how to keep a recoverable copy." />
    <section className="space-y-3 rounded-lg border border-neutral-800 p-5">
      <h2 className="text-lg font-semibold">{local ? "Your local dataset" : "Synthetic portfolio demonstration"}</h2>
      <p className="text-sm leading-6 text-neutral-300">{local ? "CSV files are sent only to this loopback server and stored in its dedicated local PostgreSQL database. They are not sent to a billing provider, cloud analytics service or AI model by RevLens." : "This installation uses fictional accounts and a read-only synthetic database. It does not accept your business files. A separate local workspace is available for your own data."}</p>
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3"><div><dt className="text-neutral-400">Dataset</dt><dd>{context.kind === "demo" ? "Synthetic" : context.kind === "empty" ? "Empty — import your first file" : "Imported local records"}</dd></div><div><dt className="text-neutral-400">Snapshot in UTC</dt><dd>{context.kind === "empty" ? "Not imported yet" : context.asOf.toISOString().slice(0, 10)}</dd></div><div><dt className="text-neutral-400">Currency</dt><dd>USD only; no currency conversion</dd></div></dl>
      {local ? <Link href="/import" className="inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Import and review CSV →</Link> : <p className="text-sm leading-6 text-neutral-300">For the local version, run <code>./scripts/start-local.ps1</code> from your RevLens checkout, then create your local owner account. It starts a separate empty database and does not change this demo.</p>}
    </section>
    {local && <DatasetControls />}
    <section className="space-y-3 text-sm leading-6 text-neutral-300"><h2 className="text-lg font-semibold text-neutral-100">Storage and limits</h2><p>Local records persist on this computer until you replace the dataset. Backups and exported CSVs contain business data: keep them where you keep your financial files. Anyone with access to the local owner account or the computer’s database files may access them. This is a single-operator local tool, not a multi-tenant hosted service.</p><p>Import requires dated subscription intervals and explicit USD MRR. Use a distinct subscription_id for each price change or reactivation; intervals for the same customer cannot overlap. It cannot infer missing history, currency conversion, accounting revenue recognition or bank cash. Retention and history describe only the intervals supplied. Statistical forecasts use complete monthly history and report test errors; the separate What-if tab uses adjustable scenarios. SCD2 captures observed attribute changes from import onward.</p></section>
  </>;
}
