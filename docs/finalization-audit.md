# Finalization audit closure

The persona improvement loop remains paused. This closure implements the agreed data-integrity, evidence and delivery scope; it adds no model or paid service.

| Finding | Correction | Reproducible evidence |
| --- | --- | --- |
| Restore or source replacement could discard raw records / SCD2 without a durable checkpoint | Shared business-only raw capture; fsynced checksum envelope outside the repo; failure aborts replacement | dataset-backup unit checks; verify-predictive real filesystem failure and complete round-trip |
| A stale or pending revision could be replaced without a specific confirmation | expectedRevision under the advisory lock; pending_capture 409; exact discardPendingRevision; CSV preview binds the revision | Real two-connection lock contention; connected Chrome pending-restore confirmation |
| Backup validation did not enforce the CSV's temporal boundaries | Shared interval, fact-date and coverage checks; adjacent intervals allowed; capture/export dates remain separate | Unit overlap, zero-length, future fact / coverage and valid adjacent-interval cases |
| Raw customer data could be displayed alongside stale or different-source history | Repeatable-read transaction for metadata/raw/SCD2, active-source filter, explicit revision/status; pending versions hidden; MVCC-safe DELETE on reset | Customer-detail checks, real pending Chrome view and exported static contract |
| Artifact checks could accept MAE x1,000 or invalid bounds | Validate all five reports; recompute final test metrics/coverage; preserve numerical tolerances | test_artifacts corruption checks and verify-artifacts.py |
| Horizon comparison was hidden; mobile export preceded evidence; cohorts stopped at M11 | Comparison before export, explicit validation-selection explanation, every observed month with keyboard-scroll regions / sticky identifiers | Rendered UI checks and connected Chrome M47 / mobile inspection |
| Installation link targeted an obsolete README anchor | Link targets run-your-private-workspace | Source and public demo check |
| Data workspace was frozen as empty at build time (found during final Chrome QA) | Explicit force-dynamic server page | Empty-to-imported state now reflects mutable metadata without rebuilding |
| Successful restore cleared React's file while leaving the native selected filename | Retain the selected backup and reset its confirmation | Repeated restore of the same selected backup reached the pending-specific guard in Chrome |
| Offline Python could expose an unhelpful fetch failed message | Shared analytics-service network failure has recovery guidance | Unit regression and browser failure/retry |
| Old screenshots and generic case copy weakened the service evidence | Single structured copy source, dynamic evaluated figures, four-page English case, six current images / hashes, bounded Upwork fields | PDF render/inspection, ZIP comparison and verification guide |

The historical upload error did not reproduce in the final full Chrome flow; no unproven root cause or speculative browser workaround was claimed. Read-only GitHub Pages still cannot accept private uploads or run Python. Real SaaS evaluation remains future work, rather than a release blocker or claimed result.
