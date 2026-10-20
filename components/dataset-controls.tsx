"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DownloadButton } from "@/components/download-button";

export function DatasetControls() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function restore() {
    if (!file || !confirmed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Backup must be at most 25 MiB.");
      const backup = JSON.parse(await file.text());
      const response = await fetch("/api/dataset/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "REPLACE_LOCAL_DATASET", backup }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Backup was rejected. The previous dataset was preserved.");
      setMessage("Backup restored. Open the overview or customers to analyse the restored snapshot.");
      setConfirmed(false);
      setFile(null);
      router.refresh();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "Restore could not finish. Retry after checking the local server.");
    } finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-lg border border-neutral-800 p-5">
    <h2 className="text-lg font-semibold">Backup and restore</h2>
    <p className="text-sm leading-6 text-neutral-300">Download a full business-data backup before replacing your dataset. It includes the snapshot date and all supplied records, and excludes accounts, passwords and sessions.</p>
    <DownloadButton className="inline-block rounded-md border border-neutral-700 px-4 py-2 text-sm underline" href="/api/dataset/backup" filename="revlens-backup.json">Download full JSON backup</DownloadButton>
    <label className="block text-sm">Choose a RevLens JSON backup<input type="file" accept=".json,application/json" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setConfirmed(false); setMessage(""); }} className="mt-2 block max-w-full rounded border border-neutral-700 p-2" /></label>
    <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I understand that restoring replaces the current business dataset. I have saved the backup I need. My local sign-in account will be preserved.</label>
    <button disabled={!file || !confirmed || busy} onClick={restore} className="rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40">{busy ? "Restoring…" : "Restore selected backup"}</button>
    <p role="status" className="text-sm text-neutral-200">{message}</p>
  </section>;
}
