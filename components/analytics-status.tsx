"use client";
import { useEffect, useState } from "react";

export function AnalyticsStatus() {
  const [status,setStatus] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_LOCAL_WORKSPACE_MODE !== "true") return;
    const controller = new AbortController();
    const load = () => fetch("/api/analytics/status",{signal:controller.signal,cache:"no-store"}).then(response=>response.ok?response.json():null).then(data=>{if(data)setStatus(data.status);}).catch(()=>{});
    void load(); window.addEventListener("revlens:dataset-changed",load); window.addEventListener("focus",load);
    return ()=>{controller.abort();window.removeEventListener("revlens:dataset-changed",load);window.removeEventListener("focus",load);};
  },[]);
  async function refresh() {
    setBusy(true);setMessage("");
    try { const response=await fetch("/api/analytics/refresh",{method:"POST"});const data=await response.json();if(!response.ok)throw new Error(data.error);setStatus("ready");window.dispatchEvent(new Event("revlens:dataset-changed"));window.location.reload(); }
    catch(error){setMessage(error instanceof Error?error.message:"Analytics could not refresh. Data remains saved.");}
    finally{setBusy(false);}
  }
  if (!["pending","failed"].includes(status)) return null;
  return <section role="status" className="mb-5 space-y-2 rounded-lg border border-amber-600/60 p-4 text-sm"><p className="font-medium">Data saved · analytics pending</p><p className="text-neutral-300">The imported records remain stored. Complete the dbt checks and attribute snapshots before replacing another dataset.</p><button disabled={busy} onClick={()=>void refresh()} className="min-h-11 rounded border border-neutral-600 px-3 py-2 disabled:opacity-40">{busy?"Rebuilding analytics…":"Retry analytics refresh"}</button>{message&&<p role="alert">{message}</p>}</section>;
}
