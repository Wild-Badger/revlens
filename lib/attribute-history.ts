import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isWarehouseRuntime } from "@/lib/warehouse";

type Tx = Prisma.TransactionClient;
type SnapshotRow = Record<string, string | number | boolean | null>;
export type AttributeVersion = { entity: "customer" | "plan"; entityId: string; capturedFrom: string; capturedTo: string | null;
  sourceAsOf: string; deleted: boolean; attributes: Record<string, string | number | boolean | null> };
const stamp = (value: string) => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`).toISOString();
const tables = { customer: "analytics_history.customer_attributes", plan: "analytics_history.plan_attributes" } as const;
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
export const snapshotRowsSchema = z.array(z.record(z.string(), scalar)).max(100000);

export async function readSnapshotRows(db: Tx, entity: "customer" | "plan"): Promise<SnapshotRow[]> {
  const relation = tables[entity];
  const exists = await db.$queryRaw<{ present: boolean }[]>(Prisma.sql`SELECT to_regclass(${relation}) IS NOT NULL as present`);
  if (!exists[0]?.present) return [];
  return (await db.$queryRaw<{ row: SnapshotRow }[]>(Prisma.sql`SELECT to_jsonb(s) as row FROM ${Prisma.raw(relation)} s ORDER BY entity_key,dbt_valid_from`)).map(value => value.row);
}

export function validateSnapshotRows(rows: SnapshotRow[], sourceId: string) {
  const ids = new Set<string>();
  const byEntity = new Map<string, SnapshotRow[]>();
  const allowed = new Set(["entity_key", "source_id", "source_as_of", "customer_id", "plan_id", "name", "plan_name", "domain", "industry",
    "company_size", "country", "acquisition_channel", "created_at", "converted_at", "churned_at", "status", "billing_interval",
    "base_price", "seat_price", "dbt_scd_id", "dbt_updated_at", "dbt_valid_from", "dbt_valid_to", "dbt_is_deleted"]);
  for (const row of rows) {
    if (!z.string().uuid().safeParse(row.customer_id ?? row.plan_id).success || ![true,false,"True","False"].includes(row.dbt_is_deleted as boolean | string) || Object.keys(row).some(key => !allowed.has(key)) || row.source_id !== sourceId || typeof row.dbt_scd_id !== "string" || ids.has(row.dbt_scd_id) ||
      typeof row.entity_key !== "string" || row.entity_key !== `${sourceId}:${row.customer_id ?? row.plan_id}` ||
      typeof row.dbt_valid_from !== "string" || !(row.dbt_valid_to === null || typeof row.dbt_valid_to === "string") || typeof row.source_as_of !== "string") throw new Error("Invalid SCD2 identity, fields or source");
    ids.add(row.dbt_scd_id);
    stamp(row.dbt_valid_from); stamp(row.source_as_of);
    if (row.dbt_valid_to !== null && stamp(row.dbt_valid_to) <= stamp(row.dbt_valid_from)) throw new Error("Invalid SCD2 validity interval");
    const group = byEntity.get(row.entity_key) ?? []; group.push(row); byEntity.set(row.entity_key, group);
  }
  for (const versions of byEntity.values()) {
    versions.sort((a,b) => stamp(a.dbt_valid_from as string).localeCompare(stamp(b.dbt_valid_from as string)));
    for (let i=0;i<versions.length-1;i++) {
      if (versions[i].dbt_valid_to === null || stamp(versions[i].dbt_valid_to as string) > stamp(versions[i+1].dbt_valid_from as string)) throw new Error("Overlapping SCD2 versions");
    }
  }
}

export async function resetSnapshotRows(db: Tx) {
  // Fixed identifiers only; source files never supply SQL identifiers.
  await db.$executeRawUnsafe("DO $$ BEGIN IF to_regclass('analytics_history.customer_attributes') IS NOT NULL THEN TRUNCATE analytics_history.customer_attributes; END IF; IF to_regclass('analytics_history.plan_attributes') IS NOT NULL THEN TRUNCATE analytics_history.plan_attributes; END IF; END $$");
}

export async function restoreSnapshotRows(db: Tx, entity: "customer" | "plan", rows: SnapshotRow[]) {
  if (!rows.length) return;
  const relation = Prisma.raw(tables[entity]);
  for (let offset=0;offset<rows.length;offset+=1000) {
    const json = JSON.stringify(rows.slice(offset,offset+1000));
    await db.$executeRaw(Prisma.sql`INSERT INTO ${relation} SELECT * FROM jsonb_populate_recordset(NULL::${relation},${json}::jsonb)`);
  }
}

export async function getAttributeHistory(entity: "customer" | "plan", entityId: string): Promise<AttributeVersion[]> {
  if (!isWarehouseRuntime()) return [];
  const relation = tables[entity];
  const key = entity === "customer" ? "customer_id" : "plan_id";
  const rows = await prisma.$queryRaw<{ row: SnapshotRow }[]>(Prisma.sql`SELECT to_jsonb(s) as row FROM ${Prisma.raw(relation)} s
    WHERE ${Prisma.raw(key)}::text=${entityId} ORDER BY dbt_valid_from DESC`);
  return rows.map(({row}) => ({ entity,entityId,capturedFrom:stamp(row.dbt_valid_from as string),capturedTo:row.dbt_valid_to ? stamp(row.dbt_valid_to as string) : null,
    sourceAsOf:stamp(row.source_as_of as string),deleted:row.dbt_is_deleted === true || row.dbt_is_deleted === "True",
    attributes:Object.fromEntries(Object.entries(row).filter(([field]) => !field.startsWith("dbt_") && !["entity_key","source_id","source_as_of","customer_id","plan_id","created_at","converted_at","churned_at"].includes(field))) }));
}
