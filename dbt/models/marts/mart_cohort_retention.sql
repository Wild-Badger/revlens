with firsts as (
  select s.customer_id,s.industry,scope.scope_plan,min(s.started_at) as first_at
  from {{ ref('stg_app__subscriptions') }} s
  cross join lateral (values (''::text),(s.plan_name)) scope(scope_plan)
  group by 1,2,3
), acquisition as (
  select f.*, date_trunc('month',f.first_at)::date as cohort,
         sum(s.current_mrr) as acquisition_mrr
  from firsts f join {{ ref('stg_app__subscriptions') }} s
    on s.customer_id=f.customer_id and s.started_at=f.first_at and (f.scope_plan='' or s.plan_name=f.scope_plan)
  group by f.customer_id,f.industry,f.scope_plan,f.first_at
)
select a.cohort, m.month,a.industry,a.scope_plan,
  ((extract(year from m.month)-extract(year from a.cohort))*12 + extract(month from m.month)-extract(month from a.cohort))::int as period_offset,
  count(*) as cohort_customers, sum(a.acquisition_mrr) as acquisition_mrr,
  count(*) filter(where m.active) as retained_customers,sum(m.mrr) as retained_mrr
from acquisition a join {{ ref('fact_customer_monthly') }} m
  on m.customer_id=a.customer_id and m.scope_plan=a.scope_plan and m.month>=a.cohort
group by 1,2,3,4
