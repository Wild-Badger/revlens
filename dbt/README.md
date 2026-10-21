# RevLens analytical project

The local pipeline executes these models and runtime APIs query them.

- Staging: observed raw records and dataset context.
- Marts: customer-month MRR, signed movements, cohorts and supporting facts.
- Snapshots: native check-strategy customer/plan SCD2 including hard-delete records.
- Tests: cutoff, MRR reconciliation, fixed cohort denominators, nonnegative values, uniqueness and relationships.

Staging/marts are views in analytics; snapshots persist in analytics_history. Profiles use environment variables. The Python wrapper derives configuration from the loopback URL, places logs/target in private runtime and coordinates the import lock/readiness.

From root with a migrated configured database:

```sh
uv sync --frozen --python 3.12
uv run python -m analytics.cli refresh
```

This executes dbt build with this project/profile, snapshots and tests. Running dbt alone does not update application revision metadata. First capture cannot reconstruct earlier changes.
