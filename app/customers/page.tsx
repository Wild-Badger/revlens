"use client";

import { apiFetch, replaceRouteQuery } from "@/lib/api-fetch";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import { PageHeader } from "@portfolio/ui/components/page-header";
import { cn } from "@portfolio/ui/lib/utils";
import { downloadFile, toCsv } from "@/lib/export";

interface CustomerListItem {
  id: string;
  name: string;
  domain: string | null;
  industry: string;
  companySize: string;
  country: string;
  currentMrr: number;
  plan: string | null;
  status: string;
  paymentStatus: "current" | "at_risk" | "failed" | "not_supplied";
  churnRisk: "low" | "medium" | "high" | "not_applicable";
  churnRiskReason: string;
  subscriptionCount: number;
  lastActivityAt: string | null;
}

interface RevenueHistoryPoint {
  month: string;
  mrr: number;
}

interface PlanChange {
  date: string;
  plan: string;
  seats: number;
  mrr: number;
  change: "started" | "upgraded" | "downgraded" | "cancelled" | "reactivated";
}

interface PaymentSummary {
  totalInvoices: number;
  paidInvoices: number;
  failedInvoices: number;
  openInvoices: number;
  totalBilled: number;
  totalPaid: number;
  totalFailed: number;
  lastPaymentStatus: string | null;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  lastFailedInvoiceDate: string | null;
  lastFailedAt: string | null;
}

interface UsageSummary {
  totalEvents: number;
  uniqueEvents: number;
  eventBreakdown: Record<string, number>;
  lastEventAt: string | null;
}

interface CustomerDetail {
  asOf: string;
  id: string;
  name: string;
  domain: string | null;
  industry: string;
  companySize: string;
  country: string;
  acquisitionChannel: string;
  status: string;
  createdAt: string;
  convertedAt: string | null;
  churnedAt: string | null;
  currentMrr: number;
  plan: string | null;
  paymentStatus: "current" | "at_risk" | "failed" | "not_supplied";
  churnRisk: "low" | "medium" | "high" | "not_applicable";
  churnRiskReason: string;
  revenueHistory: RevenueHistoryPoint[];
  planTimeline: PlanChange[];
  paymentSummary: PaymentSummary;
  usageSummary: UsageSummary;
}

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMonth(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
}

function formatLongMonth(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

function statusColor(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/20 text-emerald-400";
    case "churned":
      return "bg-red-500/20 text-red-400";
    case "reactivated":
      return "bg-blue-500/20 text-blue-400";
    case "lead":
      return "bg-amber-500/20 text-amber-400";
    default:
      return "bg-neutral-700 text-neutral-300";
  }
}

function paymentStatusColor(status: string) {
  switch (status) {
    case "current":
      return "bg-emerald-500/20 text-emerald-400";
    case "at_risk":
      return "bg-amber-500/20 text-amber-400";
    case "failed":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-neutral-700 text-neutral-300";
  }
}

function paymentLabel(status: CustomerListItem["paymentStatus"]) {
  return { current: "No flagged invoices", at_risk: "Open invoices", failed: "Failed invoice recorded", not_supplied: "Not supplied" }[status];
}

function churnRiskColor(risk: string) {
  switch (risk) {
    case "low":
      return "bg-emerald-500/20 text-emerald-400";
    case "medium":
      return "bg-amber-500/20 text-amber-400";
    case "high":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-neutral-700 text-neutral-300";
  }
}

function planChangeIcon(change: PlanChange["change"]) {
  switch (change) {
    case "started":
      return "▶";
    case "upgraded":
      return "▲";
    case "downgraded":
      return "▼";
    case "cancelled":
      return "✕";
    case "reactivated":
      return "↻";
    default:
      return "•";
  }
}

function planChangeColor(change: PlanChange["change"]) {
  switch (change) {
    case "started":
    case "reactivated":
      return "text-emerald-400";
    case "upgraded":
      return "text-blue-400";
    case "downgraded":
      return "text-amber-400";
    case "cancelled":
      return "text-red-400";
    default:
      return "text-neutral-400";
  }
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [churnRiskFilter, setChurnRiskFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [asOf, setAsOf] = useState("");
  const [filtersRevision, setFiltersRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState("");
  const [availablePlans, setAvailablePlans] = useState<string[]>([]);

  useEffect(() => {
    const readFilters = () => {
      const params = new URLSearchParams(window.location.search);
      setLoading(true);
      setError("");
      requestId.current++;
      setSearch(params.get("search") ?? "");
      setStatusFilter(params.get("status") ?? "");
      setPlanFilter(params.get("plan") ?? "");
      setPaymentFilter(params.get("paymentStatus") ?? "");
      setChurnRiskFilter(params.get("churnRisk") ?? "");
      setSortBy(params.get("sortBy") ?? "name");
      setSortOrder(params.get("sortOrder") === "desc" ? "desc" : "asc");
      setFiltersRevision((value) => value + 1);
    };
    readFilters();
    window.addEventListener("popstate", readFilters);
    return () => window.removeEventListener("popstate", readFilters);
  }, []);

  useEffect(() => {
    if (drawerOpen && detailDialog.current && !detailDialog.current.open) detailDialog.current.showModal();
  }, [drawerOpen]);

  const fetchCustomers = useCallback(() => {
    if (!filtersRevision) return;
    const currentRequest = ++requestId.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (planFilter) params.set("plan", planFilter);
    if (paymentFilter) params.set("paymentStatus", paymentFilter);
    if (churnRiskFilter) params.set("churnRisk", churnRiskFilter);
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    replaceRouteQuery("/customers", params);

    apiFetch(`/api/customers?${params}`)
      .then((r) => { if (!r.ok) throw new Error("Could not load customer results. Retry after checking the local server."); return r.json(); })
      .then((data) => {
        if (currentRequest !== requestId.current) return;
        setCustomers(data.customers ?? []);
        setAsOf(data.as_of ?? "");
        setLoadedScope(params.toString());
        setAvailablePlans(data.plans ?? []);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (currentRequest !== requestId.current) return;
        setCustomers([]);
        setError(reason instanceof Error ? reason.message : "Customer results could not load.");
        setLoading(false);
      });
  }, [search, statusFilter, planFilter, paymentFilter, churnRiskFilter, sortBy, sortOrder, filtersRevision]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const beginLoading = () => { requestId.current++; setLoading(true); setError(""); };
  const refreshCustomers = () => { beginLoading(); fetchCustomers(); };

  const handleSort = (column: string) => {
    beginLoading();
    if (sortBy === column) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const openDetail = async (customerId: string) => {
    const currentRequest = ++detailRequestId.current;
    setDetailLoading(true);
    setDetailError("");
    setSelectedCustomer(null);
    setDrawerOpen(true);
    try {
      const res = await apiFetch(`/api/customers/${customerId}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Customer not found in this dataset." : "Customer detail could not load. Close and reopen to retry.");
      const data = await res.json();
      if (currentRequest !== detailRequestId.current) return;
      setSelectedCustomer(data.customer ?? null);
    } catch (reason: unknown) {
      if (currentRequest !== detailRequestId.current) return;
      setDetailError(reason instanceof Error ? reason.message : "Customer detail could not load.");
      setSelectedCustomer(null);
    } finally {
      if (currentRequest === detailRequestId.current) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    detailRequestId.current++;
    setDrawerOpen(false);
    setSelectedCustomer(null);
  };

  const sortIndicator = (column: string) => {
    if (sortBy !== column) return "↕";
    return sortOrder === "asc" ? "↑" : "↓";
  };

  const clearFilters = () => {
    if (![search, statusFilter, planFilter, paymentFilter, churnRiskFilter].some(Boolean)) return;
    beginLoading(); setSearch(""); setStatusFilter(""); setPlanFilter(""); setPaymentFilter(""); setChurnRiskFilter("");
  };
  const exportCustomers = () => {
    const scope = loadedScope;
    const rows: (string | number | null)[][] = [["Name", "MRR_USD", "Plan", "Status", "Payment flag", "Risk", "Reason", "As of UTC", "Filters"]];
    for (const customer of customers) rows.push([customer.name, customer.currentMrr, customer.plan, customer.status, customer.paymentStatus, customer.churnRisk, customer.churnRiskReason, asOf, scope]);
    downloadFile(`revlens-customers-${asOf.slice(0, 10) || "export"}.csv`, "\uFEFF" + toCsv(rows));
  };

  const eventChartData = useMemo(() => {
    if (!selectedCustomer) return [];
    return Object.entries(selectedCustomer.usageSummary.eventBreakdown).map(
      ([name, count]) => ({ name, count })
    );
  }, [selectedCustomer]);

  const paymentChartData = useMemo(() => {
    if (!selectedCustomer) return [];
    const ps = selectedCustomer.paymentSummary;
    return [
      { name: "Paid", value: ps.paidInvoices },
      { name: "Open", value: ps.openInvoices },
      { name: "Failed", value: ps.failedInvoices },
    ];
  }, [selectedCustomer]);

  return (
    <>
      <PageHeader
        title="Customer Revenue Explorer"
        description="Find the account, check the evidence, and take a dated summary back to your workflow."
      ><button onClick={exportCustomers} disabled={loading || !!error || !customers.length} className="rounded-md border border-neutral-700 px-3 py-2 text-sm disabled:opacity-40">Export filtered CSV</button></PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search customers..."
          aria-label="Search customers"
          value={search}
          onChange={(e) => { beginLoading(); setSearch(e.target.value); }}
          className="min-w-[200px] rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500"
        />
        <details className="rounded-md border border-neutral-700 px-3 py-2">
        <summary className="cursor-pointer text-sm">Filters{[statusFilter, planFilter, paymentFilter, churnRiskFilter].some(Boolean) ? " · active" : ""}</summary>
        <div className="mt-3 flex flex-wrap gap-3">
        <select
          aria-label="Customer status"
          value={statusFilter}
          onChange={(e) => { beginLoading(); setStatusFilter(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All statuses</option>
          <option value="lead">Lead</option>
          <option value="active">Active</option>
          <option value="churned">Churned</option>
          <option value="reactivated">Reactivated</option>
        </select>
        <select
          aria-label="Subscription plan"
          value={planFilter}
          onChange={(e) => { beginLoading(); setPlanFilter(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All plans</option>
          {availablePlans.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
        </select>
        <select
          aria-label="Supplied invoice evidence"
          value={paymentFilter}
          onChange={(e) => { beginLoading(); setPaymentFilter(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All invoice evidence</option>
          <option value="current">No flagged invoices</option>
          <option value="at_risk">Open invoices</option>
          <option value="failed">Failed invoice recorded</option>
          <option value="not_supplied">Not supplied</option>
        </select>
        <select
          aria-label="Churn risk"
          value={churnRiskFilter}
          onChange={(e) => { beginLoading(); setChurnRiskFilter(e.target.value); }}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">All risks</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="not_applicable">Not applicable</option>
        </select>
        </div>
        </details>
        <button
          onClick={refreshCustomers}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm leading-6 text-neutral-400">Review flags use the supplied invoice, subscription and usage records. A recorded failure can be historical; verify it in your billing system before contacting a customer. These flags do not predict churn or confirm a customer is healthy.</p>

      <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-300">
        <p>{loading ? "Loading customer results…" : error ? "Customer results unavailable" : `${customers.length} customers match`} {asOf && `· As of ${formatDate(asOf)} · USD`}</p>
        <button onClick={clearFilters} className="underline">Clear filters</button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-200">{error} <button onClick={refreshCustomers} className="ml-2 underline">Retry</button></p>}
      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        {loading ? (
          <div className="p-8 text-center text-sm text-neutral-500">Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="p-8 text-center text-sm text-neutral-500">No customers found.</div>
        ) : (
          <table className="customer-table w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/60">
                {[
                  { key: "name", label: "Name" },
                  { key: "currentMrr", label: "MRR" },
                  { key: "plan", label: "Plan" },
                  { key: "status", label: "Status" },
                  { key: "paymentStatus", label: "Invoice evidence" },
                  { key: "churnRisk", label: "Review reason" },
                ].map((col) => (
                  <th
                    key={col.key}
                    aria-sort={sortBy === col.key ? sortOrder === "asc" ? "ascending" : "descending" : undefined}
                    className="cursor-pointer px-4 py-3 text-left font-medium text-neutral-400 hover:text-neutral-200"
                  >
                    <button onClick={() => handleSort(col.key)} className={cn("flex w-full items-center gap-1", col.key === "currentMrr" && "justify-end")} aria-label={`Sort by ${col.label}`}>
                      {col.label}
                      <span className="text-xs text-neutral-400">{sortIndicator(col.key)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  className="cursor-pointer border-b border-neutral-800/50 transition-colors hover:bg-neutral-900/40"
                >
                  <td className="px-4 py-3">
                    <button onClick={() => openDetail(customer.id)} className="text-left font-medium text-neutral-100 underline decoration-neutral-700 underline-offset-4 hover:decoration-emerald-400">{customer.name}</button>
                    {customer.domain && (
                      <div className="text-xs text-neutral-500">{customer.domain}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-100">
                    {formatCurrency(customer.currentMrr)}
                  </td>
                  <td className="px-4 py-3 text-neutral-300">{customer.plan ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                        statusColor(customer.status)
                      )}
                    >
                      {customer.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                        paymentStatusColor(customer.paymentStatus)
                      )}
                    >
                      {paymentLabel(customer.paymentStatus)}
                    </span>
                  </td>
                  <td className="customer-review-reason max-w-sm px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                        churnRiskColor(customer.churnRisk)
                      )}
                    >
                      {customer.churnRisk === "not_applicable" ? "Not scored" : `${customer.churnRisk} priority`}
                    </span>
                    <p className="mt-1 text-sm leading-5 text-neutral-300">{customer.churnRiskReason}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Drawer */}
      {drawerOpen && (
        <dialog ref={detailDialog} onClose={closeDetail} aria-label="Customer details" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-0 text-neutral-100 shadow-2xl backdrop:bg-black/60">
            {detailLoading ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-neutral-500">
                Loading customer details...
              </div>
            ) : !selectedCustomer ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-neutral-500">
                <div><p role="alert">{detailError || "Customer not found."}</p><button onClick={closeDetail} className="mt-3 underline">Close detail</button></div>
              </div>
            ) : (
              <div className="space-y-8 p-6">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-neutral-50">
                      {selectedCustomer.name}
                    </h2>
                    {selectedCustomer.domain && (
                      <p className="mt-1 text-sm text-neutral-400">{selectedCustomer.domain}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          statusColor(selectedCustomer.status)
                        )}
                      >
                        {selectedCustomer.status}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          paymentStatusColor(selectedCustomer.paymentStatus)
                        )}
                      >
                        {paymentLabel(selectedCustomer.paymentStatus)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          churnRiskColor(selectedCustomer.churnRisk)
                        )}
                      >
                        {selectedCustomer.churnRisk === "not_applicable" ? "Not scored" : `${selectedCustomer.churnRisk} review priority`}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={closeDetail}
                    aria-label="Close customer details"
                    className="rounded-md p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                  >
                    ✕
                  </button>
                </div>

                {/* Metric Cards */}
                <dl className="grid grid-cols-3 gap-3 rounded-lg border border-neutral-800 p-4 text-sm">
                  <div className="min-w-0"><dt className="text-neutral-400">Current MRR</dt><dd className="mt-2 break-words text-lg font-semibold">{formatCurrency(selectedCustomer.currentMrr)}</dd></div>
                  <div className="min-w-0"><dt className="text-neutral-400">Plan</dt><dd className="mt-2 break-words text-lg font-semibold">{selectedCustomer.plan ?? "—"}</dd></div>
                  <div className="min-w-0"><dt className="text-neutral-400">Country</dt><dd className="mt-2 text-lg font-semibold">{selectedCustomer.country}</dd></div>
                </dl>

                {/* Churn Risk Reasoning */}
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
                  <h3 className="text-base font-semibold text-neutral-100">Why this needs review</h3>
                  <p className="mt-2 text-sm text-neutral-300">{selectedCustomer.churnRiskReason}</p>
                  <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-neutral-400">Failed invoices in supplied history</dt><dd>{selectedCustomer.paymentSummary.failedInvoices}</dd></div>
                    <div><dt className="text-neutral-400">Latest failed invoice date</dt><dd>{selectedCustomer.paymentSummary.lastFailedInvoiceDate ? formatDate(selectedCustomer.paymentSummary.lastFailedInvoiceDate) : "Not supplied"}</dd></div>
                    <div><dt className="text-neutral-400">Recorded failure timestamp</dt><dd>{selectedCustomer.paymentSummary.lastFailedAt ? formatDate(selectedCustomer.paymentSummary.lastFailedAt) : "Not supplied"}</dd></div>
                    <div><dt className="text-neutral-400">Latest invoice</dt><dd>{selectedCustomer.paymentSummary.lastPaymentStatus ?? "Not supplied"}{selectedCustomer.paymentSummary.lastInvoiceDate ? ` · ${formatDate(selectedCustomer.paymentSummary.lastInvoiceDate)}` : ""}</dd></div>
                  </dl>
                  <p className="mt-3 text-sm leading-6 text-neutral-300">As of {formatDate(selectedCustomer.asOf)}. Source: supplied invoice statuses and subscription/event records. Verify timing and prior contact in your billing system or CRM before outreach.</p>
                  <details className="mt-3 text-sm text-neutral-300"><summary className="cursor-pointer">How this flag is calculated</summary><p className="mt-2 leading-6">Explainable heuristic, not a prediction: failed invoices +3, more than two open invoices +2, MRR below 80% of largest recorded subscription +2, 1–19 supplied events +2, reactivated status +1. Medium ≥2; high ≥4. Missing invoice/usage records are unknown, not adverse evidence. Leads and already-churned accounts are not scored.</p></details>
                </div>

                {/* Revenue History Chart */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-200">Revenue History</h3>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                    {selectedCustomer.revenueHistory.length === 0 ? (
                      <div className="py-8 text-center text-sm text-neutral-500">
                        No revenue history available.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={selectedCustomer.revenueHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                          <XAxis
                            dataKey="month"
                            tickFormatter={formatMonth}
                            stroke="#71717a"
                            fontSize={12}
                          />
                          <YAxis
                            tickFormatter={(value) =>
                              compactCurrencyFormatter.format(value)
                            }
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
                            stroke="#38bdf8"
                            strokeWidth={2}
                            dot={{ r: 3, fill: "#38bdf8" }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Plan Timeline */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-200">Plan Timeline</h3>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                    {selectedCustomer.planTimeline.length === 0 ? (
                      <div className="py-4 text-center text-sm text-neutral-500">
                        No subscription history.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selectedCustomer.planTimeline.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 text-sm"
                          >
                            <span className={cn("text-lg", planChangeColor(item.change))}>
                              {planChangeIcon(item.change)}
                            </span>
                            <div className="flex-1">
                              <span className="font-medium text-neutral-200">
                                {item.plan}
                              </span>{" "}
                              <span className="text-neutral-500">
                                — {formatCurrency(item.mrr)} ({item.seats} seats)
                              </span>
                            </div>
                            <span className="text-xs text-neutral-500">
                              {formatDate(item.date)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment Summary */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-200">Payment Summary</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-neutral-500">Total Billed</p>
                          <p className="mt-1 text-lg font-semibold text-neutral-100">
                            {formatCurrency(selectedCustomer.paymentSummary.totalBilled)}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Paid invoice amount</p>
                          <p className="mt-1 text-lg font-semibold text-emerald-400">
                            {formatCurrency(selectedCustomer.paymentSummary.totalPaid)}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Failed Amount</p>
                          <p className="mt-1 text-lg font-semibold text-red-400">
                            {formatCurrency(selectedCustomer.paymentSummary.totalFailed)}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Last Invoice</p>
                          <p className="mt-1 text-lg font-semibold text-neutral-100">
                            {selectedCustomer.paymentSummary.lastPaymentStatus ?? "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={paymentChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                          <XAxis
                            dataKey="name"
                            tick={{ fill: "#9ca3af", fontSize: 12 }}
                          />
                          <YAxis
                            tick={{ fill: "#9ca3af", fontSize: 12 }}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#18181b",
                              border: "1px solid #27272a",
                              color: "#fafafa",
                            }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {paymentChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={
                                  entry.name === "Paid"
                                    ? "#10b981"
                                    : entry.name === "Open"
                                      ? "#f59e0b"
                                      : "#ef4444"
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Usage Summary */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-neutral-200">Usage Summary</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-neutral-500">Total Events</p>
                          <p className="mt-1 text-lg font-semibold text-neutral-100">
                            {selectedCustomer.usageSummary.totalEvents.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Unique Events</p>
                          <p className="mt-1 text-lg font-semibold text-neutral-100">
                            {selectedCustomer.usageSummary.uniqueEvents}
                          </p>
                        </div>
                        <div>
                          <p className="text-neutral-500">Last Activity</p>
                          <p className="mt-1 text-lg font-semibold text-neutral-100">
                            {selectedCustomer.usageSummary.lastEventAt
                              ? formatDate(selectedCustomer.usageSummary.lastEventAt)
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={eventChartData} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                          <XAxis
                            type="number"
                            tick={{ fill: "#9ca3af", fontSize: 12 }}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={100}
                            tick={{ fill: "#9ca3af", fontSize: 11 }}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#18181b",
                              border: "1px solid #27272a",
                              color: "#fafafa",
                            }}
                          />
                          <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={16} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}
        </dialog>
      )}
    </>
  );
}
