"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/export";

export function DownloadButton({ href, filename, children, className }: { href: string; filename: string; children: React.ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error("Download could not finish. Check the local server and retry.");
      downloadFile(filename, await response.text(), response.headers.get("Content-Type") ?? "application/octet-stream");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download failed. Retry.");
    } finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col items-start gap-2"><button type="button" className={className} disabled={busy} onClick={download}>{busy ? "Preparing download…" : children}</button>{error && <span role="alert" className="text-sm text-rose-200">{error}</span>}</span>;
}
