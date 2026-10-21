# Implemented architecture

The private workspace runs PostgreSQL 17, Next.js 16 and Python 3.12/FastAPI on loopback. The browser authenticates with Next.js. Only the backend calls Python using a private bearer token; no browser CORS or interactive API docs are enabled.

GitHub Pages reuses React screens against fictional exports. Its predictions come from the same engine; it has no upload, private database or live Python compute.

## Import to prediction

1. Validate bounded CSV data, stable IDs, dates, prices and non-overlapping intervals. The preview token binds CSV content, mapping, source/coverage options and the current revision.
2. Under a PostgreSQL advisory lock, check the expected revision. Before a new source or backup restore, fsync a private checkpoint of every business table, metadata and native snapshots. A failed checkpoint aborts replacement. Then transactionally replace raw records, preserve accounts and increment dataset revision.
3. Python holds the same lock and runs dbt snapshots, views and tests.
4. Mark analytics ready for that revision and cache a private forecast report.
5. Readers require matching raw/analytical revisions and ready status. Failure leaves raw data saved, blocks ordinary same-source updates and exposes retry. Restoring pending/failed data requires revision-specific discard confirmation and a checkpoint before deletion.

Series and customer-detail reads use repeatable read. Customer detail filters snapshots by active source, returns raw/analytical revision IDs, and hides earlier versions during pending capture. Snapshot reset uses DELETE rather than MVCC-unsafe TRUNCATE. The mutable server-rendered Data workspace is explicitly dynamic, so a build cannot freeze empty metadata.

Series reads use repeatable read. Refresh is bounded and serial; there is no queue or scheduler.

## Storage

- Prisma: raw records, accounts, operational customer/invoice queries and import/restore.
- `analytics`: dbt views for MRR, movements, cohorts and supporting facts.
- `analytics_history`: native snapshots with source-qualified keys, capture-time validity and deletion records.
- Private runtime: credentials, database, environment, logs, dbt target and report cache.
- `REV_ANALYTICS_RUNTIME/checkpoints`: retained, versioned SHA-256 checkpoint envelopes. Only business payloads are captured, even when invalid or pending; auth is excluded. Files are synced before replacement, with directory fsync where supported (not available on Windows). Invalid payloads remain downloadable for manual recovery, but restoration never bypasses backup validation. There is no automatic checkpoint deletion.
- Checked-in artifacts: fictional MRR and separately attributed real retail aggregates. SHA-256 identifies normalized model input and method version.

## API

| Route | Purpose |
| --- | --- |
| GET /api/forecast/prediction | Authenticated revision-bound forecast, coverage, errors and warnings |
| POST /api/analytics/refresh | Owner/same-origin retry with expected revision |
| GET /api/analytics/status | Pending banner readiness |
| GET /api/forecast/revenue | Separate what-if scenarios |
| GET /api/analytics/forecast | 410 with replacement |
| POST /api/dataset/restore | Owner/same-origin restore; required expectedRevision; 409 revision_conflict or pending_capture; optional exact discardPendingRevision |
| GET /api/dataset/checkpoints | Authenticated local owner listing; opaque IDs, no filesystem paths |
| GET /api/dataset/checkpoints/:id | Owner-only checkpoint download; input never supplies a path |
| GET /api/import/example | Deterministic 48-month CSV or intentionally invalid example |
| Python /health | Basic loopback readiness |
| Python /v1/prediction, /v1/refresh | Private bearer-token API |

Local webhooks return 410 to prevent bypassing revision/capture. No external AI API, paid hosting or live CRM integration is required.
