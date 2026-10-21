select *, retained_customers::numeric/nullif(cohort_customers,0) as retention_rate
from {{ ref('mart_cohort_retention') }}
