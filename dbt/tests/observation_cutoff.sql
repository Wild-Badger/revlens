select s.* from {{ ref('fact_subscription_changes') }} s cross join {{ ref('stg_dataset') }} d
where s.change_at>d.as_of
