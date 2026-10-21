-- Grain: customer + scope (all plans or one plan) + actual change timestamp.
-- Net simultaneous starts/ends before classification, including same-day replacements.
with events as (
  select s.customer_id, s.industry, scope.scope_plan, s.started_at as change_at, s.current_mrr as delta
  from {{ ref('stg_app__subscriptions') }} s
  cross join lateral (values (''::text), (s.plan_name)) scope(scope_plan)
  union all
  select s.customer_id, s.industry, scope.scope_plan, s.ended_at, -s.current_mrr
  from {{ ref('stg_app__subscriptions') }} s cross join {{ ref('stg_dataset') }} d
  cross join lateral (values (''::text), (s.plan_name)) scope(scope_plan)
  where s.ended_at <= d.as_of
), net as (
  select customer_id, industry, scope_plan, change_at, sum(delta) as delta_mrr
  from events group by 1,2,3,4
), running as (
  select *, sum(delta_mrr) over (partition by customer_id,scope_plan order by change_at) as current_mrr
  from net
), previous as (
  select *, current_mrr - delta_mrr as prior_mrr,
         max(current_mrr) over (partition by customer_id,scope_plan order by change_at rows between unbounded preceding and 1 preceding) as max_prior_mrr
  from running
)
select *, date_trunc('month',change_at)::date as month,
  case when prior_mrr = 0 and current_mrr > 0 and coalesce(max_prior_mrr,0) > 0 then 'reactivation'
       when prior_mrr = 0 and current_mrr > 0 then 'new'
       when prior_mrr > 0 and current_mrr = 0 then 'churn'
       when delta_mrr > 0 then 'expansion'
       when delta_mrr < 0 then 'contraction' else 'stable' end as change_type
from previous
