-- Dated constant-price intervals, sampled at month end (or the explicit partial cutoff).
with calendar as (
  select generate_series(date_trunc('month', least(min(s.started_at), min(d.history_start))),
                         date_trunc('month', min(d.as_of)), interval '1 month') as month
  from {{ ref('stg_app__subscriptions') }} s cross join {{ ref('stg_dataset') }} d
), scopes as (
  select distinct customer_id,industry,scope.scope_plan
  from {{ ref('stg_app__subscriptions') }} s
  cross join lateral (values (''::text), (s.plan_name)) scope(scope_plan)
), at_dates as (
  select month::date as month, least(month + interval '1 month' - interval '1 microsecond', d.as_of) as cutoff,
         month - interval '1 microsecond' as opening_cutoff,
         month + interval '1 month' <= d.as_of + interval '1 millisecond' as is_complete
  from calendar cross join {{ ref('stg_dataset') }} d
)
select m.month, c.customer_id, c.industry, c.scope_plan, m.is_complete,
  coalesce(sum(s.current_mrr) filter(where s.started_at <= m.cutoff and (s.ended_at is null or s.ended_at > m.cutoff)),0) as mrr,
  coalesce(sum(s.current_mrr) filter(where s.started_at <= m.opening_cutoff and (s.ended_at is null or s.ended_at > m.opening_cutoff)),0) as opening_mrr,
  count(s.subscription_id) filter(where s.started_at <= m.cutoff and (s.ended_at is null or s.ended_at > m.cutoff)) > 0 as active
from at_dates m cross join scopes c
left join {{ ref('stg_app__subscriptions') }} s on s.customer_id = c.customer_id and (c.scope_plan = '' or s.plan_name = c.scope_plan)
group by 1,2,3,4,5
