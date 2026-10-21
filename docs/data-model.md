# Data model and time semantics

Prisma maps raw tables. Subscriptions use constant-MRR intervals: inclusive start, exclusive end. Monthly USD MRR differs from invoices and cash receipts. Unknown catalog prices are null.

Dataset metadata stores source UUID/name, observation cutoff, coverage start/confirmation, revision, analytics revision and pipeline status. Same-source updates cannot move the cutoff backwards. A confirmed new source resets active captures after backup.

## Analytical views

Staging constrains records to the observation cutoff. Customer-month facts retain opening/end MRR and completeness. MRR is measured immediately before the next month boundary or at the current cutoff. Forecast input excludes incomplete months and months before declared coverage.

Movements net simultaneous changes per customer and scope before classification. All-customer and plan scopes are distinct. Tests reconcile opening MRR plus signed movements to closing MRR. Reactivation requires prior observed positive MRR. UTC and empty periods within known coverage are explicit.

Cohorts use first observed subscription month, fixed initial customer count and fixed acquisition MRR. NRR/GRR follow opening customers; acquisition cannot inflate retention. Current industry attributes do not claim historically reconstructed segment membership.

## SCD2

Native dbt check snapshots compare relevant customer/plan attributes. Keys combine source UUID and entity UUID. Identical reimports create no version. Changes close the old version; removals create tombstones; reappearance creates another version.

Capture validity records when RevLens observed a state. Source observation cutoff is stored separately. Neither invents the real date of an unknown earlier change. Customer detail exposes customer and associated plan versions, including unknown prices.

## Backup

V2 contains raw data, source/coverage metadata and native snapshots. Validation bounds size, fields, source-qualified identities, validity and non-overlap. Transactional restore preserves accounts and increments revision, then requires refresh. V1 restores without fabricated earlier SCD2 or confirmed coverage.

Limits: USD only, one non-overlapping interval per customer at a time, no accounting ledger or cross-source warehouse.
