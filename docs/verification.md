# Finalization verification - 21 October 2026

Implementation revision: `46316c469ad1da51932a19778164e04e0c05187e`. Presentation-only files follow in the release commit. Checks used disposable fictional databases and a fresh owner workspace outside the repository; the user's existing owner database and credentials were not inspected.

## Executed locally

| Command / check | Observed result | Evidence and limits |
| --- | --- | --- |
| `pnpm test --maxWorkers=2` | 186 passed, 24 files | Includes all-month cohort rendering, visible unfavorable horizon comparison, pending history, checkpoint validation, owner guards and offline-service guidance |
| `pnpm exec tsc --noEmit` | Passed after correcting the new test's Testing Library option | Also checked by the production Next build |
| `pnpm lint` | Passed: 0 errors, 18 pre-existing unused-symbol warnings | No warning threshold was relaxed |
| `python -m pytest -q` with `REV_TEST_DATABASE_URL` | 15 passed | Python 3.12.9; real PostgreSQL 17, raw/dbt MRR reconciliation, changed/removed/reappearing customers AND plans, actual process-tree interruption and idempotent retry; one upstream FastAPI/httpx deprecation warning |
| `pnpm exec tsx scripts/verify-predictive.ts` | 13 checks passed | Genuine two-connection advisory-lock contention and stale revision rejection; real checkpoint write failure; full business-table and every native SCD2-attribute v2 round-trip; pending discard; later checkpoint restore; legacy v1; transaction rollback; stable plan identity |
| `python scripts/verify-artifacts.py` | All five reports passed | Required names, input hashes, dates, finite values, counts, ordered/nested intervals, recalculated held-out MAE/WAPE/coverage; existing 1% MAE and 0.01% point tolerances retained, including rounding floors |
| Artifact corruption regression checks | Passed in Python suite | Reject MAE multiplied by 1,000, lower bound above point forecast, wrong WAPE/count, missing reports and nonfinite values |
| `pnpm demo:export` and `pnpm exec tsx scripts/verify-demo.ts` | Passed | 60 fictional customers, 191 intervals, 24 scopes, MRR USD 16,277.88; monthly movements reconcile |
| `pnpm demo:build` | Passed | Existing Vite >500 kB chunk warning remains; no budget was increased |
| `scripts/start-local.ps1 -Mode Check` and full launcher | Passed in an isolated runtime | Fresh cluster, locked Python install, migrations, Next production build and loopback Python/Next startup. Ports 3131/55441/8131 were isolated test overrides; default instructions remain 3101/55433/8101 |
| Final production Next build | Passed | Data workspace is dynamic; client pages consume authenticated runtime APIs |
| `scripts/build-case.py` | Four pages; PDF below 25 MB | Structured source + actual reports; six 1600 x 1200 images; clickable links; ZIP contents/hash comparison; all pages rendered and visually inspected |

The verification copy was compared byte-for-byte after newline normalization against the implementation files. It reused isolated dependencies to avoid working against an owner dataset. No test count is hardcoded in the presentation generator.

## Reproduce database verification

The complete, executed environment and command sequence is versioned in [the release workflow](../.github/workflows/pages.yml): PostgreSQL 17, two disposable databases, locked Node/Python dependencies, migrations, test flags, artifact regeneration and both builds. It supplies a reproducible reference without reading a local owner's credentials.

For local integration, create and migrate a separate loopback database named `revlens_test`; these checks intentionally replace its fictional fixtures. Set `DATABASE_URL` and `REV_TEST_DATABASE_URL` to that database, and `REV_ANALYTICS_RUNTIME` to an absolute private directory outside the repository. Set `LOCAL_WORKSPACE_MODE=true`, `NEXT_PUBLIC_LOCAL_WORKSPACE_MODE=true`, `REV_ANALYTICS_ENABLED=true`, `DEMO_MODE=false` and `NEXT_PUBLIC_DEMO_MODE=false`, as in the workflow's integration step. Then run:

```sh
uv sync --frozen --all-groups --python 3.12
pnpm exec prisma generate
pnpm db:deploy
uv run python -m pytest -q
pnpm exec tsx scripts/verify-predictive.ts
```

Without `REV_TEST_DATABASE_URL`, pytest skips PostgreSQL integration tests; that is not a complete release verification. The separate `revlens_demo` database and seed/export commands in the workflow reproduce public artifacts. The artifact checker compares regenerated output with the Git version and is not a replacement for executing that pipeline.

## Connected Chrome flow

Used the existing Chrome extension and a fresh disposable local owner, with no alternative account session.

1. Uploaded the intentionally invalid 191-row CSV. Preview rejected a zero-length interval and future/incoherent customer facts; import was unavailable and revision remained 0.
2. Uploaded the valid CSV, confirmed complete coverage from October 2022, reviewed revision 0, 60 customers / 191 intervals and USD 16,277.88 MRR, then committed. Real dbt and forecast completed.
3. Viewed the 48-month prediction, selected ETS method, horizon MAE/baseline and 6/5/4 test counts. Exported prediction and scenario JSON. Keyboard scenario controls changed the manual assumption independently.
4. Downloaded a v2 backup. Stopped only the disposable Python listener. Restore saved a checkpoint, preserved records and returned explicitly restored / analytics pending.
5. Attempting another restore of pending revision 3 required its exact discard confirmation. Downloaded its checkpoint and independently verified checksum, pending status, all 60 customers and 191 intervals.
6. Customer detail remained accessible at pending revision 4 and hid earlier versions under Attribute capture pending.
7. Restored the downloaded checkpoint itself, with another exact revision confirmation, producing revision 5. A temporarily unavailable dbt executable in the disposable runtime exercised failed startup and retry; the executable was restored. The Chrome Retry analytics refresh action recovered the real pipeline and prediction. A new tab in the SAME Chrome session confirmed revision 5 ready and the original evaluated values, without console errors.
8. Inspected desktop and 390 px mobile layouts, light and dark themes, menu navigation, keyboard tabs/sliders, scrollable horizon comparisons and cohorts through M47. Both cohort tables have 50 columns (identity + size + 48 months); first-column labels are sticky. Mobile document width and scroll width both measured 375 CSS px after the browser's scrollbar, so no page-level horizontal overflow was observed.

The earlier upload Failed to fetch did not reproduce: both files uploaded and parsed in connected Chrome. Its original transient cause cannot be established retrospectively. A separate offline-Python fetch failure was reproduced and now yields actionable recovery guidance. A stale tab-control timeout was resolved by opening a fresh tab in the same connected Chrome, preserving the session.

## Presentation and release

The English first page names the input, deliverables, insufficient-history path and limitations. Horizon 1's unfavorable result, pooled scores, retail distinction, counts and coverage derive from the reports. Capture notes distinguish public artifacts from local fictional test revisions. Six current images replace the old screenshot set. The package contains no personal contact details or private-project references.

The public repository and Pages release use the main CI workflow. The final client-facing README revision, `bde297b`, contains the single README-changing commit in this finalization. Its content and all implementation files match release run in [run 39644182643](https://github.com/Wild-Badger/revlens/actions/runs/39644182643): 186 TypeScript tests, 15 Python tests including real PostgreSQL integration, recovery checks, all five regenerated reports, typecheck, lint and both builds. Lint retained 18 existing warnings and no errors.

README changes in this finalization were consolidated into one client-facing commit under separate editorial authorization. Implementation and CI changes remain separate; a tree comparison confirms their application, data, model, workflow and demo files match the previously verified implementation. The README generator retains the revised language, and regenerating it produces no diff. Docker/scaffold additions and Upwork actions are excluded.

GitHub Pages reports a successful build of `461582a71b4c0f72b3cc0385d19192285f2d9586`. The final CI generated identical static files, so its normal deployment step preserved that existing commit and branch history. Connected Chrome confirmed the live HTTPS demo in desktop/mobile and both themes: exact forecast and horizon scores, visible comparison before export, both cohort tables through M47, sticky cohort labels, and no mobile page overflow. The installation link resolves to the rendered README's existing heading. README images loaded successfully. Final report-derived PDF figures, clickable links, six image hashes, nine ZIP entries and metadata limits were checked again after generation.

Upwork metadata limits were checked against [official guidance](https://support.upwork.com/hc/en-us/articles/360016144974-How-to-enhance-your-freelancer-profile): title <=70, role <=100, description <=600, at most five tags. Suggested tags remain subject to the account's catalog when the owner authorizes a future upload. The local package is not an Upwork draft.

## Limits

These checks do not demonstrate real-SaaS accuracy, financial impact, customer adoption, security certification, screen-reader compliance or physical mobile-device behavior. Dataset completeness still requires a source-owner declaration. Checkpoints are unencrypted local files, retained until manual archival; the launcher restricts the runtime to the local Windows user. Windows supports file fsync but not the directory fsync used on Unix.

## Cross-platform diagnostic

The original release gate applied 1% tolerance to held-out MAE. During finalization an additional freeze on development candidate slices/selection scores caused CI failures: unscaled ETS optimization varied across platforms/runners even though method selection and all five final-test gates passed. A local Ubuntu run reproduced the stable fixture difference (unselected damped h3: Windows 166.0550; Linux 163.6343; selected level final MAE 77.9260 on both). A scaling prototype was evaluated but not adopted because another candidate failed convergence.

The delivered forecasting engine and reports are unchanged. The gate applies the original 1% tolerance to all five reports' held-out selected/baseline MAEs and their horizons, and 0.01% to their point forecasts. Development checks enforce chronological selection, counts, finite values, weighted MAE consistency and WAPE recalculated from known validation windows. They do not invent a new cross-platform development-score threshold. Corruption checks reject MAE multiplied by 1,000 in both development and held-out results. No original numerical tolerance was widened.
