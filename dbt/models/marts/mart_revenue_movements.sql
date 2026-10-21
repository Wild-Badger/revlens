select customer_id, industry, scope_plan, change_at, month, change_type, prior_mrr, current_mrr,
  case when change_type = 'new' then current_mrr else 0 end as new_mrr,
  case when change_type = 'expansion' then delta_mrr else 0 end as expansion_mrr,
  case when change_type = 'contraction' then -delta_mrr else 0 end as contraction_mrr,
  case when change_type = 'churn' then prior_mrr else 0 end as churned_mrr,
  case when change_type = 'reactivation' then current_mrr else 0 end as reactivation_mrr,
  case when change_type in ('expansion','contraction','stable') then least(prior_mrr,current_mrr) else 0 end as stable_mrr
from {{ ref('fact_subscription_changes') }}
