select month, scope_plan, industry, bool_and(is_complete) as is_complete,
  sum(mrr) as mrr, sum(opening_mrr) as opening_mrr,
  count(*) filter(where active) as customer_count,
  count(*) filter(where opening_mrr > 0) as opening_customers,
  count(*) filter(where opening_mrr > 0 and mrr = 0) as churned_customers,
  sum(mrr) filter(where opening_mrr > 0) as retained_mrr,
  sum(least(mrr,opening_mrr)) filter(where opening_mrr > 0) as gross_retained_mrr,
  sum(opening_mrr) filter(where opening_mrr > 0 and mrr = 0) as churned_mrr
from {{ ref('fact_customer_monthly') }} group by 1,2,3
