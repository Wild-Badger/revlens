import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { prisma } from "../lib/db";
import { validateImportCSV, TEMPLATE_CSV } from "../lib/import/csv-validator";
import { importCustomersData } from "../lib/import/import-service";
import { importOptionsSchema } from "../lib/import/options";
import { DatasetConflictError, exportDatasetBackup, restoreDatasetBackup } from "../lib/dataset-backup";
import { getCustomerDetail } from "../lib/customers";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkpointFile } from "../lib/dataset-checkpoints";
import { analyticsService } from "../lib/analytics-service";
import { getRevenueSummary } from "../lib/revenue";

const checks: string[] = [];
function refresh() {
  const result=spawnSync("uv",["run","--no-sync","python","-m","analytics.cli","refresh"],{encoding:"utf8",env:process.env});
  assert.equal(result.status,0,result.stderr?.slice(-2000));
}
async function revision() { return (await prisma.datasetMetadata.findUnique({where:{id:"local"}}))?.revision ?? 0; }
async function save(validation: Parameters<typeof importCustomersData>[1], options: Parameters<typeof importCustomersData>[2]) {
  return importCustomersData(prisma, validation, { ...importOptionsSchema.parse(options), expectedRevision: await revision() });
}
async function restore(backup: unknown) { return restoreDatasetBackup(prisma, backup, { expectedRevision: await revision() }); }
async function main() {
  const database=new URL(process.env.DATABASE_URL??"");
  assert(["localhost","127.0.0.1"].includes(database.hostname)&&database.pathname.endsWith("_test"),"Use only the explicitly disposable *_test database");
  const validation=validateImportCSV(TEMPLATE_CSV);
  assert.deepEqual(validation.errors,[]);
  const options=importOptionsSchema.parse({mode:"new",sourceName:"Integration source"});
  const saved=await save(validation,options);
  assert.equal((await prisma.datasetMetadata.findUniqueOrThrow({where:{id:"local"}})).pipelineStatus,"pending");
  await assert.rejects(()=>save(validation,options),/pending/i);
  checks.push("pending revision blocks another replacement");
  const previousUrl=process.env.REV_ANALYTICS_URL;
  process.env.REV_ANALYTICS_URL="http://127.0.0.1:18109";
  process.env.REV_ANALYTICS_TOKEN="a".repeat(64);
  await assert.rejects(()=>analyticsService("/v1/refresh",saved.revision));
  assert.equal(await prisma.customer.count(),3);
  process.env.REV_ANALYTICS_URL=previousUrl;
  refresh();
  assert.equal((await getRevenueSummary()).current_mrr,200);
  checks.push("Unavailable Python service preserves raw data; refresh recovers real dbt marts");
  const presentedRevision=await revision();
  let concurrentImport: Promise<unknown> | undefined;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261020,2)`;
    concurrentImport=importCustomersData(prisma,validation,{...options,expectedRevision:presentedRevision});
    // Attach immediately so a genuine early rejection cannot become an unhandled promise.
    void concurrentImport.catch(()=>{});
    let waiting=false;
    for (let attempt=0;attempt<100;attempt++) {
      const rows=await tx.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=20261020 AND objid=2 AND NOT granted) AS waiting`;
      if (rows[0].waiting) { waiting=true; break; }
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert(waiting,"Second import must really be waiting on the PostgreSQL lock");
    await tx.datasetMetadata.update({where:{id:"local"},data:{revision:{increment:1},analyticsRevision:{increment:1}}});
  });
  await assert.rejects(()=>concurrentImport!, error=>error instanceof DatasetConflictError && error.code==="revision_conflict");
  assert.equal(await prisma.customer.count(),3);
  checks.push("genuinely concurrent import waits on lock, then rejects the stale presented revision");
  const baseline=await exportDatasetBackup(prisma);
  const privateRuntime=process.env.REV_ANALYTICS_RUNTIME!;
  const blockedStorage=path.join(privateRuntime,"checkpoint-write-failure-probe");
  await writeFile(blockedStorage,"A file cannot hold a checkpoint directory");
  try {
    process.env.REV_ANALYTICS_RUNTIME=blockedStorage;
    await assert.rejects(()=>restore(baseline));
  } finally { process.env.REV_ANALYTICS_RUNTIME=privateRuntime; }
  const afterCheckpointFailure=await exportDatasetBackup(prisma);
  for (const key of ["customers","plans","subscriptions","invoices","payments","productEvents","attributeHistory","metadata"] as const) assert.deepEqual(afterCheckpointFailure[key],baseline[key]);
  checks.push("real filesystem checkpoint failure preserves every business table, SCD2 attribute and revision");
  assert.equal(baseline.schemaVersion,2);
  assert.equal(baseline.attributeHistory?.customers.length,3);
  const source=baseline.metadata!.sourceId;
  await save(validation,{...options,mode:"update"});refresh();
  assert.equal((await exportDatasetBackup(prisma)).attributeHistory?.customers.length,3);
  checks.push("repeat import is idempotent for facts and SCD2");
  const first=validation.validRows[0].customer_id;
  const changed={...validation,validRows:validation.validRows.map(row=>row.customer_id===first?{...row,name:"Renamed Example"}:row)};
  const changedSave = await save(changed,{...options,mode:"update"});
  const pendingCustomer = await prisma.customer.findFirstOrThrow({where:{name:"Renamed Example"}});
  const pendingDetail = await getCustomerDetail(pendingCustomer.id);
  assert.equal(pendingDetail!.attributeHistoryStatus,"pending"); assert.deepEqual(pendingDetail!.attributeHistory,[]);
  assert.equal(pendingDetail!.revision,changedSave.revision);
  await assert.rejects(()=>restoreDatasetBackup(prisma,baseline,{expectedRevision:changedSave.revision}), /uncaptured/i);
  const pendingRestore=await restoreDatasetBackup(prisma,baseline,{expectedRevision:changedSave.revision,discardPendingRevision:changedSave.revision});
  const pendingCheckpoint=JSON.parse(await readFile(await checkpointFile(pendingRestore.checkpointId),"utf8"));
  assert.equal(pendingCheckpoint.backup.metadata.pipelineStatus,"pending");
  assert(pendingCheckpoint.backup.customers.some((row:{name:string})=>row.name==="Renamed Example"));
  refresh();
  await restore(pendingCheckpoint); refresh();
  checks.push("pending raw record stays visible, stale history hidden, explicit revision discard checkpoints uncaptured changes");
  const customer=await prisma.customer.findFirstOrThrow({where:{name:"Renamed Example"}});
  assert.equal((await getCustomerDetail(customer.id))!.attributeHistory.filter(row=>row.entity==="customer").length,2);
  checks.push("changed attributes create an actual SCD2 version");
  const restored = await restore(baseline);refresh();
  const roundtrip = await exportDatasetBackup(prisma);
  for (const table of ["customers","plans","subscriptions","invoices","payments","productEvents","attributeHistory"] as const) assert.deepEqual(roundtrip[table], baseline[table], `Complete v2 round-trip: ${table}`);
  for (const key of ["id","asOf","currency","importedAt","rowCount","sourceId","sourceName","historyStart","historyComplete"] as const) assert.deepEqual(roundtrip.metadata![key], baseline.metadata![key]);
  const checkpoint=JSON.parse(await readFile(await checkpointFile(restored.checkpointId),"utf8"));
  assert(checkpoint.backup.customers.some((row:{name:string})=>row.name==="Renamed Example"));
  await assert.rejects(()=>restoreDatasetBackup(prisma, baseline, {expectedRevision:0}), /changed/i);
  await restore(checkpoint);refresh();
  assert.equal(await prisma.customer.count({where:{name:"Renamed Example"}}),1);
  await restore(baseline);refresh();
  checks.push("checkpoint preserves all raw tables, restores later and rejects a concurrent stale revision");
  assert.equal((await exportDatasetBackup(prisma)).attributeHistory?.customers.length,3);
  assert.equal((await prisma.datasetMetadata.findUniqueOrThrow({where:{id:"local"}})).sourceId,source);
  assert.equal(await prisma.customer.count({where:{name:"Renamed Example"}}),0);
  checks.push("v2 restore preserves source and complete captured history");
  const legacy=JSON.parse(JSON.stringify(baseline));legacy.schemaVersion=1;delete legacy.attributeHistory;
  legacy.metadata=Object.fromEntries(Object.entries(legacy.metadata).filter(([key])=>["id","asOf","currency","importedAt","rowCount"].includes(key)));
  await restore(legacy);refresh();
  assert.equal((await prisma.datasetMetadata.findUniqueOrThrow({where:{id:"local"}})).historyComplete,false);
  checks.push("v1 backup restores without inventing historical coverage");
  const before=await prisma.datasetMetadata.findUniqueOrThrow({where:{id:"local"}});
  await prisma.$executeRawUnsafe("ALTER TABLE customers ADD CONSTRAINT predictive_rollback_probe CHECK (name <> 'Rollback probe') NOT VALID");
  try {
    const invalid={...validation,validRows:validation.validRows.map(row=>row.customer_id===first?{...row,name:"Rollback probe"}:row)};
    await assert.rejects(()=>save(invalid,{...options,mode:"update"}));
    assert.equal(await prisma.customer.count(),3);
    assert.equal((await prisma.datasetMetadata.findUniqueOrThrow({where:{id:"local"}})).revision,before.revision);
  } finally { await prisma.$executeRawUnsafe("ALTER TABLE customers DROP CONSTRAINT predictive_rollback_probe"); }
  checks.push("genuine database failure rolls back raw replacement and revision");
  await save(validation,{...options,mode:"new",sourceName:"Another source"});refresh();
  await assert.rejects(()=>importCustomersData(prisma,validation,{...options,mode:"new",expectedRevision:0}),/changed/i);
  const next=await exportDatasetBackup(prisma);
  assert.notEqual(next.metadata!.sourceId,source);assert.equal(next.attributeHistory?.customers.length,3);
  checks.push("new source gets a new identity and isolated attribute history");
  const catalog = { ...validation, validRows: validation.validRows.map(row => ({ ...row, plan_id: `catalog:${row.plan_name}` })) };
  await save(catalog,{...options,mode:"update"});refresh();
  const plan = await prisma.plan.findFirstOrThrow({where:{name:catalog.validRows[0].plan_name}});
  const revisedCatalog = { ...catalog, validRows: catalog.validRows.map(row => row.plan_id===catalog.validRows[0].plan_id ? {...row,plan_name:"Catalog renamed",billing_interval:"annual" as const,plan_base_price:99} : row) };
  await save(revisedCatalog,{...options,mode:"update"});refresh();
  assert.equal((await prisma.plan.findFirstOrThrow({where:{name:"Catalog renamed"}})).id,plan.id);
  assert.equal((await getCustomerDetail(customer.id))!.attributeHistory.filter(row=>row.entity==="plan" && row.entityId===plan.id).length,2);
  checks.push("explicit plan ID survives rename, billing interval and catalog-price changes");
  console.log(JSON.stringify({result:"PASS",checks,syntheticOnly:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
