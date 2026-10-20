# Release verification — October 20, 2026

The release was checked from a separate standalone installation with the committed package manifest and lockfile. It did not depend on the original parent workspace.

| Check | Result | Scope |
| --- | --- | --- |
| Frozen dependency install | Passed | Node.js, pnpm 10.32.1; install scripts disabled, Prisma generated explicitly |
| TypeScript | Passed | Application, API, demo adapter and test sources |
| Vitest | 180 tests passed in 22 files | Revenue/date boundaries, retention, customer evidence, imports, backup, auth/origin boundaries, themes and static adapter |
| ESLint | No errors | 19 existing unused-symbol warnings in legacy/admin/test sources |
| Next.js production build | Passed | Dedicated local workspace and PostgreSQL, all 42 routes generated |
| Static production build | Passed | Vite; no database or credentials required by the published assets |
| Dedicated PostgreSQL integration | 10 checks passed | Synthetic template import, repeat import, business-data backup/restore and transaction rollback after a genuine database failure |
| Synthetic snapshot export | Passed | 60 fictional accounts, 66 intervals, 40 industry/plan scopes; date-filtered daily movements reconcile to the production monthly result |
| Chrome UI | Passed for checked flows | Overview, customer search/reload/detail/Escape, theme persistence, editable forecast and scenario download |
| Mobile viewport | Checked at 390 × 844 | Retention has compact KPIs and collapsed tables, with no page-level horizontal overflow |

The demo's MRR is **$22,134**, with **36 active customers**, at the fixed September 30, 2026 snapshot. These are fictional values used to check calculation consistency, not business results.

Changing scenario acquisition from 5% to 0%, while keeping churn and expansion at 2% each, produced a flat baseline: annual run rate after twelve months remained $265,608. This confirms that the control changes the calculation; it does not validate a predictive model.

The local integration uses only a dedicated known synthetic dataset. Its scripts refuse an unrecognized database or an unrelated populated dataset. No real customer files or third-party billing credentials were used.

## Practical limits

- Tests and browser observations are implementation checks, not proof of customer adoption, accounting correctness for every billing model, or production security certification.
- The public Pages app runs the analytics UI against exported fictional data. It has no owner login, private import endpoint, restore endpoint or hosted PostgreSQL server.
- The full local application is single-operator and USD-only. Its importer supports non-overlapping dated price intervals for each customer, not every possible concurrent billing arrangement.
- Live Stripe/CRM integrations, arbitrary cloud deployments, screen-reader behavior and real mobile hardware were not verified in this release.
- Forecast inputs are illustrative assumptions. Review flags and implied LTV remain heuristics, not calibrated predictions.
