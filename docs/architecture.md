# Implemented architecture

The private workspace runs PostgreSQL 17, Next.js 16 and Python 3.12/FastAPI on loopback. The browser authenticates with Next.js. Only the backend calls Python using a private bearer token; no browser CORS or interactive API docs are enabled.

GitHub Pages reuses React screens against fictional exports. Its predictions come from the same engine; it has no upload, private database or live Python compute.

## Import to prediction

1. Validate bounded CSV data, stable IDs, dates, prices and non-overlapping intervals. The preview token binds source and coverage options.
2. Under a PostgreSQL advisory lock, transactionally replace raw records, preserve accounts and increment dataset revision.
3. Python holds the same lock and runs dbt snapshots, views and tests.
4. Mark analytics ready for that revision and cache a private forecast report.
5. Readers require matching raw/analytical revisions and ready status. Failure leaves raw data saved, blocks further replacement and exposes retry.

Series reads use repeatable read. Refresh is bounded and serial; there is no queue or scheduler.

## Storage

- Prisma: raw records, accounts, operational customer/invoice queries and import/restore.
- `analytics`: dbt views for MRR, movements, cohorts and supporting facts.
- `analytics_history`: native snapshots with source-qualified keys, capture-time validity and deletion records.
- Private runtime: credentials, database, environment, logs, dbt target and report cache.
- Checked-in artifacts: fictional MRR and separately attributed real retail aggregates. SHA-256 identifies normalized model input and method version.

## API

| Route | Purpose |
| --- | --- |
| GET /api/forecast/prediction | Authenticated revision-bound forecast, coverage, errors and warnings |
| POST /api/analytics/refresh | Owner/same-origin retry with expected revision |
| GET /api/analytics/status | Pending banner readiness |
| GET /api/forecast/revenue | Separate what-if scenarios |
| GET /api/analytics/forecast | 410 with replacement |
| Python /health | Basic loopback readiness |
| Python /v1/prediction, /v1/refresh | Private bearer-token API |

Local webhooks return 410 to prevent bypassing revision/capture. No external AI API, paid hosting or live CRM integration is required.
