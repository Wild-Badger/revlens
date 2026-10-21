select *, retained_mrr/nullif(acquisition_mrr,0) as revenue_retention_rate
from {{ ref('mart_cohort_retention') }}
