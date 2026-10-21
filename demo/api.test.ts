import { describe, it, expect } from "vitest";
import { demoFetch } from "./api";
import data from "./data.json";
import { movementsInRange } from "./movements";

describe("fictional public demo", () => {
  it("serves an evaluated quarterly prediction separately from manual scenarios", async () => {
    const prediction = await (await demoFetch("/api/forecast/prediction")).json();
    expect(prediction.status).toBe("ready");
    expect(prediction.coverage.completeMonths).toBe(48);
    expect(prediction.forecast).toHaveLength(3);
    expect(prediction.test.selected.count).toBe(15);
    expect(prediction.dataHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await demoFetch("/api/analytics/forecast")).status).toBe(410);
  });
  it("reconciles every filtered daily snapshot with the production monthly export", () => {
    for (const scope of Object.values(data.scopes)) expect(movementsInRange(scope.dailyMovements, null, null)).toEqual(scope.movements);
  });

  it("resolves real UUID details and filters and orders the displayed customer rows", async () => {
    const response = await demoFetch("/api/customers?status=active&paymentStatus=failed&sortBy=currentMrr&sortOrder=desc");
    const { customers } = await response.json();
    expect(customers.length).toBeGreaterThan(0);
    expect(customers.every((customer: { status: string; paymentStatus: string }) => customer.status === "active" && customer.paymentStatus === "failed")).toBe(true);
    expect(customers.map((customer: { currentMrr: number }) => customer.currentMrr)).toEqual(customers.map((customer: { currentMrr: number }) => customer.currentMrr).sort((a: number, b: number) => b - a));
    const detail = await (await demoFetch(`/api/customers/${customers[0].id}`)).json();
    expect(detail.customer.name).toBe(customers[0].name);
    expect(detail.customer.currentMrr).toBe(customers[0].currentMrr);
    expect((await demoFetch("/api/customers/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("applies midmonth date bounds and valid scenario inputs without a server", async () => {
    const scope = Object.values(data.scopes)[0];
    const day = scope.dailyMovements.find((point) => point.date.slice(8) !== "01")!;
    const selected = await (await demoFetch(`/api/revenue/movements?from=${day.date}&to=${day.date}`)).json();
    expect(selected.movements).toEqual(day.movements);
    const forecast = await (await demoFetch("/api/forecast/revenue?newMrrGrowth=0&churnRate=0&expansionRate=0")).json();
    expect(forecast.baseline).toHaveLength(12);
    expect(forecast.baseline.every((point: { mrr: number }) => point.mrr === data.forecast.historicalMrr.at(-1)!.mrr)).toBe(true);
    expect((await demoFetch("/api/forecast/revenue?churnRate=NaN")).status).toBe(400);
    expect((await demoFetch("/api/revenue/movements?from=2026-02-30")).status).toBe(400);
  });

  it("serves bounded cohort combinations and refuses mutations and auth endpoints", async () => {
    const catalog = Object.values(data.scopes)[0].logo;
    const filtered = await (await demoFetch(`/api/cohorts/logo-retention?segment=${encodeURIComponent(catalog.segments[0])}&plan=${encodeURIComponent(catalog.plans[0])}`)).json();
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows).not.toEqual(catalog.rows);
    expect((await demoFetch("/api/dataset/restore", { method: "POST" })).status).toBe(405);
    expect((await demoFetch("/api/auth/session")).status).toBe(404);
    const controller = new AbortController();
    controller.abort();
    await expect(demoFetch("/api/revenue/summary", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
