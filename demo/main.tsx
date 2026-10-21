import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardShell } from "@/app/dashboard-shell";
import DashboardPage from "@/app/dashboard/page";
import CustomersPage from "@/app/customers/page";
import RetentionPage from "@/app/retention/page";
import MovementsPage from "@/app/movements/page";
import ChurnPage from "@/app/churn/page";
import ForecastPage from "@/app/forecast/page";
import { usePathname } from "./navigation";
import "@/app/globals.css";

function LocalWorkspace() {
  return <section className="max-w-3xl space-y-5 rounded-lg border border-neutral-800 p-6">
    <p className="text-sm font-medium text-emerald-300">Fictional portfolio demonstration</p>
    <h1 className="text-2xl font-semibold">Use your own data in the local app</h1>
    <p className="text-base leading-7 text-neutral-300">This public demo is read-only. Its 60 fictional customers and dated subscription intervals demonstrate the same analytics pages and calculations as the local application.</p>
    <p className="text-base leading-7 text-neutral-300">CSV preview, import, account access and backup restore are available in the local version. Set it up on your computer to work with your own files. This demo has no upload service.</p>
    <a className="inline-block rounded-md bg-emerald-700 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-800" href="https://github.com/Wild-Badger/revlens#run-your-private-workspace" target="_blank" rel="noreferrer">Local app setup and source ↗</a>
    <p className="text-sm text-neutral-400">USD only · subscription MRR, not cash collected · synthetic snapshot: September 30, 2026.</p>
  </section>;
}

const pages = {
  "/dashboard": DashboardPage,
  "/customers": CustomersPage,
  "/retention": RetentionPage,
  "/movements": MovementsPage,
  "/churn": ChurnPage,
  "/forecast": ForecastPage,
  "/data": LocalWorkspace,
  "/import": LocalWorkspace,
};

function App() {
  const path = usePathname();
  const Page = pages[path as keyof typeof pages] ?? DashboardPage;
  return <DashboardShell><Page key={path} /></DashboardShell>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
