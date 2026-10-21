"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadButton } from "@/components/download-button";

async function readRecoveryState() {
  const [status, list] = await Promise.all([fetch("/api/analytics/status", { cache: "no-store" }), fetch("/api/dataset/checkpoints", { cache: "no-store" })]);
  if (!status.ok || !list.ok) throw new Error("Could not load the current revision or checkpoint storage. Retry by reloading Data workspace.");
  return { revision: (await status.json()).revision as number, checkpoints: (await list.json()).checkpoints as { id: string; savedAt: string; bytes: number }[] };
}

export function DatasetControls() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [pendingRevision, setPendingRevision] = useState<number | null>(null);
  const [discardPending, setDiscardPending] = useState(false);
  const [checkpoints, setCheckpoints] = useState<{ id: string; savedAt: string; bytes: number }[]>([]);
  useEffect(() => {
    let cancelled = false;
    readRecoveryState().then(data => { if (!cancelled) { setRevision(data.revision); setCheckpoints(data.checkpoints); } })
      .catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load recovery state"); });
    return () => { cancelled = true; };
  }, []);

  async function restore() {
    if (!file || !confirmed || busy || revision === null || (pendingRevision !== null && !discardPending)) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Backup must be at most 25 MiB.");
      const backup = JSON.parse(await file.text());
      const response = await fetch("/api/dataset/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "REPLACE_LOCAL_DATASET", backup, expectedRevision: revision, ...(discardPending && pendingRevision !== null ? { discardPendingRevision: pendingRevision } : {}) }) });
      const result = await response.json();
      if (response.status === 409) {
        setRevision(result.revision); setDiscardPending(false);
        if (result.code === "pending_capture") setPendingRevision(result.revision);
        else { setPendingRevision(null); setConfirmed(false); }
        setMessage(result.error); return;
      }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Backup was rejected. The previous dataset was preserved.");
      setMessage(result.analyticsStatus === "pending" ? "Backup restored; analytics pending. Start the Python service and retry analytics refresh above." : "Backup restored, including captured attribute history. Open the overview to analyse it.");
      window.dispatchEvent(new Event("revlens:dataset-changed"));
      setConfirmed(false);
      setPendingRevision(null); setDiscardPending(false);
      const state = await readRecoveryState(); setRevision(state.revision); setCheckpoints(state.checkpoints);
      router.refresh();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "Restore could not finish. Retry after checking the local server.");
    } finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-lg border border-neutral-800 p-5">
    <h2 className="text-lg font-semibold">Backup and restore</h2>
    <p className="text-sm leading-6 text-neutral-300">Download a full business-data backup before replacing your dataset. Version 2 includes the observation date, supplied records, coverage, source identity and captured SCD2 versions, and excludes accounts, passwords and sessions.</p>
    <DownloadButton className="inline-block rounded-md border border-neutral-700 px-4 py-2 text-sm underline" href="/api/dataset/backup" filename="revlens-backup.json">Download full JSON backup</DownloadButton>
    <p className="text-sm text-neutral-300">Current revision: {revision ?? "loading"}. Before replacement, an automatic checkpoint preserves all current records and captured versions on this computer, even if analysis is pending. A checkpoint write failure cancels restoration.</p>
    <label className="block text-sm">Choose a RevLens JSON backup or checkpoint<input name="backupFile" type="file" accept=".json,application/json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setConfirmed(false); setMessage(""); setPendingRevision(null); setDiscardPending(false); }} className="mt-2 block max-w-full rounded border border-neutral-700 p-2" /></label>
    <label className="flex items-start gap-3 text-sm leading-6"><input name="confirmRestore" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I understand that restoring replaces the current business dataset. I have saved the backup I need. My local sign-in account will be preserved.</label>
    {pendingRevision !== null && <label className="flex items-start gap-3 rounded border border-amber-600 p-3 text-sm leading-6"><input name="discardPendingRevision" type="checkbox" checked={discardPending} onChange={event => setDiscardPending(event.target.checked)} className="mt-1" />Discard uncaptured changes in revision {pendingRevision} after saving its automatic checkpoint. Its raw records remain recoverable, but this restore replaces the active dataset.</label>}
    <button disabled={!file || !confirmed || busy || revision === null || (pendingRevision !== null && !discardPending)} onClick={restore} className="min-h-11 rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40">{busy ? "Restoring…" : "Restore selected backup"}</button>
    <p role="status" className="text-sm text-neutral-200">{message}</p>
    <details className="space-y-3"><summary className="min-h-11 cursor-pointer text-sm">Automatic checkpoints · {checkpoints.length}</summary><p className="text-sm text-neutral-400">Retained until you archive them yourself. Download and restore a checkpoint using the same validation as a backup. Invalid source records can be recovered manually; validation cannot be bypassed.</p><ul className="space-y-3">{checkpoints.map(item => <li key={item.id} className="text-sm"><a className="inline-flex min-h-11 items-center underline" href={`/api/dataset/checkpoints/${item.id}`} download>Download checkpoint · {new Date(item.savedAt).toLocaleString()} · {Math.ceil(item.bytes / 1024)} KiB</a><p className="break-all text-xs text-neutral-400">{item.id}</p></li>)}</ul></details>
  </section>;
}
