import rawData from "./data.json";
import { filterCustomerList } from "../lib/customer-filter";
import { buildForecastScenarios } from "../lib/forecast-scenario";
import { scopeKey, type DemoData } from "./types";
import { movementsInRange } from "./movements";

const data = rawData as unknown as DemoData;
const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function validDate(value: string | null) {
  if (value === null) return true;
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function demoFetch(input: string, init?: RequestInit): Promise<Response> {
  init?.signal?.throwIfAborted();
  if (init?.method && init.method.toUpperCase() !== "GET") return error("The public fictional demo is read-only. Use the local app for your own files.", 405);
  const url = new URL(input, "https://revlens.example");
  const params = url.searchParams;
  const path = url.pathname;
  if (path === "/api/forecast/prediction") return Response.json(data.prediction);
  if (path === "/api/analytics/forecast") return error("Legacy forecast retired; use /api/forecast/prediction",410);
  if (path === "/api/revenue/summary") return Response.json(data.summary);
  if (path === "/api/customers") {
    const options = Object.fromEntries(params);
    if ((options.sortOrder && !["asc", "desc"].includes(options.sortOrder)) ||
      (options.sortBy && !["name", "currentMrr", "plan", "status", "paymentStatus", "churnRisk"].includes(options.sortBy))) return error("Invalid customer sort.");
    const ids = options.plan ? new Set(data.planMembership[options.plan] ?? []) : null;
    const customers = filterCustomerList(ids ? data.customers.filter((customer) => ids.has(customer.id)) : data.customers,
      { ...options, sortOrder: options.sortOrder === "desc" ? "desc" : "asc" });
    return Response.json({ customers, as_of: data.summary.as_of, plans: data.plans });
  }
  const detail = path.match(/^\/api\/customers\/([a-f\d-]+)(\/revenue-history)?$/i);
  if (detail) {
    const customer = data.details[detail[1]];
    if (!customer) return error("Customer not found", 404);
    return Response.json(detail[2] ? data.histories[detail[1]] : { customer });
  }
  if (path === "/api/forecast/revenue") {
    const assumptions: Partial<typeof data.forecast.assumptions> = {};
    for (const key of ["newMrrGrowth", "churnRate", "expansionRate"] as const) {
      if (!params.has(key)) continue;
      const value = Number(params.get(key));
      if (!Number.isFinite(value) || value < 0 || value > (key === "churnRate" ? 1 : 2)) return error("Invalid scenario rate.");
      assumptions[key] = value;
    }
    return Response.json(buildForecastScenarios(data.forecast.historicalMrr, data.forecast.asOf, assumptions));
  }
  if (path === "/api/cohorts/plan-retention") return Response.json(data.planRetention);
  if (path === "/api/cohorts/segment-retention") return Response.json(data.segmentRetention);
  const scope = data.scopes[scopeKey(params.get("segment")?.trim(), params.get("plan")?.trim())];
  if (!scope) return error("Choose an industry and plan offered by this fictional dataset.");
  if (path === "/api/cohorts/logo-retention") return Response.json(scope.logo);
  if (path === "/api/cohorts/revenue-retention") return Response.json(scope.revenue);
  if (path === "/api/analytics/churn") return Response.json(scope.churn);
  if (path === "/api/revenue/movements") {
    const from = params.get("from"), to = params.get("to");
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) return error("Invalid date range.");
    return Response.json({ movements: from || to ? movementsInRange(scope.dailyMovements, from, to) : scope.movements });
  }
  return error("This action is available in the local app. The public demo only serves fictional analysis data.", 404);
}
