# Operating specification

This replaces the aspirational service specification. The root README describes installation.

Python 3.12 and dependencies are locked in uv.lock: FastAPI/Uvicorn, pandas, NumPy, statsmodels, psycopg and dbt Core/PostgreSQL. Node.js 22.12+, pnpm 10.32.1 and PostgreSQL 17 run the application.

The Windows launcher provisions only its marker-identified cluster, restricts runtime permissions and starts Python as a hidden owned child. It checks readiness and stops its child on exit. Check validates prerequisites; Prepare provisions/migrates/syncs; Build also compiles; Start serves. Startup refresh failure leaves analytics recoverably pending.

Manual setup: configure .env.example with a private loopback database, local-workspace flags, auth settings and a 32+ character private analytics token. Then migrate, sync and run the following in appropriately configured terminals:

```sh
pnpm db:deploy
uv sync --frozen --no-dev --python 3.12
uv run python -m analytics.cli refresh
uv run uvicorn analytics.service:app --host 127.0.0.1 --port 8101
# Separate terminal:
pnpm build
pnpm start --hostname 127.0.0.1 --port 3101
```

Raw import and capture are durable separate stages. A crash after save retains raw records. Revision guards prevent stale reads and ordinary same-source updates while capture is unresolved. Restore requires expectedRevision and, for pending/failed data, an exact discardPendingRevision confirmation. New-source confirmation is bound to the preview revision. Set REV_ANALYTICS_RUNTIME to an absolute private directory outside the repository: replacement/restore fail closed when checkpoints cannot be durably written. Checkpoints are retained in its checkpoints/ directory and contain no authentication data. Restart Python and retry in Data workspace; inspect private dbt-last.log for SQL failures. Identical retries do not fabricate versions. Model failures remain explicit.

CI provisions temporary PostgreSQL, runs unit/database checks, regenerates fictional exports, builds Next.js and Vite and publishes static files only after main passes. No credentials or raw UCI workbook are public.

No Redis/BullMQ jobs, delivered alerts, managed cloud warehouse, daily scheduler or real-time CRM synchronization is claimed. Retained adapters are outside the verified workflow.
