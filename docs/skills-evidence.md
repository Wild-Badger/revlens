# Reproducible skills evidence

| Skill | Code | Command | Interface | Limitation |
| --- | --- | --- | --- | --- |
| Python/statistical modeling | analytics/forecast.py | uv run python -m pytest analytics/tests/test_forecast.py | Methods, intervals, errors | Univariate MRR; no individual churn or causal inference |
| Temporal evaluation | analytics/forecast.py, analytics/benchmark.py | uv run --group benchmark python -m analytics.cli benchmark | Baseline, windows, counts, coverage | Small overlapping holdout; synthetic MRR is not real SaaS validation |
| SQL/dbt | dbt/models, dbt/tests, lib/warehouse.ts | uv run python -m analytics.cli refresh | MRR and retention marts | Local views, no managed warehouse |
| PostgreSQL/SCD2 | dbt/snapshots, lib/attribute-history.ts | uv run python -m pytest analytics/tests/test_pipeline.py | Captured customer/plan versions | Requires isolated fixture URL; starts with observation |
| Integrity/recovery | lib/import, lib/dataset-backup.ts | pnpm exec tsx scripts/verify-predictive.ts | Preview, pending, retry and backup | Dedicated migrated _test DB; bounded USD inputs |
| Full-stack | app, analytics/service.py | pnpm build; scripts/start-local.ps1 | Authenticated local workflow | Loopback, single operator |
| Visualization/UX | components/statistical-forecast.tsx | pnpm demo:build; Chrome inspection | Dark/light, tables, exports, keyboard tabs | Not screen-reader certification |
| Reproducible delivery | CI, scripts/build-case.py, docs/portfolio-case.json | python scripts/build-case.py (PDF tools required) | Demo, PDF and ZIP | Public static exports, private local compute |

See verification instructions for database commands. No adoption, revenue uplift, LLM engineering, cloud operations or alert-delivery claim is made.
