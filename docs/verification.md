# Predictive release verification â€” October 21, 2026

Checks used isolated fictional databases, never private business records or billing credentials.

| Check | Observed result | Scope |
| --- | --- | --- |
| Locked installs | Passed | pnpm standalone install; uv Python 3.12 environment |
| TypeScript/Vitest | 176 tests passed in 22 files | Money/date boundaries, cohorts, import/backup, auth/origin guards and static forecast adapter; six obsolete regression-forecast checks retired with their unused implementation |
| Python unit checks | 5 passed | Temporal leakage, history validation, constant/zero series, candidate failures, deterministic engine and private API auth |
| Python/PostgreSQL integration | Passed | Actual dbt build, raw/monthly reconciliation across 48 months, repeated/changed/deleted/reappearing customer and plan snapshots, failed-process retry |
| Node/PostgreSQL integration | 9 checks passed | Pending barrier, unavailable service recovery, idempotence, changed attributes, v2 full restore, v1 unknown history, real database-error rollback, new-source isolation and stable catalog identity |
| ESLint | 0 errors, 18 existing unused-symbol warnings | Application and test sources |
| Next.js production build | Passed | Local environment; all 45 pages/routes generated; webpack supports linked standalone dependencies |
| Static build/export | Passed | 60 fictional customers, 191 intervals, 24 scopes; raw movements reconcile to MRR $16,277.88 |
| Live Python HTTP | Passed | Loopback health and authenticated report with 48 months and 3 predictions |
| Launcher | Prerequisite and direct-Python service checks passed | Actual authenticated HTTP refresh works from the launcher-style Python process; PostgreSQL refresh also passed with an empty PATH. Full owner-workspace launch was not rerun against user records |
| Chrome extension | Checked | Statistical chart/tables, held-out errors, SCD2 current/superseded states, themes, keyboard tabs and reload persistence |
| Mobile viewport | Checked at 390 Ã— 844 | Forecast readable, no page-level horizontal overflow; wide exact-value tables scroll locally |
| Presentation | Rendered and inspected | Three-page PDF from structured copy/reports; ZIP contains only current media and copy |

## Reproduce the database checks

Configure a dedicated local PostgreSQL database named `revlens_demo`, with private connection settings in the environment. Do not seed a personal dataset. The fixture scripts reject unrelated populated databases. Install locked dependencies and deploy migrations first:

```sh
uv sync --frozen --all-groups --python 3.12
pnpm exec prisma generate
pnpm db:deploy
uv run python -m analytics.cli seed
uv run python -m analytics.cli demo-history
uv run python -m analytics.cli export-report
uv run --group benchmark python -m analytics.cli benchmark
```

For static export set `DEMO_MODE=true`, `DEMO_AS_OF=2026-09-30T23:59:59.999Z` and `REV_ANALYTICS_ENABLED=true` in that shell, then run:

```sh
pnpm demo:export
pnpm exec tsx scripts/verify-demo.ts
pnpm demo:build
```

For destructive fixture checks, create and migrate a separate database ending in `_test`. Set `REV_TEST_DATABASE_URL` to it for Python, then set `DATABASE_URL` to it for Node. Node checks also require `LOCAL_WORKSPACE_MODE=true`, `REV_ANALYTICS_ENABLED=true`, `DEMO_MODE=false` and an isolated `REV_ANALYTICS_RUNTIME` folder:

```sh
uv run python -m pytest analytics/tests/test_pipeline.py -q
pnpm exec tsx scripts/verify-predictive.ts
```

CI contains the complete runnable environment setup with temporary PostgreSQL. The normal Python command intentionally skips the destructive integration check when no explicit test URL is supplied. `scripts/build-case.py` requires reportlab and pypdfium2 in a presentation-only environment; these are not production analytics dependencies.

## Limits

Tests establish implementation behavior, not adoption, accounting coverage for every billing model, production security certification or real SaaS forecast accuracy. Chrome checks used emulated viewport sizes, not real mobile hardware or a screen reader. The public static mode cannot import private records. Live CRM integrations, queue workers and delivered alerts were not verified and are not claimed. Full launcher execution against an existing owner dataset was deliberately avoided; the isolated service, PostgreSQL flow and both builds were exercised separately.
