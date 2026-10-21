import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getDatasetContext } from "@/lib/dataset";
import type { CohortData } from "@/lib/cohorts";
import type { RevenueMovement } from "@/lib/revenue";

// Legacy pure calculations are retained as a test oracle; every runtime uses dbt.
export const isWarehouseRuntime = () => process.env.NODE_ENV !== "test" || process.env.REV_ANALYTICS_ENABLED === "true";
const n = (value: unknown) => Number(value ?? 0);
const r = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const month = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

export async function requireWarehouseReady(db: Pick<Prisma.TransactionClient, "datasetMetadata"> = prisma) {
  const metadata = await db.datasetMetadata.findUnique({ where: { id: "local" } });
  if (metadata && (metadata.pipelineStatus !== "ready" || metadata.analyticsRevision !== metadata.revision)) {
    throw new Error("analytics_pending: Data saved; refresh analytics from Data workspace.");
  }
  return metadata;
}

export async function warehouseHistory() {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const rows = await tx.$queryRaw<{ month: Date; mrr: Prisma.Decimal }[]>`SELECT month,sum(mrr) as mrr FROM analytics.mart_mrr_by_month WHERE scope_plan='' GROUP BY month ORDER BY month`;
  return rows.map(row => ({ month: month(row.month), mrr: n(row.mrr) }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function warehouseSummary() {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const context = await getDatasetContext(tx);
  const rows = await tx.$queryRaw<Record<string, Prisma.Decimal | bigint | Date>[]>`SELECT month,
    sum(mrr) as mrr,sum(opening_mrr) as opening_mrr,sum(customer_count) as customers,
    sum(opening_customers) as opening_customers,sum(churned_customers) as churned_customers,
    sum(retained_mrr) as retained_mrr,sum(gross_retained_mrr) as gross_retained_mrr,sum(churned_mrr) as churned_mrr
    FROM analytics.mart_mrr_by_month WHERE scope_plan='' GROUP BY month ORDER BY month`;
  const latest = rows.at(-1) ?? {};
  const mrr = n(latest.mrr), opening = n(latest.opening_mrr), customers = n(latest.customers);
  const logoChurn = n(latest.opening_customers) ? r(n(latest.churned_customers) / n(latest.opening_customers)) : 0;
  const arpa = customers ? mrr / customers : 0;
  return { as_of: context.asOf.toISOString(), dataset_kind: context.kind,
    current_mrr: r(mrr, 2), opening_mrr: r(opening, 2), current_arr: r(mrr * 12, 2), customer_count: customers,
    period_start: new Date(Date.UTC(context.asOf.getUTCFullYear(), context.asOf.getUTCMonth(), 1)).toISOString(),
    mrr_growth_rate: opening ? r((mrr - opening) / opening) : 0,
    nrr: opening ? r(n(latest.retained_mrr) / opening) : 0,
    grr: opening ? r(n(latest.gross_retained_mrr) / opening) : 0,
    logo_churn_rate: logoChurn, revenue_churn_rate: opening ? r(n(latest.churned_mrr) / opening) : 0,
    arpa: r(arpa, 2), ltv: logoChurn ? r(arpa / logoChurn, 2) : null,
    mrr_history: rows.slice(-12).map(row => ({ month: month(row.month as Date), mrr: n(row.mrr) })),
  };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function warehouseMovements(filters: { from?: Date; to?: Date; segment?: string; plan?: string } = {}): Promise<RevenueMovement[]> {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT month,
    sum(new_mrr) as new_mrr,sum(expansion_mrr) as expansion_mrr,sum(contraction_mrr) as contraction_mrr,
    sum(churned_mrr) as churned_mrr,sum(reactivation_mrr) as reactivation_mrr,sum(stable_mrr) as stable_mrr
    FROM analytics.mart_revenue_movements WHERE lower(scope_plan)=lower(${filters.plan ?? ""})
    AND (${filters.segment ?? ""}='' OR lower(industry)=lower(${filters.segment ?? ""}))
    AND change_at>=${filters.from ?? new Date("0001-01-01T00:00:00Z")} AND change_at<=${filters.to ?? new Date("9999-12-31T23:59:59Z")}
    GROUP BY month ORDER BY month`);
  return rows.map(row => ({ month: month(row.month as Date), new_mrr: n(row.new_mrr), expansion_mrr: n(row.expansion_mrr),
    contraction_mrr: n(row.contraction_mrr), churned_mrr: n(row.churned_mrr), reactivation_mrr: n(row.reactivation_mrr), stable_mrr: n(row.stable_mrr) }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function warehouseCohorts(kind: "logo" | "revenue", filters: { segment?: string; plan?: string } = {}): Promise<CohortData> {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const context = await getDatasetContext(tx);
  const rows = await tx.$queryRaw<{ cohort: Date; period_offset: number; size: Prisma.Decimal; retained: Prisma.Decimal }[]>(Prisma.sql`
    SELECT cohort,period_offset,sum(${kind === "logo" ? Prisma.raw("cohort_customers") : Prisma.raw("acquisition_mrr")}) as size,
    sum(${kind === "logo" ? Prisma.raw("retained_customers") : Prisma.raw("retained_mrr")}) as retained
    FROM analytics.mart_cohort_retention WHERE lower(scope_plan)=lower(${filters.plan ?? ""})
    AND (${filters.segment ?? ""}='' OR lower(industry)=lower(${filters.segment ?? ""})) GROUP BY cohort,period_offset ORDER BY cohort,period_offset`);
  const catalog = await tx.$queryRaw<{ industry: string; plan_name: string }[]>`SELECT DISTINCT industry,plan_name FROM analytics.stg_app__subscriptions`;
  const grouped = new Map<string, { cohort: string; cohortSize: number; retention: number[] }>();
  for (const row of rows) {
    const key = month(row.cohort);
    const entry = grouped.get(key) ?? { cohort: key, cohortSize: n(row.size), retention: [] };
    entry.retention[row.period_offset] = n(row.size) ? r(n(row.retained) / n(row.size)) : 0;
    grouped.set(key, entry);
  }
  return { asOf: context.asOf.toISOString(), rows: [...grouped.values()], maxMonths: Math.max(0, ...rows.map(row => row.period_offset)),
    segments: [...new Set(catalog.map(row => row.industry))].sort(), plans: [...new Set(catalog.map(row => row.plan_name))].sort() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function warehousePlanRetention() {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const rows = await tx.$queryRaw<{ plan: string; sample: bigint; active: bigint }[]>`SELECT scope_plan as plan,count(*) as sample,count(*) filter(where active) as active
    FROM analytics.fact_customer_monthly WHERE scope_plan<>'' AND month=(SELECT date_trunc('month',as_of)::date FROM analytics.stg_dataset)
    GROUP BY scope_plan ORDER BY count(*) DESC,scope_plan`;
  return rows.map(row => ({ plan: row.plan, sampleSize: n(row.sample), retentionRate: n(row.sample) ? r(n(row.active) / n(row.sample)) : 0 }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function warehouseSegmentRetention() {
  return prisma.$transaction(async tx => {
  await requireWarehouseReady(tx);
  const rows = await tx.$queryRaw<{ segment: string; sample: bigint; active: bigint }[]>`SELECT label.segment,count(*) as sample,count(*) filter(where f.active) as active
    FROM analytics.fact_customer_monthly f JOIN analytics.stg_app__customers c USING(customer_id)
    CROSS JOIN LATERAL (VALUES ('Industry: '||c.industry),('Size: '||c.company_size),('Country: '||c.country)) label(segment)
    WHERE scope_plan='' AND month=(SELECT date_trunc('month',as_of)::date FROM analytics.stg_dataset)
    GROUP BY label.segment ORDER BY count(*) DESC,label.segment`;
  return rows.map(row => ({ segment: row.segment, sampleSize: n(row.sample), retentionRate: n(row.sample) ? r(n(row.active) / n(row.sample)) : 0 }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
