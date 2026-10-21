-- Descriptive evidence only; no churn probability is inferred.
select customer_id,sum(mrr) as current_mrr
from {{ ref('fact_customer_monthly') }}
where scope_plan='' and month=(select date_trunc('month',as_of)::date from {{ ref('stg_dataset') }})
group by 1
