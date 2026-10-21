select s.id as subscription_id, s.customer_id, s.plan_id, s.status, s.started_at,
       s.ended_at, s.billing_interval, s.current_mrr, s.seats, p.plan_name,
       c.industry, c.company_size, c.country, c.acquisition_channel
from {{ source('app', 'subscriptions') }} s
join {{ ref('stg_app__plans') }} p on p.plan_id = s.plan_id
join {{ ref('stg_app__customers') }} c on c.customer_id = s.customer_id
cross join {{ ref('stg_dataset') }} d
where s.started_at <= d.as_of
