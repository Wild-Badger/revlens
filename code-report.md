# Predictive release audit

Claims were compared with current code and reproducible evidence. Earlier local draft docs were aspirational; the prior public README correctly admitted scenario-only forecasts.

| Gap | Resolution |
| --- | --- |
| Sliders mistaken for a model; regression without UI | Evaluated Python forecast, separate scenarios, legacy endpoint 410 and leakage checks |
| Draft dbt claim while APIs used TypeScript | Tested views, runtime warehouse reads and real PostgreSQL reconciliation |
| Draft SCD2 without capture | Native snapshots, deletion/reappearance checks and history UI |
| Replacement losing history/stale marts | Revisions, pending barrier, common lock, source isolation and v2 backup |
| Short fictional data | 48 months, predefined stress cases and separate attributed retail benchmark |
| Broken README-parsing generator/fixed test counts | Structured case source plus actual evaluation reports |
| Jobs/alerts/cloud claims beyond delivery | Rewritten architecture, model, operating spec and evidence matrix |

Review flags and implied LTV remain heuristics. CRM adapters are disabled in local mode and outside verified capabilities. Small-sample interval limitations and retail baseline selection are disclosed. See docs/verification.md. Upwork upload awaits approval.
