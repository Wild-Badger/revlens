select cohort,scope_plan,industry from {{ ref('mart_cohort_retention') }}
group by 1,2,3 having min(cohort_customers)<>max(cohort_customers)
 or min(acquisition_mrr)<>max(acquisition_mrr)
 or min(cohort_customers)<1
